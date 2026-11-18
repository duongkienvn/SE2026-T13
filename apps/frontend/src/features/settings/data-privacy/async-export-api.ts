import type { BoardExportJobResponse } from '@kanban/shared';
import {
  ApiError,
  ClientErrorCode,
  requestBinary,
  requestRawJson,
  type BinaryResponse,
} from '../../../lib/api-client';
export type ExportPhase = 'queued' | 'running' | 'downloading';
const invalid = () =>
  new ApiError(
    200,
    ClientErrorCode.INVALID_RESPONSE,
    'Unexpected export status.',
  );

function status(
  value: unknown,
  format: 'json' | 'csv',
  id?: string,
): BoardExportJobResponse {
  if (!value || typeof value !== 'object') throw invalid();
  const row = value as Partial<BoardExportJobResponse>;
  if (
    typeof row.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      row.id,
    ) ||
    (id !== undefined && row.id !== id) ||
    row.format !== format ||
    !['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'].includes(row.state ?? '') ||
    !Number.isInteger(row.attempts) ||
    row.attempts! < 0 ||
    row.attempts! > 3 ||
    typeof row.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(row.expiresAt))
  )
    throw invalid();
  return row as BoardExportJobResponse;
}
function waitForPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One explicit action. Replays preserve the key; only an existing FAILED job is retried. */
export async function exportBoardDataAsync(
  accessToken: string,
  boardId: string,
  format: 'json' | 'csv',
  key: string,
  signal: AbortSignal,
  onPhase?: (phase: ExportPhase) => void,
): Promise<BinaryResponse> {
  signal.throwIfAborted();
  const path = `/boards/${encodeURIComponent(boardId)}/export-jobs`;
  const options = { accessToken, signal };
  let job = status(
    await requestRawJson(path, {
      ...options,
      method: 'POST',
      body: { format },
      headers: { 'Idempotency-Key': key },
      expectedStatus: 202,
    }),
    format,
  );
  const id = job.id;
  if (job.state === 'FAILED')
    job = status(
      await requestRawJson(`${path}/${id}/retry`, {
        ...options,
        method: 'POST',
        expectedStatus: 202,
      }),
      format,
      id,
    );
  const deadline = Date.now() + 15 * 60_000;
  let phase: ExportPhase | undefined;
  while (job.state !== 'COMPLETED') {
    signal.throwIfAborted();
    if (job.state === 'FAILED')
      throw new ApiError(
        409,
        'EXPORT_FAILED',
        'Export failed. Retry the same operation.',
      );
    if (Date.now() >= deadline)
      throw new ApiError(
        503,
        'EXPORT_TIMEOUT',
        'Export observation timed out.',
      );
    const nextPhase = job.state === 'PENDING' ? 'queued' : 'running';
    if (phase !== nextPhase) {
      phase = nextPhase;
      onPhase?.(phase);
    }
    await waitForPoll(signal);
    job = status(
      await requestRawJson(`${path}/${id}`, {
        ...options,
        expectedStatus: 200,
      }),
      format,
      id,
    );
  }
  signal.throwIfAborted();
  onPhase?.('downloading');
  return requestBinary(`${path}/${id}/download`, {
    ...options,
    accept: format === 'csv' ? 'text/csv' : 'application/json',
  });
}
