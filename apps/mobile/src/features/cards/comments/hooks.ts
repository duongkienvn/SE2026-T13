import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import {
  boardMembersOptions,
  boardMembershipAccessOptions,
  hasExplicitBoardMembership,
} from '../../boards/members';
import { clearBoardRoster } from '../../boards/members/queries';
import { isAccessDenied } from '../../boards/kanban-api';
import type { CardDetailContext } from '../detail/sections';
import {
  commentsOptions,
  runCommentWrite,
  type CommentCommand,
} from './queries';

/** Page-aware consumers of MOB-25, never a parallel member directory. */
export function useComments(context: CardDetailContext, page: number) {
  const data = useMobileData();
  const [rosterPages, setRosterPages] = useState(1);
  const [rosterDenied, setRosterDenied] = useState(false);
  const explicit = hasExplicitBoardMembership(context.board);
  const previousGrant = useRef(explicit);
  useLayoutEffect(() => {
    if (!explicit) clearBoardRoster(data, context.identity, context.boardId);
    if (previousGrant.current && !explicit) {
      const key = queryKeys.comments(
        context.identity,
        context.boardId,
        context.cardId,
      );
      data.cancelResourceRequests(key);
      data.evict(context.identity, [key]);
      // The new Board context may still authorize a Workspace-visible read.
      // Only a fresh, fenced REST read may replace the member projection.
      void data.invalidate(context.identity, [key]).catch(() => undefined);
    }
    previousGrant.current = explicit;
  }, [
    data,
    explicit,
    context.identity.userId,
    context.identity.generation,
    context.boardId,
    context.cardId,
  ]);
  useLayoutEffect(
    () =>
      data.resources.subscribeDenied((boardId, key) => {
        if (boardId === context.boardId && key[6] === 'members')
          setRosterDenied(true);
      }),
    [data, context.boardId],
  );
  useEffect(() => {
    if (!explicit) setRosterDenied(false);
  }, [explicit]);
  const roster = useQueries({
    queries: Array.from({ length: explicit ? rosterPages : 0 }, (_, index) => ({
      ...boardMembersOptions(
        data,
        context.identity,
        context.boardId,
        index + 1,
      ),
      enabled: context.active && explicit && !rosterDenied,
    })),
  });
  const denied =
    rosterDenied ||
    roster.some(
      (query) =>
        isAccessDenied(query.error) ||
        (query.error instanceof ApiError &&
          query.error.code === 'RESOURCE_ACCESS_CHANGED'),
    );
  const available =
    explicit &&
    !denied &&
    data.resources.readable(queryKeys.board(context.identity, context.boardId));
  const loadedMembers = available
    ? roster.flatMap((query, index) =>
        !query.isError && !query.isFetching && query.isFetchedAfterMount
          ? (query.data?.data ?? []).map((member) => ({
              member,
              page: index + 1,
            }))
          : [],
      )
    : [];
  const members = [
    ...new Map(loadedMembers.map((row) => [row.member.user.id, row])).values(),
  ];
  const comments = useQuery({
    ...commentsOptions(data, context, page),
    enabled: context.active,
  });
  const last = roster.at(-1);
  return {
    comments,
    members,
    roster,
    rosterPages,
    available,
    denied,
    async recheckMembers() {
      const board = await data.queryClient.fetchQuery(
        boardMembershipAccessOptions(data, context.identity, context.boardId),
      );
      data.assertCurrent(context.identity);
      if (!hasExplicitBoardMembership(board) || !context.active) return;
      const results = await Promise.all(roster.map((query) => query.refetch()));
      data.assertCurrent(context.identity);
      if (results.every((result) => result.isSuccess)) setRosterDenied(false);
    },
    hasMoreMembers:
      !!last?.data && last.data.meta.page < last.data.meta.totalPages,
    loadMembers: () => {
      if (last?.isSuccess && !last.isFetching)
        setRosterPages((value) => value + 1);
    },
  };
}

export function useCommentMutation(
  context: CardDetailContext,
  enabled: boolean,
) {
  const data = useMobileData();
  const permission = useRef(enabled && context.active && context.canEdit);
  const job = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    permission.current = enabled && context.active && context.canEdit;
  }, [enabled, context.active, context.canEdit]);
  useEffect(() => () => job.current?.abort(), []);
  async function run(command: CommentCommand) {
    if (job.current || !permission.current) return false;
    const controller = new AbortController();
    job.current = controller;
    setPending(true);
    try {
      const result = await runCommentWrite(
        data,
        context,
        command,
        () => permission.current,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !sameIdentity(context.identity, data.getIdentity())
      )
        throw new ApiError('session-changed');
      return { result };
    } finally {
      job.current = null;
      if (
        !controller.signal.aborted &&
        sameIdentity(context.identity, data.getIdentity())
      )
        setPending(false);
    }
  }
  return { run, pending };
}
