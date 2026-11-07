import type { BoardExportFormat } from '@kanban/shared';

export type ExportTarget =
  | { kind: 'account' }
  | { kind: 'board'; boardId: string; format: BoardExportFormat };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;

/** The server names files by UTC date, so the fallback does too. */
function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The documented server name for a target, or `null` for an unsafe Board ID. */
function fallbackName(target: ExportTarget, now: Date): string | null {
  if (target.kind === 'account') return `kanvexa-account-${utcDate(now)}.json`;
  if (!UUID.test(target.boardId)) return null;
  return `kanvexa-board-${target.boardId.toLowerCase()}-${utcDate(now)}.${target.format}`;
}

function headerName(contentDisposition: string | null): string | null {
  if (!contentDisposition || contentDisposition.length > 300) return null;
  const match = /(?:^|;)\s*filename="([^"\\/]+)"\s*(?:;|$)/i.exec(
    contentDisposition,
  );
  return match?.[1] ?? null;
}

/**
 * The name to save a download under. A `Content-Disposition` name is used only
 * when it has exactly the server's documented shape for this target (so no
 * Board name, response text or personal data can reach the file system);
 * otherwise the deterministic fallback is used. CORS usually hides the header.
 */
export function exportFilename(
  target: ExportTarget,
  contentDisposition: string | null,
  now: Date = new Date(),
): string | null {
  const fallback = fallbackName(target, now);
  if (!fallback) return null;
  const name = headerName(contentDisposition);
  if (!name) return fallback;
  const expected =
    target.kind === 'account'
      ? new RegExp(`^kanvexa-account-${DATE}\\.json$`)
      : new RegExp(
          `^kanvexa-board-${target.boardId.toLowerCase()}-${DATE}\\.${target.format}$`,
        );
  return expected.test(name) ? name : fallback;
}

/** How long the browser gets to start reading an object URL before it is revoked. */
export const OBJECT_URL_LIFETIME_MS = 1_000;

/**
 * Hands a Blob to the browser's download manager through a temporary object
 * URL. Returns a function that revokes the URL at once (for unmount); it is
 * also revoked automatically shortly after the click.
 */
export function saveBlob(blob: Blob, filename: string): () => void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  };
  const timer = setTimeout(revoke, OBJECT_URL_LIFETIME_MS);
  return revoke;
}
