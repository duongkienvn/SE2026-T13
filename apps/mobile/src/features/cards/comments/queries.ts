import { onlineManager, queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { hintTargets } from '../../../infrastructure/realtime/reconciliation.ts';
import {
  hasExplicitBoardMembership,
  clearBoardRoster,
} from '../../boards/members/queries.ts';
import { createBoardMembersApi } from '../../boards/members/api.ts';
import { isAccessDenied } from '../../boards/kanban-api.ts';
import type { KanbanBoard } from '../../boards/kanban-api.ts';
import { isUncertainColumnWrite } from '../../columns/mutations.ts';
import type { Card } from '../decoder.ts';
import { COMMENTS_LIMIT, createCommentsApi, type Comment } from './api.ts';
import {
  contentError,
  finalizeDraft,
  validSpans,
  type MentionDraft,
} from './mentions.ts';

export type CommentScope = {
  identity: SessionIdentity;
  boardId: string;
  cardId: string;
};
export function commentsOptions(
  data: MobileDataLayer,
  scope: CommentScope,
  page: number,
) {
  return queryOptions({
    queryKey: [
      ...queryKeys.comments(scope.identity, scope.boardId, scope.cardId),
      { page, limit: COMMENTS_LIMIT },
    ],
    queryFn: ({ signal }) =>
      createCommentsApi(
        data.api,
        scope.identity,
        scope.boardId,
        scope.cardId,
      ).list(page, signal),
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
  });
}
export function canWriteComments(
  board: KanbanBoard | undefined,
  card: Card | undefined,
) {
  return (
    !!board &&
    hasExplicitBoardMembership(board) &&
    board.capabilities.canWriteBoard &&
    !board.isArchived &&
    !!card &&
    !card.isArchived
  );
}
export const uncertainCommentWrite = isUncertainColumnWrite;
export type CommentCommand =
  | { kind: 'create'; draft: MentionDraft; rosterPages: number[] }
  | {
      kind: 'edit';
      draft: MentionDraft;
      rosterPages: number[];
      original: Comment;
      page: number;
    }
  | { kind: 'delete'; original: Comment; page: number };
const writes = new WeakMap<MobileDataLayer, Set<string>>();
function conflict(
  message = 'This comment changed. Review the latest version before saving.',
): never {
  throw new ApiError('http', { status: 409, code: 'COMMENT_CHANGED', message });
}
export async function runCommentWrite(
  data: MobileDataLayer,
  scope: CommentScope,
  command: CommentCommand,
  allowed: () => boolean,
  signal: AbortSignal,
) {
  const { identity, boardId, cardId } = scope;
  const key = queryKeys.comments(identity, boardId, cardId);
  data.assertCurrent(identity);
  const current = data.resources.capture(key, true);
  const rosterCurrent =
    command.kind !== 'delete' && command.draft.spans.length
      ? data.resources.capture(queryKeys.members(identity, boardId), false)
      : () => {};
  const guard = () => {
    data.assertCurrent(identity);
    current();
    rosterCurrent();
    if (signal.aborted)
      throw new ApiError('aborted', { requestStarted: false });
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
    if (
      !allowed() ||
      !canWriteComments(
        data.queryClient.getQueryData<KanbanBoard>(
          queryKeys.board(identity, boardId),
        ),
        data.queryClient.getQueryData<Card>(
          queryKeys.card(identity, boardId, cardId),
        ),
      )
    )
      throw new ApiError('http', {
        status: 403,
        message: 'Comments are read-only.',
      });
    if (
      command.kind !== 'create' &&
      command.original.authorId !== identity.userId
    )
      throw new ApiError('http', {
        status: 403,
        message: 'Only the comment author can change it.',
      });
  };
  guard();
  const lock = JSON.stringify(key);
  const pending = writes.get(data) ?? new Set<string>();
  writes.set(data, pending);
  if (pending.has(lock)) conflict('Wait for the comment change to finish.');
  pending.add(lock);
  const api = createCommentsApi(data.api, identity, boardId, cardId);
  let attempted = false;
  let committed = false;
  let needsReview = false;
  try {
    if (
      command.kind !== 'delete' &&
      (contentError(command.draft.text) ||
        !validSpans(command.draft.text, command.draft.spans) ||
        new Set(command.rosterPages).size > 10)
    )
      throw new ApiError('http', {
        status: 400,
        message: 'Enter 1–2000 characters, up to 20 mentions of 10 people.',
      });
    if (command.kind !== 'create') {
      const latest = await api.list(command.page, signal);
      guard();
      const actual = latest.data.find((row) => row.id === command.original.id);
      if (
        !actual ||
        actual.updatedAt !== command.original.updatedAt ||
        actual.content !== command.original.content ||
        JSON.stringify(actual.mentions) !==
          JSON.stringify(command.original.mentions)
      )
        conflict();
    }
    if (command.kind === 'delete') {
      attempted = true;
      await api.remove(command.original.id, signal);
      data.assertCurrent(identity);
      current();
      committed = true;
      return;
    }
    const names = new Map<string, string>();
    if (command.draft.spans.length) {
      // Fresh MOB-25 pages, using its exact cache/decoder/access boundary. A
      // removed/moved/renamed member requires reselection; never guess by name.
      for (const page of new Set(command.rosterPages)) {
        const result = await createBoardMembersApi(data.api, identity, boardId)
          .list(page, signal)
          .catch((error: unknown) => {
            if (isAccessDenied(error))
              clearBoardRoster(data, identity, boardId);
            throw error;
          });
        guard();
        for (const { user } of result.data)
          if (!user.isDeleted) names.set(user.id, user.displayName);
      }
    }
    const input = finalizeDraft(command.draft, names);
    guard();
    attempted = true;
    const result =
      command.kind === 'create'
        ? await api.create(input, signal)
        : await api.edit(command.original.id, input, signal);
    data.assertCurrent(identity);
    current();
    rosterCurrent();
    committed = true;
    return result;
  } catch (error) {
    needsReview =
      error instanceof ApiError && [403, 404, 409].includes(error.status);
    if (error instanceof ApiError && !attempted)
      throw new ApiError(error.kind, {
        ...error,
        message: error.message,
        requestStarted: false,
      });
    throw error;
  } finally {
    pending.delete(lock);
    if (
      sameIdentity(identity, data.getIdentity()) &&
      data.resources.readable(key)
    ) {
      const event =
        command.kind === 'create'
          ? 'comment:created'
          : command.kind === 'edit'
            ? 'comment:updated'
            : 'comment:deleted';
      const targets = hintTargets(identity, event, { boardId, cardId });
      // Post-commit refresh failure cannot turn 201/200/204 into a failed write.
      if (attempted || needsReview) {
        for (const queryKey of targets)
          void data.queryClient.cancelQueries({ queryKey });
        void data.invalidate(identity, targets).catch(() => undefined);
        if (!committed) {
          void data.queryClient.invalidateQueries({
            queryKey: queryKeys.board(identity, boardId),
            exact: true,
          });
          void data.queryClient.invalidateQueries({
            queryKey: queryKeys.card(identity, boardId, cardId),
            exact: true,
          });
        }
      }
    }
  }
}
