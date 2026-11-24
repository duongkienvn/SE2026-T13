import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useCooldown } from '../auth/runtime';
import { useAccountEnvironment } from '../profile/environment';
import { downloadExport, exportError, type ExportTarget } from './model';
import {
  exportStorageAvailable,
  openExport,
  savePrivateExport,
  shareExport,
  type PrivateExportFile,
} from './native';

export type ExportPhase =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'downloading';
      readonly received: number;
      readonly total?: number;
    }
  | { readonly kind: 'canceled' }
  | {
      readonly kind: 'ready';
      readonly filename: string;
      readonly size: number;
      /** What the last explicit handoff did. Never "saved". */
      readonly handoff?: 'offered' | 'share-unavailable' | 'open-unavailable';
    }
  | { readonly kind: 'removed'; readonly failed: boolean }
  | {
      readonly kind: 'error';
      readonly message: string;
      /** Server refused access: the caller must hide the export affordance. */
      readonly denied: boolean;
    };

/**
 * One export per screen and identity. Bytes are held only inside `start` until
 * the private file is written; React state never holds export content.
 */
export function useExport(identity: SessionIdentity) {
  const data = useMobileData(),
    manager = useSessionManager(),
    { online } = useAccountEnvironment();
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' }),
    [handing, setHanding] = useState(false),
    [until, setUntil] = useState(0);
  const cooldown = useCooldown(until);
  const controller = useRef<AbortController | null>(null),
    file = useRef<{ value: PrivateExportFile; mimeType: string } | null>(null),
    alive = useRef(true);
  const drop = useCallback(() => {
    const current = file.current;
    file.current = null;
    return current ? current.value.dispose() : true;
  }, []);
  const abort = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);
  useEffect(() => {
    alive.current = true;
    const stop = manager.addLifecycleListener({
      onSessionEnd: () => {
        abort();
        drop();
      },
    });
    return () => {
      alive.current = false;
      stop();
      abort();
      drop();
    };
  }, [manager, abort, drop]);
  const check = (signal?: AbortSignal) => {
    data.assertCurrent(identity);
    if (!alive.current || signal?.aborted) throw new ApiError('aborted');
  };
  const busy = phase.kind === 'downloading' || handing;
  return {
    phase,
    online,
    cooldown,
    handing,
    busy,
    async start(target: ExportTarget) {
      if (controller.current || handing || cooldown) return;
      if (!online) {
        setPhase({
          kind: 'error',
          message: exportError(new ApiError('offline'), target),
          denied: false,
        });
        return;
      }
      if (!exportStorageAvailable()) {
        setPhase({
          kind: 'error',
          message: exportError(
            new ApiError('http', { code: 'PRIVATE_STORAGE_UNAVAILABLE' }),
            target,
          ),
          denied: false,
        });
        return;
      }
      // A new export replaces any previous private file first.
      drop();
      const current = new AbortController();
      controller.current = current;
      setPhase({ kind: 'downloading', received: 0 });
      try {
        check(current.signal);
        const result = await downloadExport(
          data.api,
          identity,
          target,
          current.signal,
          (received, total) => {
            if (alive.current && controller.current === current)
              setPhase({ kind: 'downloading', received, total });
          },
        );
        check(current.signal);
        const saved = savePrivateExport(result.bytes, result.filename);
        try {
          check(current.signal);
        } catch (stale) {
          saved.dispose();
          throw stale;
        }
        file.current = { value: saved, mimeType: result.mimeType };
        setPhase({
          kind: 'ready',
          filename: result.filename,
          size: result.bytes.byteLength,
        });
      } catch (failure) {
        if (!alive.current || !manager.isCurrent(identity.generation)) return;
        if (current.signal.aborted) {
          setPhase({ kind: 'canceled' });
          return;
        }
        if (failure instanceof ApiError && failure.status === 429)
          setUntil(
            Date.now() +
              (Number.isFinite(failure.retryAfterMs)
                ? Math.max(5_000, failure.retryAfterMs!)
                : 60_000),
          );
        setPhase({
          kind: 'error',
          message: exportError(failure, target),
          denied:
            failure instanceof ApiError &&
            (failure.status === 403 ||
              failure.status === 404 ||
              failure.code === 'RESOURCE_ACCESS_CHANGED'),
        });
      } finally {
        if (controller.current === current) controller.current = null;
      }
    },
    cancel() {
      if (controller.current) abort();
    },
    async handoff(kind: 'share' | 'open') {
      const current = file.current;
      if (!current || handing || phase.kind !== 'ready') return;
      setHanding(true);
      try {
        const result = await (kind === 'share' ? shareExport : openExport)(
          current.value.uri,
          current.mimeType,
          () => check(),
        );
        if (alive.current && file.current === current)
          setPhase((previous) =>
            previous.kind === 'ready'
              ? {
                  ...previous,
                  handoff:
                    result === 'offered'
                      ? 'offered'
                      : kind === 'share'
                        ? 'share-unavailable'
                        : 'open-unavailable',
                }
              : previous,
          );
      } catch {
        if (alive.current && file.current === current)
          setPhase((previous) =>
            previous.kind === 'ready'
              ? {
                  ...previous,
                  handoff:
                    kind === 'share' ? 'share-unavailable' : 'open-unavailable',
                }
              : previous,
          );
      } finally {
        if (alive.current) setHanding(false);
      }
    },
    remove() {
      if (handing || phase.kind === 'downloading') return false;
      if (phase.kind !== 'ready') return exportStorageAvailable();
      const removed = drop();
      setPhase({ kind: 'removed', failed: !removed });
      return removed;
    },
  };
}
export type ExportController = ReturnType<typeof useExport>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
