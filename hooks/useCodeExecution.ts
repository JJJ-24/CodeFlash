import { transform } from 'sucrase';
import { useEffect, useRef, useState } from 'react';

import { buildSandboxHtml, EXEC_TIMEOUT_BASE_MS, EXEC_TIMEOUT_MAX_MS } from '@/lib/code-execution/sandbox';
import type { ExecResult, ExecStatus, LogEntry, SqlTableResult } from '@/lib/code-execution/types';
import { hasImageRefs, resolveHtmlImageRefs } from '@/lib/htmlImages';
import i18n from '@/lib/i18n';
import type { DeckImage } from '@/types';

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

/** Wandbox（C++）の全リトライ込みの全体タイムアウト。WebView 実行系の絶対上限と揃えてある。 */
const WANDBOX_TIMEOUT_MS = EXEC_TIMEOUT_MAX_MS;

/**
 * サンドボックスの締切に対して RN 側の見張りが余分に待つ時間。
 * WebView のマウント・HTML パース・メッセージ往復のぶんで、正常な実行を誤って打ち切らないための余裕。
 */
const WATCHDOG_MARGIN_MS = 3000;

/**
 * 完了メッセージが届かないまま実行が固着したときに RN 側から打ち切る見張りタイマーの待ち時間。
 *
 * サンドボックス内の締切（`DEADLINE_SCRIPT`）は**その WebView の JS が生きていること**が前提なので、
 * 次のケースでは誰も実行を終わらせられず `status='running'` のまま固着する（＝コードブロックの
 * ヘッダーが緑のまま・スピナーが回り続ける）：
 * - カードのコードが `location.href = ...` などでページごと遷移した（harness ごと消える）
 * - `while(true)` のような同期無限ループで JS スレッドが占有され、締切タイマーが発火できない
 * - WebView のコンテンツプロセスが落ちた／`window.ReactNativeWebView` を壊された
 *
 * 待ち時間は言語で分ける。web/console 系は既定 5 秒で終わるので短く張り、カードが `setTimeout` で
 * 締切を延ばしたら `{type:'deadline'}` の通知（`DEADLINE_SCRIPT.postDeadline`）で張り直す。
 * python/sql は CDN からの読み込みを含む 30 秒が正当な上限なので最初から長く取る。
 * **C++ は対象外**（WebView を使わず `runCppViaWandbox` の AbortController が既に打ち切る）。
 */
