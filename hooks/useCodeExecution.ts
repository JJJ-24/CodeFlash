import { transform } from 'sucrase';
import { useEffect, useRef, useState } from 'react';

import { buildSandboxHtml } from '@/lib/code-execution/sandbox';
import type { ExecResult, ExecStatus, LogEntry, SqlTableResult } from '@/lib/code-execution/types';
import i18n from '@/lib/i18n';

export type { ExecResult, ExecStatus, LogEntry, SqlTableResult };

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

type WandboxData = {
  status?: string;
  compiler_error?: string;
  program_output?: string;
  program_error?: string;
};

// Wandbox（公開無料インスタンス）の一時的なサーバ側障害のシグネチャ。
// 例: "OCI runtime error: crun: clone: Resource temporarily unavailable"（混雑でプロセス生成に失敗）。
// これらはユーザーのコードの問題ではなく、再試行で復旧することが多い。
const WANDBOX_TRANSIENT_PATTERN =
  /resource temporarily unavailable|oci runtime|crun:|cannot allocate memory|too many open files|exec format error/i;

/** Wandbox の応答が「コードの誤り」ではなく一時的なサーバ障害かどうかを判定する。 */
function isWandboxTransient(data: WandboxData): boolean {
  // 本物のコンパイルエラーは（混雑ではなく）ユーザーのコードの問題なので除外する。
  if (data.compiler_error?.includes('error:')) return false;
  const text = `${data.program_error ?? ''}\n${data.compiler_error ?? ''}`;
  return WANDBOX_TRANSIENT_PATTERN.test(text);
}

// 自動リトライの待機（初回失敗後 → 800ms、次 → 1600ms）。
const WANDBOX_RETRY_BACKOFFS = [800, 1600];

/** abort で即座にキャンセルできる待機。abort 時は name='AbortError' の Error で reject する。 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      },
      { once: true },
    );
  });
}

/**
 * コード実行の状態管理と実行ロジックを提供するフック。
 * 言語を追加する際は run() 内の言語判定を拡張する。
 */
