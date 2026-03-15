export type LogEntry = { type: 'log' | 'error' | 'warn'; text: string };
export type ExecStatus = 'idle' | 'running' | 'success' | 'error' | 'timeout';

export interface ExecResult {
  status: ExecStatus;
  logs: LogEntry[];
  errorMessage?: string;
}