function watchdogMsFor(language: string): number | null {
  if (language === 'cpp') return null;
  if (language === 'python' || language === 'sql') return EXEC_TIMEOUT_MAX_MS + WATCHDOG_MARGIN_MS;
  return EXEC_TIMEOUT_BASE_MS + WATCHDOG_MARGIN_MS;
}

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
  // 実行中に届いた途中経過のログ（サンドボックスが 100ms ごとに送る `{type:'logs'}`）。
  // result には入れない：result の変化は onResult（学習画面の結果へのスクロール）を呼ぶので、
  // ログが届くたびに画面が動いてしまう。完了時に result.logs へ全量が入るのでここは捨てる。
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
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
  // 043: 画像参照の解決（ファイル読み込み）を挟むと run が非同期になるため、
  // 「解決を待っている間に次の実行・clear が走った」場合に古い結果で上書きしないための通し番号。
  // runNonce は関数更新なので同期に値を読めない＝別に ref で持つ。
  const runSeqRef = useRef(0);
  // 完了が届かないまま固着したときに打ち切る見張り（watchdogMsFor 参照）。
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 打ち切り時に途中経過のログを結果へ引き継ぐための控え（state は setTimeout 内から読めないため）。
  const liveLogsRef = useRef<LogEntry[]>([]);

  // 常に最新の onResult を参照するため ref で保持
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });

  function clearWatchdog() {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }

  /**
   * 見張りを張り直す。サンドボックスが締切を動かすたび（`{type:'deadline'}`）にも呼ばれる。
   * 発火したら「応答なし」として実行を終わらせる＝running のまま固着させない。
   * WebView の後始末は完了時（`handleMessage`）と同じ流儀にする（可視プレビューは残す）。
   */
  function armWatchdog(ms: number) {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      setStatus('error');
      setResult({ status: 'error', logs: liveLogsRef.current, errorMessage: i18n.t('code.noResponse') });
      // 完了時と同じ扱い：可視プレビューは残し（遷移先や描画結果を消さない）、
      // console 専用言語の隠し WebView は破棄する（暴走ループが CPU を掴み続けないように）。
      if (!previewModeRef.current) setHtmlSource(null);
    }, ms);
  }

  // アンマウント時に取り残さない（画面を離れた後に結果が入るのを防ぐ）
  useEffect(() => clearWatchdog, []);

  useEffect(() => {
    if (result) setTimeout(() => onResultRef.current?.(), 50);
  }, [result]);

  async function runCppViaWandbox(code: string) {
    const controller = new AbortController();
    cppAbortRef.current = controller;
    // 全リトライ込みの全体タイムアウト（30秒）。これを超えたら timeout 扱いで打ち切る。
    const timer = setTimeout(() => controller.abort(), WANDBOX_TIMEOUT_MS);

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
        setResult({ status: 'timeout', logs: [], limitMs: WANDBOX_TIMEOUT_MS });
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
   * @param deckImages デッキの HTML 画像ライブラリ（043）。本文/土台の `img://name` を data URI へ解決するのに使う
   */
  function run(content: string, language: string, sqlInits?: string[], htmlInits?: string[], deckImages?: DeckImage[]) {
    setStatus('running');
    setResult(null);
    setLiveLogs([]);
    liveLogsRef.current = [];
    clearWatchdog();
    setRunNonce((n) => n + 1); // 可視プレビューの WebView を再実行ごとに強制再マウントするための key
    const seq = ++runSeqRef.current;

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

    // Web プレビュー実行の判定：html / css は常に、js/ts は HTML/CSS 土台がある時だけ可視プレビューにする
    // （js/ts は土台が無ければコンソール実行に落ちるが、css にはその落とし先が無いため常に web 実行）。
    const hasStage = (htmlInits ?? []).some((s) => s && s.trim() !== '');
    const isWeb =
      language === 'html' ||
      language === 'css' ||
      (hasStage && (language === 'javascript' || language === 'typescript'));
    previewModeRef.current = isWeb;
    setPreviewMode(isWeb);

    setBaseUrl(
      language === 'python' ? 'https://cdn.jsdelivr.net' :
      language === 'sql' ? 'https://cdnjs.cloudflare.com' : undefined
    );
    const html = buildSandboxHtml(code, language, sqlInits, htmlInits);
    // 見張りは WebView に HTML を渡すのと同じタイミングで張る（画像解決の待ち時間を含めない）
    const watchdogMs = watchdogMsFor(language);

    // 043: web 系で `img://name` を含むときだけ、ファイル読み込みを挟んで data URI に解決する。
    // 含まないとき（＝ほとんどのカード）は従来どおり同期でセットする＝挙動も速度も不変。
    // web 系に限るのは、python/sql の本文に現れた `img://` を書き換えないため。
    if (isWeb && hasImageRefs(html)) {
      void resolveHtmlImageRefs(html, deckImages ?? []).then((resolved) => {
        if (runSeqRef.current !== seq) return; // 解決中に次の実行/clear が走った＝この結果は捨てる
        setHtmlSource(resolved);
        if (watchdogMs !== null) armWatchdog(watchdogMs);
      });
      return;
    }
    setHtmlSource(html);
    if (watchdogMs !== null) armWatchdog(watchdogMs);
  }

  function clear() {
    clearWatchdog();
    setStatus('idle');
    setResult(null);
    setLiveLogs([]);
    liveLogsRef.current = [];
    setHtmlSource(null); // Web プレビューの可視 WebView も破棄する
    setPreviewMode(false);
    previewModeRef.current = false;
    runSeqRef.current++; // 解決待ちの画像参照が後から htmlSource を蘇らせないように無効化する
  }

  function handleMessage(event: { nativeEvent: { data: string } }) {
    const data = JSON.parse(event.nativeEvent.data) as {
      type: string;
      logs?: LogEntry[];
      entries?: LogEntry[];
      message?: string;
      tables?: SqlTableResult[];
      limitMs?: number;
      remainingMs?: number;
    };
    // 実行中の途中経過。結果ではないので status / result には触らない。
    if (data.type === 'logs') {
      if (data.entries?.length) {
        liveLogsRef.current = [...liveLogsRef.current, ...data.entries];
        setLiveLogs(liveLogsRef.current);
      }
      return;
    }
    // サンドボックスが締切を動かした（setTimeout での延長・ダイアログ待ち）。見張りをそれに合わせる。
    if (data.type === 'deadline') {
      const remaining = Number(data.remainingMs);
      if (Number.isFinite(remaining) && remaining >= 0) armWatchdog(remaining + WATCHDOG_MARGIN_MS);
      return;
    }
    clearWatchdog();
    const newResult: ExecResult = {
      status: data.type as ExecStatus,
      logs: data.logs ?? [],
      errorMessage: data.message,
      tables: data.tables,
      limitMs: data.limitMs,
    };
    setStatus(newResult.status);
    setResult(newResult);
    // Web プレビューは描画結果を見せ続けるため WebView を残す。console 専用言語のみ破棄する。
    if (!previewModeRef.current) setHtmlSource(null);
  }

  function reset() {
    cppAbortRef.current?.abort();
    cppAbortRef.current = null;
    clearWatchdog();
    setStatus('idle');
    setResult(null);
    setLiveLogs([]);
    liveLogsRef.current = [];
    setHtmlSource(null);
    setPreviewMode(false);
    previewModeRef.current = false;
    runSeqRef.current++; // clear と同じく、解決待ちの結果を無効化する
  }

  return {
    status,
    result,
    liveLogs,
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
