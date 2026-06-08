export type LogEntry = { type: 'log' | 'error' | 'warn'; text: string };
export type ExecStatus = 'idle' | 'running' | 'success' | 'error' | 'timeout';
export type SqlTableResult = {
  columns: string[];
  rows: (string | number | null)[][];
};

export interface ExecResult {
  status: ExecStatus;
  logs: LogEntry[];
  errorMessage?: string;
  tables?: SqlTableResult[];
}
