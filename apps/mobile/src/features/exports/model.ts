import {
  BOARD_EXPORT_CARD_LIMIT,
  DATA_EXPORT_BYTE_LIMIT,
  type BoardExportFormat,
} from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';

export { BOARD_EXPORT_CARD_LIMIT, DATA_EXPORT_BYTE_LIMIT };
export type { BoardExportFormat };

export type ExportTarget =
  | { readonly kind: 'account' }
  | {
      readonly kind: 'board';
      readonly boardId: string;
      readonly format: BoardExportFormat;
    };

export const EXPORT_MIME: Readonly<Record<BoardExportFormat, string>> = {
  json: 'application/json',
  csv: 'text/csv',
};
/** A snapshot is built server-side before the first byte; allow for that. */
export const EXPORT_TIMEOUT_MS = 120_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;

export function targetFormat(target: ExportTarget): BoardExportFormat {
  return target.kind === 'account' ? 'json' : target.format;
}

/** Board IDs come from validated protected navigation; anything else is refused. */
export function validTarget(target: ExportTarget): boolean {
  return (
    target.kind === 'account' ||
    (UUID.test(target.boardId) &&
      (target.format === 'json' || target.format === 'csv'))
  );
}

/** The server names files by UTC date, so the fallback does too. */
export function fallbackFilename(target: ExportTarget, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return target.kind === 'account'
    ? `kanvexa-account-${date}.json`
    : `kanvexa-board-${target.boardId}-${date}.${target.format}`;
}

/**
 * Content-Disposition is only a hint. It is used when it is exactly the
 * documented server shape for this target — no path, Board name, email, control
 * or Unicode tricks can reach the OS filename; otherwise the fallback is used.
 */
export function exportFilename(
  target: ExportTarget,
  contentDisposition: string | null,
  now: Date = new Date(),
): string {
  const fallback = fallbackFilename(target, now);
  if (!contentDisposition || contentDisposition.length > 200) return fallback;
  const match = /^attachment;\s*filename="([^"\\/\r\n]{1,100})"$/i.exec(
    contentDisposition.trim(),
  );
  const name = match?.[1];
  if (!name) return fallback;
  const expected =
    target.kind === 'account'
      ? new RegExp(`^kanvexa-account-${DATE}\\.json$`)
      : new RegExp(
          `^kanvexa-board-${target.boardId}-${DATE}\\.${target.format}$`,
        );
  return expected.test(name) ? name : fallback;
}

export interface ExportDownload {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

/** The bounded resource key a Board export is tied to; access loss aborts it. */
export const boardExportKey = (identity: SessionIdentity, boardId: string) =>
  queryKeys.board(identity, boardId);

/**
 * Raw attachment bytes, never the JSON envelope decoder. The transport rejects
 * non-200 statuses, 204, redirects, wrong MIME, JSON envelopes, missing
 * attachment disposition and anything over 20 MiB (counted on actual bytes).
 */
export async function downloadExport(
  http: SessionHttpClient,
  identity: SessionIdentity,
  target: ExportTarget,
  signal: AbortSignal,
  onProgress?: (received: number, total: number | undefined) => void,
  now: () => Date = () => new Date(),
): Promise<ExportDownload> {
  if (!validTarget(target))
    throw new ApiError('configuration', { requestStarted: false });
  const format = targetFormat(target);
  const mimeType = EXPORT_MIME[format];
  const result = await http.binary(
    target.kind === 'account'
      ? '/users/me/export'
      : `/boards/${target.boardId}/export`,
    [mimeType],
    {
      identity,
      signal,
      retries: 0,
      timeoutMs: EXPORT_TIMEOUT_MS,
      query: { format },
      maximumBytes: DATA_EXPORT_BYTE_LIMIT,
      onProgress,
      ...(target.kind === 'board'
        ? {
            resourceKey: boardExportKey(identity, target.boardId),
            resourceAccess: 'read' as const,
          }
        : {}),
    },
  );
  const bytes = new Uint8Array(result.bytes);
  if (bytes.byteLength === 0 || bytes.byteLength > DATA_EXPORT_BYTE_LIMIT)
    throw new ApiError('invalid-response', { status: 200 });
  return {
    bytes,
    mimeType,
    filename: exportFilename(target, result.contentDisposition, now()),
  };
}

export function exportError(error: unknown, target: ExportTarget): string {
  const board = target.kind === 'board';
  if (!(error instanceof ApiError))
    return 'The export could not be prepared. No file was saved.';
  if (error.code === 'PRIVATE_STORAGE_FAILED')
    return 'The file could not be saved privately on this device. Check free storage and try again.';
  if (error.code === 'PRIVATE_STORAGE_UNAVAILABLE')
    return 'Private temporary storage could not be cleared. Restart the app before exporting again.';
  if (error.code === 'EXPORT_TOO_LARGE' || error.code === 'RESPONSE_TOO_LARGE')
    return board
      ? 'This board is too large to export (limit 20 MiB or 10,000 cards). Nothing was truncated or saved.'
      : 'Your account export exceeds 20 MiB. Nothing was saved.';
  if (error.status === 403 || error.status === 404)
    return board
      ? 'Board export is unavailable. Only a current board owner can export this board.'
      : 'Account export is unavailable for this account.';
  if (error.status === 429)
    return 'Too many export requests. Wait before trying again.';
  if (error.status === 401) return 'Your session ended. Sign in again.';
  if (error.kind === 'offline') return 'You’re offline. Reconnect to export.';
  if (error.kind === 'timeout')
    return 'The export took too long. No file was saved. Try again.';
  if (error.kind === 'network')
    return 'The connection dropped. No file was saved. Try again.';
  if (error.kind === 'invalid-response')
    return 'The server did not return a valid export file. No file was saved.';
  if (error.kind === 'configuration')
    return 'Export is not available in this build.';
  return 'The export could not be prepared. No file was saved.';
}
