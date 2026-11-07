import type { BoardExportFormat } from '@kanban/shared';
import { requestBinary, type BinaryResponse } from '../../../lib/api-client';

/*
 * Data export downloads (#216 backend, #224 UI). Successful responses are file
 * bytes outside the JSON envelope; errors keep the normal error envelope.
 */

const ACCEPT: Record<BoardExportFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
};

/** JSON metadata of the signed-in account only; there is no user selector. */
export function exportAccountData(
  accessToken: string,
  signal?: AbortSignal,
): Promise<BinaryResponse> {
  return requestBinary('/users/me/export', {
    accessToken,
    signal,
    accept: ACCEPT.json,
  });
}

/** A Board snapshot; the server allows only a current explicit OWNER. */
export function exportBoardData(
  accessToken: string,
  boardId: string,
  format: BoardExportFormat,
  signal?: AbortSignal,
): Promise<BinaryResponse> {
  const query = new URLSearchParams({ format });
  return requestBinary(
    `/boards/${encodeURIComponent(boardId)}/export?${query}`,
    { accessToken, signal, accept: ACCEPT[format] },
  );
}
