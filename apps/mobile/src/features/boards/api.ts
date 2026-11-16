import type { BoardBackgroundPresetId } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { requirePage } from '../../infrastructure/query/pagination.ts';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
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
  if (
    !workspace ||
    !workspaceId(row.createdById) ||
    (row.isStarterBoard !== undefined &&
      typeof row.isStarterBoard !== 'boolean')
  )
    throw new Error('Invalid Board response');
  return {
    ...decodeWorkspaceBoard(
      { ...row, memberCount: null, canEdit: false },
      workspace,
    ),
    // A server hint only; the sample-removal preview decides eligibility.
    isStarterBoard: row.isStarterBoard === true,
  };
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
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Invalid background catalog');
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const row = record(entry);
    if (
      typeof row.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(row.id) ||
      seen.has(row.id) ||
      (row.kind !== 'color' && row.kind !== 'photo') ||
      typeof row.value !== 'string' ||
      (row.foreground !== 'light' && row.foreground !== 'dark')
    )
      throw new Error('Invalid background catalog');
    seen.add(row.id);
    if (!isBoardPreset(row.id)) return [];
    return [
      {
        id: row.id,
        kind: row.kind,
        value: row.value,
        foreground: row.foreground,
      },
    ];
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
    async list(
      page: number,
      status: 'active' | 'archived',
      signal: AbortSignal,
    ) {
      const limit = 20;
      if (!Number.isSafeInteger(page) || page < 1) throw invalidResponse(200);
      const result = requirePage(
        await api.envelope(
          '/boards',
          (value) => {
            if (!Array.isArray(value) || value.length > limit)
              throw invalidResponse(200);
            return value.map(decodeBoard);
          },
          {
            identity,
            signal,
            resourceKey: queryKeys.boards(identity, null, { status, limit }),
            query: { page, limit, status },
            expectedStatus: 200,
          },
        ),
      );
      if (
        result.meta.page !== page ||
        result.meta.limit !== limit ||
        result.meta.totalPages !== Math.ceil(result.meta.total / limit) ||
        result.data.some(
          (board) => board.isArchived !== (status === 'archived'),
        )
      )
        throw invalidResponse(200);
      return result;
    },
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
