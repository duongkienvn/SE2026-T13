/** DEV-only isolated UI fixtures. No backend/socket connections or real email. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthenticatedLayout } from '../src/app/layout/AuthenticatedLayout';
import {
  AuthContext,
  type AuthContextValue,
} from '../src/features/auth/auth-context';
import { AuthSessionContext } from '../src/features/auth/auth-session-context';
import { BoardDetailPage } from '../src/features/boards/pages/BoardDetailPage';
import { BoardMembersPage } from '../src/features/board-members/pages/BoardMembersPage';
import { RealtimeContext } from '../src/features/realtime/realtime-context';
import type { BoardRealtimeClient } from '../src/features/realtime/board-realtime-client';
import { livePresence } from '../src/features/realtime/board-presence-state';
import { ThemeSync } from '../src/features/settings/ThemeSync';
import { preferencesKeys } from '../src/features/settings/query-keys';
import { WorkspaceLayout } from '../src/features/workspaces/components/WorkspaceLayout';
import { WorkspaceMembersPage } from '../src/features/workspaces/pages/WorkspaceMembersPage';
import { env } from '../src/lib/env';
import '../src/style.css';

const params = new URLSearchParams(location.search),
  scenario = params.get('scenario') ?? 'reader';
const boardId = '11111111-1111-4111-8111-111111111111',
  workspaceId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'QA Member',
  email: 'qa@example.invalid',
  avatarUrl: null,
  createdAt: '2026-10-31T00:00:00Z',
  updatedAt: '2026-10-31T00:00:00Z',
};
const time = user.createdAt,
  reader = scenario === 'reader',
  archived = scenario === 'archived';
const workspace = {
  id: workspaceId,
  type: 'TEAM',
  name: 'Engineering',
  description: 'Authorized team collaboration.',
  icon: null,
  role: 'ADMIN',
  canManage: true,
  canCreateBoards: true,
  joinedAt: time,
  createdAt: time,
  updatedAt: time,
};
const board = {
  id: boardId,
  workspaceId,
  name: 'Sprint planning',
  description: 'Permission-aware archived cards and presence.',
  visibility: 'WORKSPACE_VISIBLE',
  currentUserRole: reader ? null : 'OWNER',
  isArchived: archived,
  archivedAt: archived ? time : null,
  createdById: user.id,
  createdAt: time,
  updatedAt: time,
  capabilities: {
    canReadBoard: true,
    canWriteBoard: !reader && !archived,
    canManageBoard: !reader && !archived,
    canManageMembers: !reader,
    canRestoreBoard: !reader && archived,
  },
};
const card = {
  id: '44444444-4444-4444-8444-444444444444',
  boardId,
  columnId: 'qa-column',
  title: 'Archived planning notes',
  description: null,
  isArchived: true,
  archivedAt: time,
  position: 1000,
  createdAt: time,
  updatedAt: time,
  dueDate: null,
  assignees: [],
};
const states = [
  'SENT',
  'DISPATCHING',
  'UNAVAILABLE',
  'FAILED',
  'UNKNOWN',
] as const;
let invitations = states.map((sendState, i) => ({
  id: `invite-${i}`,
  workspaceId,
  email: `teammate-${i + 1}@example.invalid`,
  role: 'MEMBER',
  status: 'PENDING',
  sendState,
  invitedById: user.id,
  createdAt: time,
  updatedAt: time,
  expiresAt: '2026-11-07T00:00:00Z',
  consumedAt: null,
  declinedAt: null,
  revokedAt: null,
}));
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
  theme: params.get('theme') ?? 'light',
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});
const response = (data: unknown, page = false, status = 200) =>
  new Response(
    JSON.stringify({
      success: status < 400,
      statusCode: status,
      message: status < 400 ? 'OK' : 'Synthetic request refusal',
      code: status === 429 ? 'TOO_MANY_REQUESTS' : 'NOT_FOUND',
      data,
      ...(page
        ? {
            meta: {
              page: 1,
              limit: 20,
              total: (data as unknown[]).length,
              totalPages: 1,
            },
          }
        : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).href
      .replace(env.apiBaseUrl, '')
      .split('?')[0],
    method = init?.method ?? 'GET';
  if (path === '/workspaces') return response([workspace], true);
  if (path === `/workspaces/${workspaceId}/overview`)
    return response({
      workspace,
      visibleBoardCount: 1,
      activeBoardCount: 1,
      archivedBoardCount: 0,
      memberCount: 1,
      recentBoards: [],
    });
  if (path === `/workspaces/${workspaceId}/members`)
    return response(
      [
        {
          userId: user.id,
          displayName: user.displayName,
          avatarRevision: 0,
          avatarUrl: null,
          role: 'ADMIN',
          joinedAt: time,
        },
      ],
      true,
    );
  if (path === `/workspaces/${workspaceId}/invitations`) {
    if (method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (params.has('sendError'))
        return response(null, false, Number(params.get('sendError')));
      const sendState =
        states.find((state) => state === params.get('sendState')) ?? 'SENT';
      const email = JSON.parse(String(init?.body)).email;
      const saved = { ...invitations[0], id: 'qa-requested', email, sendState };
      invitations = [
        saved,
        ...invitations.filter((item) => item.email !== email),
      ];
      return response(saved, false, 202);
    }
    return response(invitations, true);
  }
  if (path === `/boards/${boardId}`) return response(board);
  if (path === `/boards/${boardId}/policy-capabilities`)
    return response({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: true,
    });
  if (path === `/boards/${boardId}/cards`)
    return response(
      new URL(String(input), location.origin).searchParams.get('status') ===
        'archived'
        ? [card]
        : [],
      true,
    );
  if (path === `/boards/${boardId}/columns`)
    return response(
      [
        {
          id: card.columnId,
          boardId,
          name: 'Planning',
          position: 1000,
          createdAt: time,
          updatedAt: time,
        },
      ],
      true,
    );
  if (path === `/boards/${boardId}/members` && params.has('memberStatus'))
    return response(null, false, Number(params.get('memberStatus')));
  if (path === `/boards/${boardId}/members`)
    return response(
      [
        {
          id: 'qa-membership',
          user: { ...user },
          role: 'OWNER',
          joinedAt: time,
        },
      ],
      true,
    );
  return response(null, false, 404);
};
const population = livePresence([
  user.id,
  '55555555-5555-4555-8555-555555555555',
]);
const realtime = {
  presence: () => population,
  subscribe: () => () => {},
  watch: () => () => {},
  status: () => 'live',
  wake: () => {},
} as unknown as BoardRealtimeClient;
const auth: AuthContextValue = {
  status: 'authenticated',
  user,
  runAuthorized: (request) => request('isolated-qa'),
  signIn: () => {
    throw new Error('No real login in QA');
  },
  signOut: () => location.reload(),
  retry: () => location.reload(),
};
const router = createMemoryRouter(
  [
    {
      element: <AuthenticatedLayout />,
      children: [
        { path: '/boards/:boardId', element: <BoardDetailPage /> },
        { path: '/boards/:boardId/members', element: <BoardMembersPage /> },
        {
          path: '/workspaces/:workspaceId',
          element: <WorkspaceLayout />,
          children: [{ path: 'members', element: <WorkspaceMembersPage /> }],
        },
      ],
    },
  ],
  {
    initialEntries: [
      params.get('route') ??
        (scenario === 'invitations'
          ? `/workspaces/${workspaceId}/members?tab=invitations`
          : `/boards/${boardId}`),
    ],
  },
);
if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 0, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <RealtimeContext.Provider value={realtime}>
            <ThemeSync />
            <RouterProvider router={router} />
          </RealtimeContext.Provider>
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
