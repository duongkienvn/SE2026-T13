import { infiniteQueryOptions, onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { nextPage } from '../../../infrastructure/query/pagination.ts';
import { hintTargets } from '../../../infrastructure/realtime/reconciliation.ts';
import type { KanbanBoard } from '../../boards/kanban-api.ts';
import type { Card } from '../decoder.ts';
import { createAttachmentApi, type AttachmentScope } from './api.ts';

export function attachmentOptions(
  data: MobileDataLayer,
  scope: AttachmentScope,
) {
  const { identity, boardId, cardId } = scope;
  const api = createAttachmentApi(data.api, scope);
  return infiniteQueryOptions({
    queryKey: queryKeys.attachments(identity, boardId, cardId),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => api.list(pageParam, signal),
    getNextPageParam: (page) => nextPage(page.meta),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
}
export function attachmentGuard(
  data: MobileDataLayer,
  scope: AttachmentScope,
  write: boolean,
  allowed: () => boolean,
  signal: AbortSignal,
) {
  const { identity, boardId, cardId } = scope;
  const key = queryKeys.attachments(identity, boardId, cardId);
  const current = data.resources.capture(key, write);
  return () => {
    data.assertCurrent(identity);
    current();
    if (signal.aborted) throw new ApiError('aborted');
    if (!allowed()) throw new ApiError('session-changed');
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
    if (write) {
      const board = data.queryClient.getQueryData<KanbanBoard>(
        queryKeys.board(identity, boardId),
      );
      const card = data.queryClient.getQueryData<Card>(
        queryKeys.card(identity, boardId, cardId),
      );
      if (
        !board?.capabilities.canWriteBoard ||
        board.isArchived ||
        !card ||
        card.isArchived
      )
        throw new ApiError('http', {
          status: 403,
          message: 'Attachments are read-only.',
        });
    }
  };
}
export async function refreshAttachments(
  data: MobileDataLayer,
  scope: AttachmentScope,
) {
  const { identity, boardId, cardId } = scope;
  try {
    data.assertCurrent(identity);
    if (
      !data.resources.readable(queryKeys.attachments(identity, boardId, cardId))
    )
      return;
    const targets = hintTargets(identity, 'card:updated', {
      boardId,
      cardId,
      changeScope: 'attachments',
    });
    await Promise.all(
      targets.map((queryKey) => data.queryClient.cancelQueries({ queryKey })),
    );
    await data.invalidate(identity, targets);
  } catch {
    /* A failed read never turns a committed mutation into a failed write. */
  }
}
