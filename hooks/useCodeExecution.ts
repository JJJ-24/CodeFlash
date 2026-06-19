import { transform } from 'sucrase';
import { useEffect, useRef, useState } from 'react';

import { buildSandboxHtml } from '@/lib/code-execution/sandbox';
import type { ExecResult, ExecStatus, LogEntry, SqlTableResult } from '@/lib/code-execution/types';

export type { ExecResult, ExecStatus, LogEntry, SqlTableResult };

const WANDBOX_URL = 'https://wandbox.org/api/compile.json';

/**
 * コード実行の状態管理と実行ロジックを提供するフック。
 * 言語を追加する際は run() 内の言語判定を拡張する。
 */
export function useCodeExecution(onResult?: () => void) {
  const [status, setStatus] = useState<ExecStatus>('idle');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
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
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const resp = await fetch(WANDBOX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, compiler: 'gcc-13.2.0', 'compiler-option-raw': '-std=c++17\n-Wall' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      cppAbortRef.current = null;

      if (!resp.ok) throw new Error(`Wandbox API error: ${resp.status}`);

      const data = await resp.json() as {
        status?: string;
        compiler_error?: string;
        program_output?: string;
        program_error?: string;
      };

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
   * @param sqlInits SQL 実行時にクエリ本体の前に流す初期化SQL（デッキ共通 → ブロック固有）。SQL 以外では無視される
   */
  function run(content: string, language: string, sqlInits?: string[]) {
    setStatus('running');
    setResult(null);

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

    setBaseUrl(
      language === 'python' ? 'https://cdn.jsdelivr.net' :
      language === 'sql' ? 'https://cdnjs.cloudflare.com' : undefined
    );
    setHtmlSource(buildSandboxHtml(code, language, sqlInits));
  }

  function clear() {
    setStatus('idle');
    setResult(null);
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
    setHtmlSource(null);
  }

  function reset() {
    cppAbortRef.current?.abort();
    cppAbortRef.current = null;
    setStatus('idle');
    setResult(null);
    setHtmlSource(null);
  }

  return {
    status,
    result,
    htmlSource,
    baseUrl,
    isRunning: status === 'running',
    run,
    clear,
    handleMessage,
    reset,
  };
}
