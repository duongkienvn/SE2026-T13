import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../../lib/api-client';
import { retryUnlessClientError } from '../../../lib/query-client';
import { useAuth } from '../../auth/useAuth';
import { boardKeys } from '../../boards/query-keys';
import {
  addUrlAttachment,
  ATTACHMENT_POLICY,
  cancelUpload,
  completeUpload,
  createUpload,
  listAttachments,
  removeAttachment,
  transferFile,
  updateAttachment,
} from './api';

/** Under the card's key: `card:updated` and access loss reach it too. */
export const attachmentKeys = {
  all: (boardId: string, cardId: string) =>
    [...boardKeys.card(boardId, cardId), 'attachments'] as const,
  page: (boardId: string, cardId: string, page: number) =>
    [...attachmentKeys.all(boardId, cardId), page] as const,
};

export function useAttachments(boardId: string, cardId: string, page: number) {
  const { runAuthorized } = useAuth();
  return useQuery({
    queryKey: attachmentKeys.page(boardId, cardId, page),
    queryFn: ({ signal }) =>
      runAuthorized((token) =>
        listAttachments(token, boardId, cardId, page, signal),
      ),
    retry: retryUnlessClientError,
    placeholderData: keepPreviousData,
  });
}

function useRefreshAttachments(boardId: string, cardId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({
      queryKey: [...boardKeys.cards(boardId), 'preview-summaries'],
    });
    return client.invalidateQueries({
      queryKey: attachmentKeys.all(boardId, cardId),
    });
  };
}

export function useAddUrlAttachment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const refresh = useRefreshAttachments(boardId, cardId);
  return useMutation({
    mutationFn: ({
      idempotencyKey,
      ...input
    }: {
      url: string;
      displayName?: string;
      idempotencyKey: string;
    }) =>
      runAuthorized((token) =>
        addUrlAttachment(token, boardId, cardId, input, idempotencyKey),
      ),
    onSettled: refresh,
  });
}

export function useUpdateAttachment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const refresh = useRefreshAttachments(boardId, cardId);
  return useMutation({
    mutationFn: ({
      attachmentId,
      ...input
    }: {
      attachmentId: string;
      expectedRevision: number;
      url?: string;
      displayName?: string;
    }) =>
      runAuthorized((token) =>
        updateAttachment(token, boardId, cardId, attachmentId, input),
      ),
    onSettled: refresh,
  });
}

export function useRemoveAttachment(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const refresh = useRefreshAttachments(boardId, cardId);
  return useMutation({
    mutationFn: ({
      attachmentId,
      expectedRevision,
    }: {
      attachmentId: string;
      expectedRevision: number;
    }) =>
      runAuthorized((token) =>
        removeAttachment(
          token,
          boardId,
          cardId,
          attachmentId,
          expectedRevision,
        ),
      ),
    onSettled: refresh,
  });
}

const VERIFY_ERRORS = [
  'ATTACHMENT_CONTENT_INVALID',
  'ATTACHMENT_IMAGE_INVALID',
  'ATTACHMENT_PDF_INVALID',
  'ATTACHMENT_PDF_UNSUPPORTED',
  'ATTACHMENT_TEXT_INVALID',
  'ATTACHMENT_CONTENT_CONFLICT',
  'ATTACHMENT_SIZE_MISMATCH',
];
const TYPE_ERRORS = ['ATTACHMENT_TYPE_UNSUPPORTED', 'ATTACHMENT_TYPE_MISMATCH'];
/** Replaying the intent cannot recover these; a new upload is needed. */
const TERMINAL_INTENT_ERRORS = [
  'ATTACHMENT_UPLOAD_EXPIRED',
  'ATTACHMENT_UPLOAD_REVOKED',
  'ATTACHMENT_IDEMPOTENCY_CONFLICT',
  'ATTACHMENT_ALREADY_COMPLETED',
];

export function attachmentErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    const { code, status } = error;
    if (code === 'ATTACHMENT_FILES_NOT_AVAILABLE')
      return 'File uploads are not available on this server. Link attachments still work.';
    if (code === 'ATTACHMENT_STORAGE_UNAVAILABLE')
      return 'File storage is unavailable right now. Try again later.';
    if (code === 'ATTACHMENT_LIMIT_REACHED')
      return 'Attachment limit reached: up to 20 per card (uploads in progress count) and 100 MB of files per board.';
    if (code === 'ATTACHMENT_TOO_LARGE' || status === 413)
      return 'Files can be at most 10 MB.';
    if (TYPE_ERRORS.includes(code) || status === 415)
      return 'Only PNG, JPEG, WebP, PDF and plain-text files are supported, and the file must match its extension.';
    if (VERIFY_ERRORS.includes(code) || status === 422)
      return 'The file did not pass the server’s format check, so it was not attached. This is a format check, not a virus scan.';
    if (code === 'ATTACHMENT_NOT_UPLOADED')
      return 'The file did not reach storage. Try the upload again.';
    if (TERMINAL_INTENT_ERRORS.includes(code))
      return 'This upload expired. Start it again.';
    if (
      code === 'ATTACHMENT_UPLOAD_BUSY' ||
      code === 'ATTACHMENT_PROCESSOR_BUSY'
    )
      return 'The server is busy checking files. Try again in a moment.';
    if (code === 'ATTACHMENT_REVISION_CONFLICT')
      return 'Someone else changed this attachment. The latest version is shown; check it and try again.';
    if (code === 'ATTACHMENT_NOT_FOUND' || code === 'ATTACHMENT_REMOVED')
      return 'This attachment was removed.';
    if (code === 'CARD_ARCHIVED')
      return 'This card was archived, so its attachments can no longer change.';
    if (code === 'BOARD_ARCHIVED')
      return 'This board has been archived, so attachments can no longer change.';
    if (code === 'VALIDATION_FAILED')
      return 'Check the details: links must start with https:// and names take 1–120 characters.';
    if (status === 403 || status === 404)
      return 'You no longer have access to this card’s attachments.';
    if (status === 429)
      return 'Too many requests. Wait a moment and try again.';
    if (status === 0)
      return 'You appear to be offline. Check your connection and try again.';
    if (status === 503) return 'The server is busy. Try again in a moment.';
  }
  return 'Something went wrong. Try again.';
}

