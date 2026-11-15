import {
  BoardVisibility,
  type StarterBoardRemovalPreview,
} from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeBoard } from './api.ts';

export type LifecycleBoard = ReturnType<typeof decodeBoard>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}

/** Effective Board policy for the current actor (GET /boards/:id/policy-capabilities). */
export function decodeBoardPolicy(value: unknown) {
  const row = record(value);
  const flags = [
    'canInviteMembers',
    'canChangeMembership',
    'canChangeVisibility',
  ] as const;
  if (flags.some((flag) => typeof row[flag] !== 'boolean'))
    throw invalidResponse(200);
  return {
    canInviteMembers: row.canInviteMembers as boolean,
    canChangeMembership: row.canChangeMembership as boolean,
    canChangeVisibility: row.canChangeVisibility as boolean,
  };
}

export type BoardPolicy = ReturnType<typeof decodeBoardPolicy>;

const phrases = {
  false: 'REMOVE SAMPLE BOARD',
  true: 'DELETE MY CUSTOMIZED BOARD',
} as const;

/** Server-issued review; the phrase must match the customization state exactly. */
export function decodeSamplePreview(
  value: unknown,
): StarterBoardRemovalPreview {
  const row = record(value);
  if (
    typeof row.boardName !== 'string' ||
    !row.boardName.trim() ||
    typeof row.isCustomized !== 'boolean' ||
    typeof row.version !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.version) ||
    row.confirmation !== phrases[`${row.isCustomized}`]
  )
    throw invalidResponse(200);
  return {
    boardName: row.boardName,
    isCustomized: row.isCustomized,
    version: row.version,
    confirmation: phrases[`${row.isCustomized}`],
  };
}

export const visibilityOptions = [
  {
    value: BoardVisibility.PRIVATE,
    label: 'Private',
    hint: 'Only people added to this board can open it.',
  },
  {
    value: BoardVisibility.WORKSPACE_VISIBLE,
    label: 'Workspace',
    hint: 'Every workspace member can open it read-only. Only board members can edit.',
  },
] as const;

export function visibilityLabel(value: BoardVisibility) {
  return visibilityOptions.find((option) => option.value === value)!.label;
}

/** Board lifecycle commands. The server authorizes each one; nothing is granted locally. */
export function createBoardLifecycleApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const path = (id: string) => `/boards/${encodeURIComponent(id)}`;
  const resourceKey = (id: string) => queryKeys.board(identity, id);
  const result =
    (id: string, check: (board: LifecycleBoard) => boolean) =>
    (value: unknown) => {
      const board = decodeBoard(value);
      if (board.id !== id.toLowerCase() || !check(board))
        throw invalidResponse(200);
      return board;
    };
  return {
    archive: (id: string, signal: AbortSignal) =>
      api.json(
        `${path(id)}/archive`,
        result(id, (board) => board.isArchived),
        {
          identity,
          signal,
          resourceKey: resourceKey(id),
          method: 'POST',
          expectedStatus: 200,
        },
      ),
    restore: (id: string, signal: AbortSignal) =>
      api.json(
        `${path(id)}/restore`,
        result(id, (board) => !board.isArchived),
        {
          identity,
          signal,
          resourceKey: resourceKey(id),
          // An archived Board is read-only locally; the server checks OWNER.
          resourceAccess: 'read',
          method: 'POST',
          expectedStatus: 200,
        },
      ),
    visibility: (
      id: string,
      visibility: BoardVisibility,
      signal: AbortSignal,
    ) =>
      api.json(
        `${path(id)}/visibility`,
        result(id, (board) => board.visibility === visibility),
        {
          identity,
          signal,
          resourceKey: resourceKey(id),
          method: 'PATCH',
          body: { visibility },
          expectedStatus: 200,
        },
      ),
    move: (
      id: string,
      sourceWorkspaceId: string,
      destinationWorkspaceId: string,
      signal: AbortSignal,
    ) =>
      api.json(
        `${path(id)}/move-workspace`,
        result(
          id,
          (board) =>
            board.workspaceId === destinationWorkspaceId.toLowerCase() &&
            // A real move always resets visibility; a same-Workspace move is a no-op.
            (sourceWorkspaceId.toLowerCase() === board.workspaceId ||
              board.visibility === BoardVisibility.PRIVATE),
        ),
        {
          identity,
          signal,
          resourceKey: resourceKey(id),
          method: 'POST',
          body: { destinationWorkspaceId },
          expectedStatus: 200,
        },
      ),
    policy: (id: string, signal: AbortSignal) =>
      api.json(`${path(id)}/policy-capabilities`, decodeBoardPolicy, {
        identity,
        signal,
        resourceKey: resourceKey(id),
        expectedStatus: 200,
      }),
    samplePreview: (id: string, signal: AbortSignal) =>
      api.json(`${path(id)}/sample-removal`, decodeSamplePreview, {
        identity,
        signal,
        resourceKey: resourceKey(id),
        expectedStatus: 200,
      }),
    removeSample: (
      id: string,
      review: Pick<StarterBoardRemovalPreview, 'version' | 'confirmation'>,
      signal: AbortSignal,
    ) =>
      api.empty(`${path(id)}/sample-removal`, {
        identity,
        signal,
        resourceKey: resourceKey(id),
        // Eligibility includes archived samples; the server re-inspects the Board.
        resourceAccess: 'read',
        method: 'DELETE',
        body: { version: review.version, confirmation: review.confirmation },
        expectedStatus: 204,
      }),
  };
}
