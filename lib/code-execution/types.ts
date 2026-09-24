export type LogEntry = { type: 'log' | 'error' | 'warn'; text: string };
// stopped＝実行中に利用者が実行ボタン（R キー）で中止した
export type ExecStatus = 'idle' | 'running' | 'success' | 'error' | 'timeout' | 'stopped';
export type SqlTableResult = {
  columns: string[];
  rows: (string | number | null)[][];
};

export interface ExecResult {
  status: ExecStatus;
  logs: LogEntry[];
  errorMessage?: string;
  tables?: SqlTableResult[];
  /**
   * timeout のときに実際に適用された上限（ミリ秒）。JS/Web は setTimeout の予約に応じて
   * 5秒→最大30秒まで伸びるため、UI はこの値を使って「N秒を超えたため中断」と出す。
   * 未指定なら既定の5秒。
   */
  limitMs?: number;
}