/** Friendly early check; the server verifies type, size and content anyway. */
export function checkFile(file: File): string | undefined {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const extensions = ATTACHMENT_POLICY.types[file.type];
  if (!extensions || !extensions.includes(extension))
    return 'Only PNG, JPEG, WebP, PDF and plain-text (.txt) files are supported.';
  if (file.size < 1) return 'This file is empty.';
  if (file.size > ATTACHMENT_POLICY.maximumFileBytes)
    return 'Files can be at most 10 MB.';
  return undefined;
}

export type UploadPhase =
  'idle' | 'preparing' | 'transferring' | 'verifying' | 'done' | 'failed';

export interface UploadState {
  phase: UploadPhase;
  fileName?: string;
  error?: string;
  /** Server error code of a failed upload. */
  code?: string;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/**
 * One file at a time: intent → transfer → server verification. Success is
 * shown only after verification returns ACTIVE metadata. The short-lived
 * grant lives in this function only, never in a cache, URL or log.
 */
export function useAttachmentUpload(boardId: string, cardId: string) {
  const { runAuthorized } = useAuth();
  const refresh = useRefreshAttachments(boardId, cardId);
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const run = useRef<{
    controller: AbortController;
    uploadId?: string;
    file: File;
    key: string;
  } | null>(null);

  const forget = useCallback(
    (current: NonNullable<typeof run.current>) => {
      if (!current.uploadId) return;
      const uploadId = current.uploadId;
      current.uploadId = undefined;
      // Best effort: an unfinished intent otherwise expires on its own.
      void runAuthorized((token) =>
        cancelUpload(token, boardId, cardId, uploadId),
      ).catch(() => undefined);
    },
    [runAuthorized, boardId, cardId],
  );

  const start = useCallback(
    async (file: File, retry = false) => {
      const previous = run.current;
      const key =
        retry && previous?.file === file ? previous.key : crypto.randomUUID();
      const controller = new AbortController();
      const current = {
        controller,
        file,
        key,
        uploadId: undefined as string | undefined,
      };
      run.current = current;
      const { signal } = controller;
      const update = (next: UploadState) => {
        if (run.current === current) setState(next);
      };
      try {
        update({ phase: 'preparing', fileName: file.name });
        const intent = await runAuthorized((token) =>
          createUpload(
            token,
            boardId,
            cardId,
            {
              filename: file.name,
              contentType: file.type,
              fileSize: file.size,
            },
            key,
            signal,
          ),
        );
        current.uploadId = intent.uploadId;
        if (intent.upload) {
          update({ phase: 'transferring', fileName: file.name });
          await runAuthorized((token) =>
            transferFile(intent, file, boardId, cardId, token, signal),
          );
        }
        update({ phase: 'verifying', fileName: file.name });
        for (let attempt = 0; ; attempt++) {
          try {
            await runAuthorized((token) =>
              completeUpload(token, boardId, cardId, intent.uploadId, signal),
            );
            break;
          } catch (error) {
            const busy =
              isApiError(error) &&
              (error.code === 'ATTACHMENT_UPLOAD_BUSY' ||
                error.code === 'ATTACHMENT_PROCESSOR_BUSY');
            if (!busy || attempt >= 3) throw error;
            await wait(1000 * 2 ** attempt, signal);
          }
        }
        current.uploadId = undefined;
        update({ phase: 'done', fileName: file.name });
        void refresh();
      } catch (error) {
        if (signal.aborted) return;
        if (
          isApiError(error) &&
          (TERMINAL_INTENT_ERRORS.includes(error.code) ||
            [413, 415, 422].includes(error.status))
        ) {
          forget(current);
          current.key = crypto.randomUUID(); // A retry starts a new upload.
        }
        update({
          phase: 'failed',
          fileName: file.name,
          error: attachmentErrorMessage(error),
          code: isApiError(error) ? error.code : undefined,
        });
      }
    },
    [runAuthorized, boardId, cardId, refresh, forget],
  );

  const cancel = useCallback(() => {
    const current = run.current;
    if (!current) return;
    current.controller.abort();
    forget(current);
    run.current = null;
    setState({ phase: 'idle' });
  }, [forget]);

  const retry = useCallback(() => {
    const current = run.current;
    if (current) void start(current.file, true);
  }, [start]);

  const reset = useCallback(() => {
    run.current = null;
    setState({ phase: 'idle' });
  }, []);

  // Leaving the card (or losing access) stops the transfer and its intent.
  useEffect(
    () => () => {
      const current = run.current;
      if (!current) return;
      current.controller.abort();
      forget(current);
    },
    [forget],
  );

  return {
    state,
    start: (file: File) => void start(file),
    cancel,
    retry,
    reset,
  };
}
