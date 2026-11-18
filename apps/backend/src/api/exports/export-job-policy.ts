import type { BoardExportJobResponse, ExportJobState } from '@kanban/shared';

export interface ExportJobRecord {
  id: string;
  state: ExportJobState;
  format: 'json' | 'csv';
  attempts: number;
  expiresAt: Date;
}
export type ExportJobResponse = BoardExportJobResponse;
export function toExportJobResponse(row: ExportJobRecord): ExportJobResponse {
  return {
    id: row.id,
    state: row.state,
    format: row.format,
    attempts: row.attempts,
    expiresAt: row.expiresAt.toISOString(),
    progress:
      row.state === 'COMPLETED' ? 100 : row.state === 'PENDING' ? 0 : null,
    error: row.state === 'FAILED' ? 'EXPORT_FAILED' : null,
  };
}
export function canRetryExportJob(row: ExportJobRecord, now: Date): boolean {
  return row.state === 'FAILED' && row.attempts < 3 && row.expiresAt > now;
}
