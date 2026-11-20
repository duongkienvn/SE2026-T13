import { useInfiniteQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import { useSessionManager } from '../../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import type { CardDetailContext } from '../detail/sections';
import { createAttachmentApi, type Attachment } from './api';
import { attachmentError, httpsUrl } from './policy';
import {
  attachmentGuard,
  attachmentOptions,
  refreshAttachments,
} from './queries';
import {
  clearPrivateAttachmentFiles,
  nativeTransferPorts,
  newAttachmentKey,
  previewPrivateFile,
  savePrivateDownload,
  selectPrivateFile,
  sharePrivateFile,
} from './native';
import {
  downloadPrivateFile,
  runUpload,
  type UploadJob,
  type UploadPhase,
} from './transfer';

export function useAttachments(context: CardDetailContext) {
  const data = useMobileData();
  return useInfiniteQuery({
    ...attachmentOptions(data, context),
    enabled: context.active,
  });
}
export function useAttachmentActions(context: CardDetailContext) {
  const data = useMobileData();
  const session = useSessionManager();
  const latest = useRef(context);
  const mounted = useRef(true);
  const task = useRef<{
    controller: AbortController;
    write: boolean;
    kind: string;
  } | null>(null);
  const upload = useRef<UploadJob | null>(null);
  const retention = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlOperation = useRef<{ payload: string; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [errorAt, setErrorAt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const viewer = useRef<(() => void) | null>(null);
  const viewerBackgrounded = useRef(false);
  const api = createAttachmentApi(data.api, context);
  const dispose = () => {
    if (retention.current) clearTimeout(retention.current);
    retention.current = null;
    upload.current?.file.dispose();
    upload.current = null;
  };
  const stop = () => {
    task.current?.controller.abort();
    const pendingId = upload.current?.uploadId;
    if (pendingId) void api.cancel(pendingId).catch(() => undefined);
    dispose();
    urlOperation.current = null;
  };
  useLayoutEffect(() => {
    mounted.current = true;
    latest.current = context;
    if (!context.active || (task.current?.write && !context.canEdit)) stop();
  });
  useLayoutEffect(() => {
    const teardown = data.resources.subscribeBoardTeardown((id) => {
      if (
        id === undefined ||
        id.toLowerCase() === context.boardId.toLowerCase()
      ) {
        stop();
        setPhase(null);
        setError(null);
        setMessage(null);
        setPending(false);
      }
    });
    const unbind = session.addLifecycleListener({
      onSessionEnd: () => {
        stop();
        clearPrivateAttachmentFiles();
      },
    });
    // Only this Card's attachments or the Board itself; a sibling section's
    // child 403/404 (for example an author-only comment edit) is not ours.
    const own = queryKeys.attachments(
      context.identity,
      context.boardId,
      context.cardId,
    );
    const denied = data.resources.subscribeDenied((id, key) => {
      if (
        id === context.boardId.toLowerCase() &&
        (key.length <= 6 ||
          own.every((part, index) => key[index] === part) ||
          !data.resources.readable(
            queryKeys.board(context.identity, context.boardId),
          ))
      )
        stop();
    });
    const background = AppState.addEventListener('change', (state) => {
      if (task.current?.kind === 'viewing') {
        if (state !== 'active') viewerBackgrounded.current = true;
        else if (viewerBackgrounded.current) viewer.current?.();
      }
      if (
        state !== 'active' &&
        task.current &&
        !['selecting', 'sharing', 'viewing'].includes(task.current.kind)
      ) {
        task.current.controller.abort();
        // Keep only the owned upload snapshot for an explicit same-key retry.
      }
    });
    return () => {
      mounted.current = false;
      stop();
      teardown();
      unbind();
      denied();
      background.remove();
    };
    // A section boundary remounts this hook on identity/Card changes.
  }, [
    data,
    session,
    context.identity.userId,
    context.identity.generation,
    context.boardId,
    context.cardId,
  ]);

  async function run(
    write: boolean,
    kind: string,
    operation: (signal: AbortSignal, check: () => void) => Promise<void>,
  ) {
    if (task.current) return false;
    const running = { controller: new AbortController(), write, kind };
    task.current = running;
    setPending(true);
    setError(null);
    setMessage(null);
    const alive = () =>
      mounted.current &&
      sameIdentity(context.identity, data.getIdentity()) &&
      latest.current.active;
    try {
      const check = attachmentGuard(
        data,
        context,
        write,
        () => latest.current.active && (!write || latest.current.canEdit),
        running.controller.signal,
      );
      check();
      await operation(running.controller.signal, check);
      check();
      return true;
    } catch (cause) {
      if (alive()) {
        const parent =
          cause instanceof ApiError &&
          ['CARD_ARCHIVED', 'CARD_NOT_FOUND'].includes(cause.code)
            ? queryKeys.card(context.identity, context.boardId, context.cardId)
            : cause instanceof ApiError && cause.code === 'BOARD_ARCHIVED'
              ? queryKeys.board(context.identity, context.boardId)
              : undefined;
        if (parent)
          void data.queryClient
            .invalidateQueries({ queryKey: parent, exact: true })
            .catch(() => undefined);
        // Never retain native errors that can contain local paths or signed URLs.
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError('http', { message: attachmentError(cause) }),
        );
        setErrorAt(Date.now());
        if (kind === 'upload' || kind === 'selecting')
          setPhase(running.controller.signal.aborted ? 'canceled' : 'failed');
      }
      return false;
    } finally {
      if (task.current === running) task.current = null;
      if (alive()) setPending(false);
      if (write) await refreshAttachments(data, context);
    }
  }
  async function uploadFile(select: boolean) {
    return run(true, select ? 'selecting' : 'upload', async (signal, check) => {
      if (select) {
        if (upload.current)
          throw new ApiError('http', {
            message:
              'Retry or cancel the current upload before selecting another file.',
          });
        setPhase('selecting');
        const selected = await selectPrivateFile(check, signal);
        try {
          check();
        } catch (cause) {
          selected?.dispose();
          throw cause;
        }
        if (!selected) {
          setPhase('canceled');
          return;
        }
        upload.current = {
          file: selected,
          key: newAttachmentKey(),
          transferAttempted: false,
        };
        const selectedJob = upload.current;
        // Retain a failed source only for an explicit same-key retry in this
        // section. Never outlive the maximum server intent lifetime locally.
        retention.current = setTimeout(() => {
          if (upload.current !== selectedJob) return;
          task.current?.controller.abort();
          if (selectedJob.uploadId)
            void api.cancel(selectedJob.uploadId).catch(() => undefined);
          dispose();
          if (sameIdentity(context.identity, data.getIdentity())) {
            setPhase('failed');
            setError(
              new ApiError('http', { code: 'ATTACHMENT_UPLOAD_EXPIRED' }),
            );
          }
        }, 15 * 60_000);
      }
      const job = upload.current;
      if (!job) throw new ApiError('http', { message: 'Select a file first.' });
      if (task.current) task.current.kind = 'upload';
      await runUpload(
        api,
        context.boardId,
        context.cardId,
        job,
        nativeTransferPorts,
        signal,
        check,
        setPhase,
      );
      check();
      dispose();
      setPhase('complete');
      setMessage('File verified and attached.');
    });
  }
  async function cancelUpload() {
    const job = upload.current;
    task.current?.controller.abort();
    dispose();
    setPhase('canceled');
    setMessage(null);
    if (job?.uploadId && sameIdentity(context.identity, data.getIdentity())) {
      try {
        await api.cancel(job.uploadId);
      } catch (cause) {
        if (sameIdentity(context.identity, data.getIdentity()))
          setError(cause instanceof ApiError ? cause : new ApiError('network'));
      } finally {
        await refreshAttachments(data, context);
      }
    }
  }
  return {
    pending,
    phase,
    error,
    errorAt,
    message,
    viewing,
    closeViewer: () => viewer.current?.(),
    hasUpload: Boolean(upload.current),
    hasUncertainUrl: Boolean(urlOperation.current),
    clearError: () => setError(null),
    discardUrl: () => {
      urlOperation.current = null;
    },
    createUrl: (input: { url: string; displayName?: string }) =>
      run(true, 'url', async (signal, check) => {
        const payload = JSON.stringify(input);
        if (urlOperation.current && urlOperation.current.payload !== payload)
          throw new ApiError('http', {
            message: 'Retry the original link first; its result is uncertain.',
          });
        const operation = urlOperation.current ?? {
          payload,
          key: newAttachmentKey(),
        };
        urlOperation.current = operation;
        try {
          await api.create(input, operation.key, signal);
        } catch (cause) {
          if (
            cause instanceof ApiError &&
            cause.kind === 'http' &&
            cause.status >= 400 &&
            cause.status < 500
          )
            urlOperation.current = null;
          throw cause;
        }
        check();
        urlOperation.current = null;
      }),
    edit: (row: Attachment, input: { url?: string; displayName: string }) =>
      run(true, 'edit', async (signal, check) => {
        await api.edit(row, input, signal);
        check();
      }),
    remove: (row: Attachment) =>
      run(true, 'remove', async (signal, check) => {
        await api.remove(row, signal);
        check();
      }),
    select: () => uploadFile(true),
    retryUpload: () => uploadFile(false),
    cancelUpload,
    share: (row: Attachment) =>
      run(false, 'download', async (signal, check) => {
        await downloadPrivateFile(
          api,
          row,
          signal,
          check,
          savePrivateDownload,
          async (uri, mime) => {
            check();
            if (task.current) task.current.kind = 'sharing';
            await sharePrivateFile(uri, mime, check);
          },
        );
      }),
    view: (row: Attachment) =>
      run(false, 'download', async (signal, check) => {
        await downloadPrivateFile(
          api,
          row,
          signal,
          check,
          savePrivateDownload,
          async (uri, mime) => {
            check();
            if (task.current) task.current.kind = 'viewing';
            viewerBackgrounded.current = false;
            const closed = new Promise<void>((resolve) => {
              viewer.current = resolve;
            });
            const close = () => viewer.current?.();
            signal.addEventListener('abort', close, { once: true });
            setViewing(true);
            try {
              await previewPrivateFile(uri, mime, check);
              check();
              // Expo File.preview resolves at presentation/handoff, not dismissal.
              // Keep bytes until Android returns or the user explicitly closes the
              // retained preview on iOS; abort/session teardown still deletes now.
              await closed;
              check();
            } finally {
              signal.removeEventListener('abort', close);
              viewer.current = null;
              if (mounted.current) setViewing(false);
            }
          },
        );
      }),
    openLink: (row: Attachment) =>
      run(false, 'link', async (_signal, check) => {
        if (row.kind !== 'URL' || !row.url)
          throw new ApiError('invalid-response');
        const url = httpsUrl(row.url);
        if (!(await Linking.canOpenURL(url)))
          throw new ApiError('http', {
            message: 'This HTTPS link could not be opened on your device.',
          });
        check();
        await Linking.openURL(url);
        check();
      }),
    cancelDownload: () => task.current?.controller.abort(),
    reload: async (row: Attachment) => {
      let value: Attachment | undefined;
      const ok = await run(false, 'reload', async (signal, check) => {
        value = await api.get(row.id, signal);
        check();
      });
      return ok ? value : undefined;
    },
  };
}
