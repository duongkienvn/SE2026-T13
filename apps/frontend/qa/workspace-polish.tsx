/** DEV-only isolated fixtures. No backend calls, credentials or persisted business data. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../src/app/routes';
import {
  AuthContext,
  type AuthContextValue,
} from '../src/features/auth/auth-context';
import { AuthSessionContext } from '../src/features/auth/auth-session-context';
import { ThemeSync } from '../src/features/settings/ThemeSync';
import { preferencesKeys } from '../src/features/settings/query-keys';
import { env } from '../src/lib/env';
import '../src/style.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'team';
const id = '00000000-0000-4000-8000-000000000113';
const personalId = '00000000-0000-4000-8000-000000000115';
const boardId = '00000000-0000-4000-8000-000000000114';
const time = '2026-10-31T00:00:00Z';
const user = {
  id: 'qa-user',
  email: 'qa@example.invalid',
  displayName: 'QA Preview',
  avatarUrl: null,
  createdAt: time,
  updatedAt: time,
};
const team = {
  id,
  type: 'TEAM',
  name:
    scenario === 'long'
      ? 'DevelopmentWithoutSpaces'.repeat(5)
      : 'Development Team',
  description: 'Build amazing products together.',
  icon: null,
  role: 'ADMIN',
  canManage: true,
  canCreateBoards: true,
  joinedAt: time,
  createdAt: time,
  updatedAt: time,
};
const personal = {
  ...team,
  id: personalId,
  type: 'PERSONAL',
  name: 'Kanvexa Workspace',
  description: 'A home for your boards.',
};
const memberships =
  scenario === 'guest'
    ? [personal]
    : [
        personal,
        team,
        ...(scenario === 'many'
          ? Array.from({ length: 40 }, (_, i) => ({
              ...team,
              id: `qa-${i}`,
              name: `Long project workspace ${i + 1}`,
            }))
          : []),
      ];
const board = {
  id: boardId,
  name: 'Sprint planning',
  description: 'Board navigation and authorized Workspace context.',
  createdById: user.id,
  workspaceId: id,
  visibility: 'PRIVATE',
  currentUserRole: 'OWNER',
  isArchived: scenario === 'archived',
  archivedAt: null,
  createdAt: time,
  updatedAt: time,
  canEdit: true,
  memberCount: 1,
  capabilities: {
    canReadBoard: true,
    canWriteBoard: scenario !== 'archived',
    canManageBoard: scenario !== 'archived',
    canManageMembers: true,
    canRestoreBoard: scenario === 'archived',
  },
};
const policies = {
  boardCreationAdminOnly: false,
  boardInvitesEnabled: true,
  boardMembershipChangesEnabled: true,
  boardVisibilityChangesEnabled: true,
  canManagePolicies: true,
  canCreateBoards: true,
};
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});
client.setQueryDefaults(preferencesKeys.current, { staleTime: Infinity });
client.setQueryData(preferencesKeys.current, {
  theme: params.get('theme') ?? 'system',
  timeZone: 'Asia/Bangkok',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});
function response(data: unknown, page = false, status = 200) {
  return new Response(
    JSON.stringify({
      success: status < 400,
      statusCode: status,
      message: status < 400 ? 'OK' : 'Synthetic QA refusal',
      code: status === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE',
      data,
      ...(page
        ? {
            meta: {
              page: 1,
              limit: 20,
              total: (data as unknown[]).length,
              totalPages: Math.ceil((data as unknown[]).length / 20),
            },
          }
        : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  const path = url.href.replace(env.apiBaseUrl, '').split('?')[0];
  const method = init?.method ?? 'GET';
  if (method === 'PATCH' && scenario === 'save-failure')
    return response(null, false, 503);
  if (path === '/workspaces') {
    if (method === 'POST')
      return response(
        { ...team, ...JSON.parse(String(init?.body)), id: 'qa-created' },
        false,
        201,
      );
    return response(memberships, true);
  }
  for (const workspace of memberships) {
    const root = `/workspaces/${workspace.id}`;
    if (path === root) {
      if (method === 'PATCH')
        Object.assign(workspace, JSON.parse(String(init?.body)));
      return response(workspace);
    }
    if (path === `${root}/overview`)
      return response({
        workspace,
        visibleBoardCount: 1,
        activeBoardCount: 1,
        archivedBoardCount: 0,
        memberCount: 1,
        recentBoards: [board],
      });
    if (path === `${root}/activity`) {
      if (scenario === 'activity-error') return response(null, false, 503);
      const events =
        scenario === 'activity-empty'
          ? []
          : Array.from({ length: 8 }, (_, i) => ({
              id: `qa-event-${i}`,
              eventType: i === 0 ? 'BOARD_MOVED' : 'WORKSPACE_UPDATED',
              createdAt: time,
              actor: {
                id: user.id,
                displayName: user.displayName,
                avatarUrl: null,
              },
              board: i === 0 ? { id: boardId, name: board.name } : null,
            }));
      const page = Number(url.searchParams.get('page') ?? 1),
        limit = Number(url.searchParams.get('limit') ?? 5);
      return new Response(
        JSON.stringify({
          success: true,
          statusCode: 200,
          message: 'OK',
          data: events.slice((page - 1) * limit, page * limit),
          meta: {
            page,
            limit,
            total: events.length,
            totalPages: Math.ceil(events.length / limit),
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (path === `${root}/policies`) {
      if (method === 'PATCH')
        Object.assign(policies, JSON.parse(String(init?.body)));
      return response(policies);
    }
    if (path === `${root}/boards`)
      return response(workspace.id === id ? [board] : [], true);
    if (path === `${root}/members`)
      return response(
        [
          {
            userId: user.id,
            displayName: user.displayName,
            avatarUrl: null,
            avatarRevision: 0,
            role: 'ADMIN',
            joinedAt: time,
          },
        ],
        true,
      );
    if (path === `${root}/guests` || path === `${root}/invitations`)
      return response([], true);
  }
  if (path === '/boards') return response([board], true);
  if (path === `/boards/${boardId}`) return response(board);
  if (path === `/boards/${boardId}/policy-capabilities`)
    return response({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: true,
    });
  if (
    new RegExp(`/boards/${boardId}/(columns|cards|members|activities)$`).test(
      path,
    )
  )
    return response([], true);
  return response(null, false, 404);
};
const auth: AuthContextValue = {
  status: 'authenticated',
  user,
  runAuthorized: (request) => request('isolated-qa-fixture'),
  signIn: () => {
    throw new Error('No login in QA');
  },
  signOut: () => location.reload(),
  retry: () => location.reload(),
};
const router = createMemoryRouter(routes, {
  initialEntries: [
    params.get('route') ??
      `/workspaces/${scenario === 'personal' ? personalId : id}/settings/general`,
  ],
});
if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 0, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <ThemeSync />
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
