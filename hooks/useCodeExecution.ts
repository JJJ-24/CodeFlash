import { transform } from 'sucrase';
import { useState } from 'react';

import { buildSandboxHtml } from '@/lib/code-execution/sandbox';
import type { ExecResult, ExecStatus, LogEntry } from '@/lib/code-execution/types';

export type { ExecResult, ExecStatus, LogEntry };

/**
 * コード実行の状態管理と実行ロジックを提供するフック。
 * 言語を追加する際は run() 内の言語判定を拡張する。
 */
export function useCodeExecution() {
  const [status, setStatus] = useState<ExecStatus>('idle');
  const [result, setResult] = useState<ExecResult | null>(null);
  const [htmlSource, setHtmlSource] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);

  function run(content: string, language: string) {
    setStatus('running');
    setResult(null);

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

    setBaseUrl(language === 'python' ? 'https://cdn.jsdelivr.net' : undefined);
    setHtmlSource(buildSandboxHtml(code, language));
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
    };
    const newResult: ExecResult = {
      status: data.type as ExecStatus,
      logs: data.logs ?? [],
      errorMessage: data.message,
    };
    setStatus(newResult.status);
    setResult(newResult);
    setHtmlSource(null);
  }

  function reset() {
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
