import { BoardRole } from '@kanban/shared';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import type { LifecycleBoard } from '../lifecycle-api.ts';
import { createBoardLifecycleApi } from '../lifecycle-api.ts';
import { decodeBoard } from '../api.ts';
import { isAccessDenied } from '../kanban-api.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import {
  boardMemberEmail,
  createBoardMembersApi,
  type BoardMember,
} from './api.ts';
import {
  boardMembershipPermissions,
  boardMembershipAccessKey,
  boardPolicyKey,
  clearBoardRoster,
  refreshBoardMembership,
} from './queries.ts';

export function memberActionBlock(
  member: BoardMember,
  board: LifecycleBoard,
  actorId: string,
  knownOwners?: number,
) {
  if (member.user.id === board.createdById)
    return 'The Board creator cannot be demoted or removed.';
  if (member.user.id === actorId)
    return 'You cannot demote or remove yourself.';
  if (
    member.role === BoardRole.OWNER &&
    knownOwners !== undefined &&
    knownOwners <= 1
  )
    return 'The Board must retain at least one OWNER.';
  return undefined;
}

export type BoardMembershipCommand =
  | { kind: 'add'; email: string }
  | { kind: 'role'; member: BoardMember; role: BoardRole; page: number }
  | { kind: 'remove'; member: BoardMember; page: number };

const locks = new WeakMap<MobileDataLayer, Set<string>>();

export function uncertainBoardMembershipWrite(error: unknown) {
  return (
    error instanceof ApiError &&
    error.requestStarted === true &&
    ([
      'network',
      'offline',
      'timeout',
      'aborted',
      'invalid-response',
      'session-changed',
    ].includes(error.kind) ||
      error.status >= 500)
  );
}

/** One command, no retries; re-read role/policy and the selected membership before writing. */
export async function changeBoardMembership(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  command: BoardMembershipCommand,
  signal: AbortSignal,
) {
  data.assertCurrent(identity);
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  if (signal.aborted) throw new ApiError('aborted');
  if (command.kind === 'add') boardMemberEmail(command.email);
  const key = JSON.stringify([identity.userId, identity.generation, boardId]);
  const pending = locks.get(data) ?? new Set<string>();
  locks.set(data, pending);
  if (pending.has(key))
    throw new ApiError('http', {
      status: 409,
      message: 'A Board membership change is already saving.',
    });
  pending.add(key);
  let commandStarted = false;
  let workspaceId: string | undefined;
  try {
    const current = data.resources.captureBoardProbe(boardId);
    const board = await data.api.json(
      `/boards/${encodeURIComponent(boardId)}`,
      decodeBoard,
      { identity, signal, expectedStatus: 200, retries: 0 },
    );
    data.assertCurrent(identity);
    current();
    if (board.id !== boardId || !board.capabilities.canReadBoard)
      throw new ApiError('http', { status: 404 });
    if (!board.currentUserRole) clearBoardRoster(data, identity, boardId);
    data.resources.confirmBoard(
      boardId,
      !board.isArchived && board.capabilities.canWriteBoard,
      board.workspaceId,
    );
    data.queryClient.setQueryData(
      boardMembershipAccessKey(identity, boardId),
      board,
    );
    workspaceId = board.workspaceId;
    const policy = await createBoardLifecycleApi(data.api, identity).policy(
      boardId,
      signal,
    );
    data.assertCurrent(identity);
    current();
    data.queryClient.setQueryData(boardPolicyKey(identity, boardId), policy);
    if (signal.aborted) throw new ApiError('aborted');
    const permissions = boardMembershipPermissions(board, policy);
    if (!(command.kind === 'add' ? permissions.canAdd : permissions.canChange))
      throw new ApiError('http', {
        status: 403,
        message:
          'Current Board role or Workspace policy does not allow this change.',
      });
    const api = createBoardMembersApi(data.api, identity, boardId);
    if (command.kind !== 'add') {
      const block = memberActionBlock(command.member, board, identity.userId);
      if (block) throw new ApiError('http', { status: 409, message: block });
      const page = await api.list(command.page, signal);
      const current = page.data.find(
        ({ user }) => user.id === command.member.user.id,
      );
      if (
        !current ||
        current.id !== command.member.id ||
        current.role !== command.member.role
      )
        throw new ApiError('http', {
          status: 409,
          message:
            'This membership changed. Review the latest members before trying again.',
        });
      if (command.kind === 'role' && command.role === current.role)
        throw new ApiError('http', {
          status: 409,
          message: 'Choose a different Board role.',
        });
    }
    data.assertCurrent(identity);
    current();
    if (signal.aborted || !onlineManager.isOnline())
      throw new ApiError(signal.aborted ? 'aborted' : 'offline');
    commandStarted = true;
    const result =
      command.kind === 'add'
        ? await api.add(command.email, signal)
        : command.kind === 'role'
          ? await api.changeRole(command.member.user.id, command.role, signal)
          : await api.remove(command.member.user.id, signal);
    data.assertCurrent(identity);
    // Do not turn a committed mutation into an error because a later GET failed.
    void refreshBoardMembership(
      data,
      identity,
      boardId,
      board.workspaceId,
    ).catch(() => undefined);
    return result;
  } catch (error) {
    if (
      !workspaceId &&
      sameIdentity(identity, data.getIdentity()) &&
      isAccessDenied(error)
    ) {
      clearBoardRoster(data, identity, boardId);
      data.resources.denied(queryKeys.board(identity, boardId));
    }
    if (sameIdentity(identity, data.getIdentity()) && workspaceId)
      void refreshBoardMembership(data, identity, boardId, workspaceId).catch(
        () => undefined,
      );
    // A failed preflight GET is not an uncertain POST/PATCH/DELETE outcome.
    if (!commandStarted && error instanceof ApiError)
      throw new ApiError(error.kind, {
        ...error,
        message: error.message,
        requestStarted: false,
      });
    throw error;
  } finally {
    pending.delete(key);
  }
}
