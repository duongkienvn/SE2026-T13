// Contract seam only. Behavior is deliberately unsupported until RED is recorded.
export interface ExportJobRecord {
  id: string;
  state: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  format: 'json' | 'csv';
  attempts: number;
  expiresAt: Date;
}
export interface ExportJobResponse {
  id: string;
  state: ExportJobRecord['state'];
  format: ExportJobRecord['format'];
  attempts: number;
  expiresAt: string;
  progress: number | null;
  error: string | null;
}
export function toExportJobResponse(_row: ExportJobRecord): ExportJobResponse {
  throw new Error('Async export response mapping is not implemented');
}
export function canRetryExportJob(_row: ExportJobRecord, _now: Date): boolean {
  throw new Error('Async export retry policy is not implemented');
}
