import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientErrorCode, isApiError } from '../../../lib/api-client';
import type { BinaryResponse } from '../../../lib/api-client';
import { useAuthSession } from '../../auth/auth-session-context';
import { useAuth } from '../../auth/useAuth';
import { exportFilename, saveBlob, type ExportTarget } from './export-file';

export type ExportState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

export interface StartExportOptions {
  target: ExportTarget;
  request: (
    accessToken: string,
    signal: AbortSignal,
  ) => Promise<BinaryResponse>;
  /**
   * Checked again right before the browser receives the file, after the
   * request: e.g. the Board is still in the current owner list. The server
   * already authorized the bytes; this only avoids publishing a file the UI
   * no longer offers.
   */
  stillAllowed?: () => boolean;
  /** 403/404 for a Board: the caller refreshes its list and selection. */
  onAccessLost?: () => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Human-safe text for an export failure; never echoes server internals. */
export function exportErrorMessage(
  error: unknown,
  kind: ExportTarget['kind'],
): string {
  if (!isApiError(error))
    return 'The export could not be prepared. Please try again.';
  if (error.code === ClientErrorCode.NETWORK_ERROR)
    return 'Could not reach the server. Check your connection and try again.';
  switch (error.status) {
    case 401:
      return 'Your session has ended. Sign in again to export your data.';
    case 403:
      return kind === 'board'
        ? 'Only a current owner can export this board. The board list has been refreshed.'
        : 'Your access changed while the export was being prepared. Please try again.';
    case 404:
      return kind === 'board'
        ? 'This board is no longer available to you. The board list has been refreshed.'
        : 'Your account data could not be found. Please sign in again.';
    case 400:
      return 'This export request was not accepted. Refresh the page and try again.';
    case 413:
      return kind === 'board'
        ? 'This board is too large to export (the limit is 10,000 cards or 20 MB). Archive or move cards into a smaller board and try again.'
        : 'Your account export is larger than the 20 MB limit, so it cannot be generated.';
    case 429:
      return 'Too many export requests. Wait a moment and try again.';
    case 503:
      return 'The export took too long to prepare. Please try again in a moment.';
    default:
      return 'The export could not be prepared. Please try again later.';
  }
}

/**
 * One export button's request lifecycle: a single request at a time, a file
 * only after `200` while this session is still current, and no file after the
 * component unmounts, the session changes or the caller withdraws access. The
 * Blob is handed to the browser and never kept in React state or a query cache.
 */
export function useExportDownload() {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const [state, setState] = useState<ExportState>({ status: 'idle' });
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const disposers = useRef(new Set<() => void>());

  useEffect(() => {
    const pending = disposers.current;
    return () => {
      controller.current?.abort();
      controller.current = null;
      running.current = false;
      for (const dispose of pending) dispose();
      pending.clear();
    };
  }, []);

  // A different session must never see the previous session's export status.
  const [generation, setGeneration] = useState(scope.generation);
  if (generation !== scope.generation) {
    setGeneration(scope.generation);
    setState({ status: 'idle' });
  }

  const start = useCallback(
    async ({
      target,
      request,
      stillAllowed,
      onAccessLost,
    }: StartExportOptions) => {
      if (running.current) return;
      running.current = true;
      const abort = new AbortController();
      controller.current = abort;
      const live = () =>
        controller.current === abort &&
        !abort.signal.aborted &&
        scope.isCurrent();
      setState({ status: 'exporting' });
      try {
        const response = await runAuthorized((token) =>
          request(token, abort.signal),
        );
        // Re-check at the side effect, not only after the request resolved.
        if (!live()) return;
        if (stillAllowed && !stillAllowed()) {
          setState({ status: 'idle' });
          return;
        }
        const filename = exportFilename(target, response.contentDisposition);
        if (!filename) {
          setState({
            status: 'error',
            message: 'The export could not be prepared. Please try again.',
          });
          return;
        }
        const dispose = saveBlob(response.blob, filename);
        disposers.current.add(dispose);
        setState({ status: 'saved' });
      } catch (error) {
        if (!live() || isAbort(error)) return;
        if (
          target.kind === 'board' &&
          isApiError(error) &&
          (error.status === 403 || error.status === 404)
        )
          onAccessLost?.();
        setState({
          status: 'error',
          message: exportErrorMessage(error, target.kind),
        });
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          running.current = false;
        }
      }
    },
    [runAuthorized, scope],
  );

  /** Drops the result banner, e.g. after the selection changes. */
  const reset = useCallback(() => {
    if (!running.current) setState({ status: 'idle' });
  }, []);

  return { state, start, reset, isExporting: state.status === 'exporting' };
}
