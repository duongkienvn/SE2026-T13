/** DEV-only browser fixture; never imported by the production application. */
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
import type { Board } from '../src/features/boards/types';
import { env } from '../src/lib/env';
import { refreshAccessSnapshots } from '../src/features/realtime/access-revocation';
import '../src/style.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'guest-owner';
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
async function accessChangeBeforeResponse() {
  if (scenario === 'resync-race') {
    refreshAccessSnapshots(client);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
document.documentElement.dataset.theme =
  params.get('theme') === 'dark' ? 'dark' : 'light';
const board: Board = {
  id: 'qa-board',
  name: 'Guest owned project',
  description: 'Board OWNER actions without source Workspace membership.',
  workspaceId: 'source-not-joined',
  visibility: 'PRIVATE',
  currentUserRole:
    scenario === 'reader' ? null : scenario === 'member' ? 'MEMBER' : 'OWNER',
  isArchived: scenario === 'archived',
  archivedAt: null,
  createdById: 'qa-owner',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  capabilities: {
    canReadBoard: true,
    canWriteBoard: scenario === 'guest-owner',
    canManageBoard: !['reader', 'member', 'archived'].includes(scenario),
    canManageMembers: true,
    canRestoreBoard: scenario === 'archived',
  },
};
const destination = {
  id: 'joined-destination',
  name: 'Joined destination',
  type: 'TEAM',
  role: 'MEMBER',
  canCreateBoards: true,
  canManage: false,
  joinedAt: board.createdAt,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  description: null,
  icon: null,
};
function response(data: unknown, page = false) {
  return new Response(
    JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'OK',
      data,
      ...(page
        ? {
            meta: {
              page: 1,
              limit: 100,
              total: (data as unknown[]).length,
              totalPages: 1,
            },
          }
        : {}),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
// Every API request is intercepted locally; this fixture never contacts a backend.
window.fetch = async (input, init) => {
  const path = String(input).replace(env.apiBaseUrl, '');
  if (path === '/workspaces?page=1&limit=100')
    return response(
      scenario === 'empty'
        ? []
        : [
            destination,
            {
              ...destination,
              id: 'locked',
              name: 'Ineligible destination',
              canCreateBoards: false,
            },
          ],
      true,
    );
  if (path === `/boards/${board.id}/policy-capabilities`)
    return response({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: scenario !== 'policy-denied',
    });
  if (path === `/boards/${board.id}/visibility` && init?.method === 'PATCH') {
    board.visibility = JSON.parse(String(init.body)).visibility;
    await accessChangeBeforeResponse();
    return response(board);
  }
  if (
    path === `/boards/${board.id}/move-workspace` &&
    init?.method === 'POST'
  ) {
    board.workspaceId = JSON.parse(String(init.body)).destinationWorkspaceId;
    board.visibility = 'PRIVATE';
    await accessChangeBeforeResponse();
    return response(board);
  }
  if (path === `/boards/${board.id}`) return response(board);
  if (/^\/boards\/qa-board\/(columns|cards|members)\?/.test(path))
    return response([], true);
  throw new Error(`Unexpected QA request: ${path}`);
};
const auth: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'qa-owner',
    email: 'qa@example.invalid',
    displayName: 'QA Owner',
    avatarUrl: null,
    createdAt: '',
    updatedAt: '',
  },
  runAuthorized: (request) => request('isolated-qa-fixture'),
  signIn: () => {
    throw new Error('No QA login');
  },
  signOut: () => location.reload(),
  retry: () => location.reload(),
};
const router = createMemoryRouter(
  [
    {
      element: <AuthenticatedLayout />,
      children: [{ path: '/boards/:boardId', element: <BoardDetailPage /> }],
    },
  ],
  { initialEntries: [`/boards/${board.id}`] },
);
if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 0, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <div className="fixed right-1 bottom-1 z-30 rounded border border-line bg-surface px-2 py-1 text-[10px] text-muted">
            ISOLATED QA · {scenario} · No saved data
          </div>
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
