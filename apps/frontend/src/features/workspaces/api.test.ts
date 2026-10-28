import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { mockApi, ok, fail } from '../../test/mock-api';
import {
  workspaceResponse as workspace,
  workspaceBoardResponse as board,
  workspaceOverviewResponse as overview,
  workspacePage,
} from '../../test/workspace-fixtures';
import { workspaceGateway } from './api';
import { workspaceBoardsGateway } from './boards/gateway';

const signal = () => new AbortController().signal;
const filters = {
  search: '',
  status: 'active',
  sort: 'updated-desc',
  page: 1,
} as const;
const boardPath = `/workspaces/${workspace.id}/boards?page=1&limit=20&status=active&sort=updatedAt`;

describe('Workspace HTTP adapters', () => {
  it('loads every membership page in order with Bearer auth and cancellation', async () => {
    const calls = mockApi({
      'GET /workspaces?page=1&limit=100': workspacePage(
        [workspace],
        1,
        101,
        100,
      ),
      'GET /workspaces?page=2&limit=100': workspacePage(
        [{ ...workspace, id: 'personal', type: 'PERSONAL' }],
        2,
        101,
        100,
      ),
    });
    const fetchSpy = vi.mocked(fetch);
    const abort = signal();
    const result = await workspaceGateway.list('session-token', abort);
    expect(result.map((item) => item.id)).toEqual([workspace.id, 'personal']);
    expect(result[0]).toEqual({
      id: workspace.id,
      name: workspace.name,
      description: null,
      type: 'TEAM',
      role: 'MEMBER',
      canCreateBoards: true,
    });
    expect(
      calls.every(
        (call) => call.headers.Authorization === 'Bearer session-token',
      ),
    ).toBe(true);
    expect(fetchSpy.mock.calls.every((call) => call[1]?.signal === abort)).toBe(
      true,
    );
  });

  it('maps nullable Overview fields and archived recents without deriving metrics', async () => {
    mockApi({
      [`GET /workspaces/${workspace.id}/overview`]: ok({
        ...overview,
        recentBoards: [{ ...board, isArchived: true, canEdit: false }],
      }),
    });
    const result = await workspaceGateway.overview(
      'token',
      workspace.id,
      signal(),
    );
    expect(result.memberCount).toBeNull();
    expect(result.visibleBoardCount).toBe(21);
    expect(result.recentBoards).toEqual([
      {
        id: board.id,
        name: board.name,
        updatedAt: board.updatedAt,
        archived: true,
      },
    ]);
  });

  it('creates a Team using only supported fields and never automatically retries a failed POST', async () => {
    const calls = mockApi({
      'POST /workspaces': ok(
        { ...workspace, role: 'ADMIN', canManage: true },
        201,
      ),
    });
    await expect(
      workspaceGateway.createTeam('token', {
        name: 'Engineering',
        description: '',
      }),
    ).resolves.toMatchObject({ role: 'ADMIN', description: null });
    expect(calls[0].body).toEqual({ name: 'Engineering', description: '' });
    mockApi({ 'POST /workspaces': fail(500, 'INTERNAL_ERROR') });
    await expect(
      workspaceGateway.createTeam('token', {
        name: 'Engineering',
        description: '',
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps search, status, sorting and server pagination without altering ACL totals', async () => {
    const path = `/workspaces/${workspace.id}/boards?page=3&limit=20&status=archived&sort=name&search=Sprint+%25_%5C`;
    mockApi({
      [`GET ${path}`]: workspacePage(
        [{ ...board, isArchived: true, canEdit: false }],
        3,
        47,
      ),
    });
    const result = await workspaceBoardsGateway.list(
      'token',
      workspace.id,
      {
        search: ' Sprint %_\\ ',
        status: 'archived',
        sort: 'name-asc',
        page: 3,
      },
      signal(),
    );
    expect(result).toMatchObject({ total: 47, page: 3, pageCount: 3 });
    expect(result.items[0]).toEqual({
      id: board.id,
      name: board.name,
      description: null,
      updatedAt: board.updatedAt,
      isArchived: true,
      visibility: 'PRIVATE',
      currentUserRole: 'OWNER',
      canArchive: false,
      canRestore: true,
      memberCount: null,
    });
  });

  it('maps Board MEMBER separately from Workspace ADMIN and preserves zero-page empty responses', async () => {
    mockApi({
      [`GET ${boardPath}`]: workspacePage([
        { ...board, currentUserRole: 'MEMBER' },
      ]),
    });
    const result = await workspaceBoardsGateway.list(
      'token',
      workspace.id,
      filters,
      signal(),
    );
    expect(result.items[0]).toMatchObject({
      currentUserRole: 'MEMBER',
      canArchive: false,
      canRestore: false,
    });
    mockApi({ [`GET ${boardPath}`]: workspacePage([], 1, 0) });
    await expect(
      workspaceBoardsGateway.list('token', workspace.id, filters, signal()),
    ).resolves.toEqual({ items: [], total: 0, page: 1, pageCount: 0 });
  });

  it('creates PRIVATE Boards through the existing endpoint with the selected Workspace', async () => {
    const calls = mockApi({ 'POST /boards': ok(board, 201) });
    await expect(
      workspaceBoardsGateway.create('token', workspace.id, {
        name: 'Sprint',
        description: null,
      }),
    ).resolves.toMatchObject({ id: board.id });
    expect(calls[0].body).toEqual({
      name: 'Sprint',
      description: null,
      workspaceId: workspace.id,
    });
    expect(calls[0].headers.Authorization).toBe('Bearer token');
  });

  it.each([401, 403, 404, 429, 500])(
    'propagates %s errors for session/access handling without fallbacks',
    async (status) => {
      const calls = mockApi({ [`GET ${boardPath}`]: fail(status, 'DENIED') });
      await expect(
        workspaceBoardsGateway.list('token', workspace.id, filters, signal()),
      ).rejects.toMatchObject({ status, code: 'DENIED' });
      expect(calls).toHaveLength(1);
    },
  );

  it('rejects malformed pagination instead of inventing totals', async () => {
    mockApi({ [`GET ${boardPath}`]: ok([]) });
    await expect(
      workspaceBoardsGateway.list('token', workspace.id, filters, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('forwards abort signals and does not convert cancellation to a network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path, options) => {
        expect(options.signal).toBe(controller.signal);
        throw new DOMException('Aborted', 'AbortError');
      }),
    );
    await expect(
      workspaceBoardsGateway.list(
        'token',
        workspace.id,
        filters,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses future visibility grants in both lists and Overview until #115', async () => {
    const future = {
      ...board,
      visibility: 'WORKSPACE_VISIBLE',
      currentUserRole: null,
    };
    mockApi({
      [`GET ${boardPath}`]: workspacePage([future]),
      [`GET /workspaces/${workspace.id}/overview`]: ok({
        ...overview,
        recentBoards: [future],
      }),
    });
    await expect(
      workspaceBoardsGateway.list('token', workspace.id, filters, signal()),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      workspaceGateway.overview('token', workspace.id, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
