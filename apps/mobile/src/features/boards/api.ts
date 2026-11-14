import type { BoardBackgroundPresetId } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { workspaceId, decodeWorkspaceBoard } from '../workspaces/decoder.ts';
import { isBoardPreset } from '../home/presets.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Board response');
  return value as Record<string, unknown>;
}

export function decodeBoard(value: unknown) {
  const row = record(value);
  const workspace = workspaceId(row.workspaceId);
  if (!workspace || !workspaceId(row.createdById))
    throw new Error('Invalid Board response');
  return decodeWorkspaceBoard(
    { ...row, memberCount: null, canEdit: false },
    workspace,
  );
}

export function decodeBoardUserState(value: unknown) {
  const row = record(value);
  if (
    typeof row.isStarred !== 'boolean' ||
    !(
      row.lastViewedAt === null ||
      (typeof row.lastViewedAt === 'string' &&
        Number.isFinite(Date.parse(row.lastViewedAt)) &&
        new Date(row.lastViewedAt).toISOString() === row.lastViewedAt)
    )
  )
    throw new Error('Invalid Board user state');
  return {
    isStarred: row.isStarred,
    lastViewedAt: row.lastViewedAt as string | null,
  };
}

export type BoardUserState = ReturnType<typeof decodeBoardUserState>;

export function decodeBackgroundCatalog(value: unknown) {
  if (!Array.isArray(value) || value.length > 12)
    throw new Error('Invalid background catalog');
  const seen = new Set<string>();
  return value.map((entry) => {
    const row = record(entry);
    if (
      !isBoardPreset(row.id) ||
      seen.has(row.id) ||
      (row.kind !== 'color' && row.kind !== 'photo') ||
      typeof row.value !== 'string' ||
      (row.foreground !== 'light' && row.foreground !== 'dark')
    )
      throw new Error('Invalid background catalog');
    seen.add(row.id);
    return {
      id: row.id,
      kind: row.kind,
      value: row.value,
      foreground: row.foreground,
    };
  });
}

export interface BoardInput {
  name: string;
  workspaceId: string;
  description?: string | null;
  backgroundPreset?: BoardBackgroundPresetId;
}

export function createBoardApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const path = (id: string) => `/boards/${encodeURIComponent(id)}`;
  const opts = (id: string, signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: queryKeys.board(identity, id),
    expectedStatus: 200 as const,
  });
  const boardResult = (id: string) => (value: unknown) => {
    const board = decodeBoard(value);
    if (board.id !== id.toLowerCase())
      throw new Error('Invalid Board response');
    return board;
  };
  return {
    detail: (id: string, signal: AbortSignal) =>
      api.json(path(id), boardResult(id), opts(id, signal)),
    catalog: (signal: AbortSignal) =>
      api.json('/boards/background-presets', decodeBackgroundCatalog, {
        identity,
        signal,
        resourceKey: queryKeys.boardLists(identity),
        expectedStatus: 200,
      }),
    create: (input: BoardInput, signal: AbortSignal) =>
      api.json('/boards', decodeBoard, {
        identity,
        signal,
        resourceKey: queryKeys.workspaceBoards(identity, input.workspaceId),
        method: 'POST',
        body: input,
        expectedStatus: 201,
      }),
    update: (
      id: string,
      input: { name?: string; description?: string | null },
      signal: AbortSignal,
    ) =>
      api.json(path(id), boardResult(id), {
        ...opts(id, signal),
        method: 'PATCH',
        body: input,
      }),
    background: (
      id: string,
      preset: BoardBackgroundPresetId,
      expectedVersion: number,
      signal: AbortSignal,
    ) =>
      api.json(`${path(id)}/background`, boardResult(id), {
        ...opts(id, signal),
        method: 'PATCH',
        body: { preset, expectedVersion },
      }),
    state: (id: string, signal: AbortSignal) =>
      api.json(
        `${path(id)}/user-state`,
        decodeBoardUserState,
        opts(id, signal),
      ),
    star: (id: string, starred: boolean, signal: AbortSignal) =>
      api.json(`${path(id)}/star`, decodeBoardUserState, {
        ...opts(id, signal),
        method: starred ? 'PUT' : 'DELETE',
        resourceAccess: 'read',
      }),
    view: (id: string, signal: AbortSignal) =>
      api.json(`${path(id)}/views`, decodeBoardUserState, {
        ...opts(id, signal),
        method: 'POST',
        resourceAccess: 'read',
      }),
  };
}
