export type ExportJobState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
/** Public status only; private bytes and worker/session fields never belong here. */
export interface BoardExportJobResponse {
  id: string;
  state: ExportJobState;
  format: 'json' | 'csv';
  attempts: number;
  expiresAt: string;
  progress: number | null;
  error: string | null;
}