export function useCodeExecution(onResult?: () => void) {
  const [status, setStatus] = useState<ExecStatus>('idle');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
  // Web プレビュー（html / js・ts＋土台）実行中か。true の間は結果受信後も WebView を可視のまま残す。
  const [previewMode, setPreviewMode] = useState(false);
  const previewModeRef = useRef(false); // handleMessage の stale closure 回避用
  // 実行のたびに増える連番。可視プレビューは実行後も WebView を残すため、同じコードの再実行では
  // source（html）が不変で再読込されない → 完了メッセージが来ず running のまま固着する。これを
  // WebView の key に使って毎回強制再マウント（＝再実行）させる。
  const [runNonce, setRunNonce] = useState(0);
  const cppAbortRef = useRef<AbortController | null>(null);

  // 常に最新の onResult を参照するため ref で保持
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });

  useEffect(() => {
    if (result) setTimeout(() => onResultRef.current?.(), 50);
  }, [result]);

  async function runCppViaWandbox(code: string) {
    const controller = new AbortController();
    cppAbortRef.current = controller;
    // 全リトライ込みの全体タイムアウト（30秒）。これを超えたら timeout 扱いで打ち切る。
    const timer = setTimeout(() => controller.abort(), 30000);

    // 初回 + リトライ。混雑（一時障害）やネットワーク失敗のときだけ再試行する。
    const maxAttempts = WANDBOX_RETRY_BACKOFFS.length + 1;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let data: WandboxData;
        try {
          const resp = await fetch(WANDBOX_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, compiler: 'gcc-13.2.0', 'compiler-option-raw': '-std=c++17\n-Wall' }),
            signal: controller.signal,
          });
          if (!resp.ok) throw new Error(`Wandbox API error: ${resp.status}`);
          data = (await resp.json()) as WandboxData;
        } catch (e: unknown) {
          // タイムアウト/キャンセルは即終了。ネットワーク失敗はリトライ対象。
          if (e instanceof Error && e.name === 'AbortError') throw e;
          if (attempt <= WANDBOX_RETRY_BACKOFFS.length) {
            await abortableDelay(WANDBOX_RETRY_BACKOFFS[attempt - 1], controller.signal);
            continue;
          }
          throw e;
        }

        // サーバ側の一時障害（混雑）はバックオフを挟んで再試行する。
        if (isWandboxTransient(data) && attempt <= WANDBOX_RETRY_BACKOFFS.length) {
          await abortableDelay(WANDBOX_RETRY_BACKOFFS[attempt - 1], controller.signal);
          continue;
        }

        clearTimeout(timer);
        cppAbortRef.current = null;

        // リトライしても混雑が解消しなかった場合は、コードの実行時エラーと区別して案内する。
        if (isWandboxTransient(data)) {
          setStatus('error');
          setResult({ status: 'error', logs: [], errorMessage: i18n.t('code.serverBusy') });
          return;
        }

        const logs: LogEntry[] = [];
        if (data.compiler_error) {
          data.compiler_error.split('\n').forEach(line => {
            if (!line.trim()) return;
            logs.push({ type: line.includes('error:') ? 'error' : 'warn', text: line });
          });
        }
        if (data.program_output) {
          data.program_output.split('\n').forEach(line => {
            if (line !== '') logs.push({ type: 'log', text: line });
          });
        }
        if (data.program_error) {
          data.program_error.split('\n').forEach(line => {
            if (line.trim()) logs.push({ type: 'error', text: line });
          });
        }

        const hasCompileError = !!data.compiler_error?.includes('error:');
        const hasRuntimeError = !hasCompileError && data.status !== '0';
        const newStatus: ExecStatus = hasCompileError || hasRuntimeError ? 'error' : 'success';
        setStatus(newStatus);
        setResult({
          status: newStatus,
          logs,
          errorMessage: hasCompileError ? 'Compile error'
            : hasRuntimeError ? `Runtime error (exit code: ${data.status})`
            : undefined,
        });
        return;
      }
    } catch (e: unknown) {
      clearTimeout(timer);
      cppAbortRef.current = null;
      if (e instanceof Error && e.name === 'AbortError') {
        setStatus('timeout');
        setResult({ status: 'timeout', logs: [] });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('error');
        setResult({ status: 'error', logs: [], errorMessage: msg });
      }
    }
  }

  /**
   * @param sqlInits  SQL 実行時にクエリ本体の前に流す初期化SQL（デッキ共通 → ブロック固有）。SQL 以外では無視される
   * @param htmlInits Web 系（html / js・ts の土台）で body 先頭に加算する HTML/CSS 土台（デッキ共通 → ブロック固有）
   */
  function run(content: string, language: string, sqlInits?: string[], htmlInits?: string[]) {
    setStatus('running');
    setResult(null);
    setRunNonce((n) => n + 1); // 可視プレビューの WebView を再実行ごとに強制再マウントするための key

    if (language === 'cpp') {
      void runCppViaWandbox(content);
      return;
    }

    let code = content;

    // 言語別トランスパイル。Python など他言語を追加する際はここに分岐を追加する。
    if (language === 'typescript') {
      try {
        code = transform(code, { transforms: ['typescript'] }).code;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus('error');
        setResult({ status: 'error', logs: [], errorMessage: msg });
        return;
      }
    }

    // Web プレビュー実行の判定：html は常に、js/ts は HTML/CSS 土台がある時だけ可視プレビューにする。
    const hasStage = (htmlInits ?? []).some((s) => s && s.trim() !== '');
    const isWeb = language === 'html' || (hasStage && (language === 'javascript' || language === 'typescript'));
    previewModeRef.current = isWeb;
    setPreviewMode(isWeb);

    setBaseUrl(
      language === 'python' ? 'https://cdn.jsdelivr.net' :
      language === 'sql' ? 'https://cdnjs.cloudflare.com' : undefined
    );
    setHtmlSource(buildSandboxHtml(code, language, sqlInits, htmlInits));
  }

  function clear() {
    setStatus('idle');
    setResult(null);
    setHtmlSource(null); // Web プレビューの可視 WebView も破棄する
    setPreviewMode(false);
    previewModeRef.current = false;
  }

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = JSON.parse(event.nativeEvent.data) as {
      type: string;
      logs?: LogEntry[];
      message?: string;
      tables?: SqlTableResult[];
    };
    const newResult: ExecResult = {
      status: data.type as ExecStatus,
      logs: data.logs ?? [],
      errorMessage: data.message,
      tables: data.tables,
    };
    setStatus(newResult.status);
    setResult(newResult);
    // Web プレビューは描画結果を見せ続けるため WebView を残す。console 専用言語のみ破棄する。
    if (!previewModeRef.current) setHtmlSource(null);
  }

  function reset() {
    cppAbortRef.current?.abort();
    cppAbortRef.current = null;
    setStatus('idle');
    setResult(null);
    setHtmlSource(null);
    setPreviewMode(false);
    previewModeRef.current = false;
  }

  return {
    status,
    result,
    htmlSource,
    baseUrl,
    previewMode,
    runNonce,
    isRunning: status === 'running',
    run,
    clear,
    handleMessage,
    reset,
  };
}
