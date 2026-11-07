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
import { BoardMembersPage } from '../src/features/board-members/pages/BoardMembersPage';
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
  name: params.get('long')
    ? 'Frontend development and cross-functional release planning'
    : 'Frontend development',
  description: 'Plan, build, and ship the next Kanvexa release together.',
  workspaceId:
    scenario === 'workspace-owner' ? 'joined-destination' : 'source-not-joined',
  visibility: scenario === 'reader' ? 'WORKSPACE_VISIBLE' : 'PRIVATE',
  backgroundPreset: 'blue',
  backgroundVersion: 0,
  currentUserRole:
    scenario === 'reader' ? null : scenario === 'member' ? 'MEMBER' : 'OWNER',
  isArchived: scenario === 'archived',
  archivedAt: null,
  createdById: 'qa-owner',
  createdAt: '2026-10-30T00:00:00Z',
  updatedAt: '2026-10-30T00:00:00Z',
  capabilities: {
    canReadBoard: true,
    canWriteBoard: !['reader', 'archived'].includes(scenario),
    canManageBoard: !['reader', 'member', 'archived'].includes(scenario),
    canManageMembers: !['reader', 'member', 'archived'].includes(scenario),
    canRestoreBoard: scenario === 'archived',
  },
};
const destination = {
  id: 'joined-destination',
  name: scenario === 'workspace-owner' ? 'Engineering' : 'Joined destination',
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
  if (path === '/boards/background-presets')
    return response([
      ...[
        'blue',
        'indigo',
        'violet',
        'rose',
        'orange',
        'amber',
        'green',
        'teal',
      ].map((id, index) => ({
        id,
        kind: 'color',
        value: [
          '#2563EB',
          '#4F46E5',
          '#7C3AED',
          '#BE123C',
          '#C2410C',
          '#FCD34D',
          '#15803D',
          '#0F766E',
        ][index],
        foreground: 'light',
      })),
      ...['mountains', 'forest', 'coast', 'lake'].map((id) => ({
        id,
        kind: 'photo',
        value: '',
        foreground: 'light',
      })),
    ]);
  if (
    path === `/boards/${board.id}/user-state` ||
    path === `/boards/${board.id}/views`
  )
    return response({ isStarred: false, lastViewedAt: null });
  if (path === `/boards/${board.id}/background` && init?.method === 'PATCH') {
    const input = JSON.parse(String(init.body));
    if (input.expectedVersion !== board.backgroundVersion)
      return new Response(
        JSON.stringify({
          success: false,
          code: 'BACKGROUND_CONFLICT',
          message: 'Background changed',
        }),
        { status: 409 },
      );
    board.backgroundPreset = input.preset;
    board.backgroundVersion = (board.backgroundVersion ?? 0) + 1;
    return response(board);
  }
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
  if (path === `/boards/${board.id}`) {
    if (init?.method === 'PATCH')
      Object.assign(board, JSON.parse(String(init.body)));
    return response(board);
  }
  if (path === `/boards/${board.id}/members?page=1&limit=100`)
    return response(
      [
        {
          user: {
            id: 'qa-owner',
            displayName: 'Linh Nguyen',
            email: 'linh@example.invalid',
            avatarUrl: null,
          },
          role: 'OWNER',
          joinedAt: board.createdAt,
        },
        ...['Minh Tran', 'Mai Pham', 'Kien Duong', 'Anh Le', 'Hana Vu'].map(
          (displayName, index) => ({
            user: {
              id: `qa-member-${index}`,
              displayName,
              email: `${displayName.toLowerCase().replace(' ', '.')}@example.invalid`,
              avatarUrl: null,
            },
            role: 'MEMBER',
            joinedAt: board.createdAt,
          }),
        ),
      ],
      true,
    );
  if (
    path === `/boards/${board.id}/archive` ||
    path === `/boards/${board.id}/restore`
  ) {
    board.isArchived = path.endsWith('/archive');
    return response(board);
  }

  if (/^\/boards\/qa-board\/(columns|cards|members)\?/.test(path)) {
    if (scenario === 'wide' && path.includes('/columns?'))
      return response(
        ['To do', 'In progress', 'Review', 'Done', 'Later'].map(
          (name, index) => ({
            id: `column-${index}`,
            boardId: board.id,
            name,
            position: `${index + 1}.0000000000`,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          }),
        ),
        true,
      );
    if (scenario === 'wide' && path.includes('/cards?'))
      return response(
        Array.from({ length: 10 }, (_, index) => ({
          id: `card-${index}`,
          boardId: board.id,
          columnId: `column-${Math.floor(index / 2)}`,
          title: `Example card ${index + 1}`,
          description: null,
          position: `${index + 1}.0000000000`,
          createdById: board.createdById,
          startDate: null,
          dueDate: null,
          isArchived: false,
          archivedAt: null,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          assignees: [],
        })),
        true,
      );
    return response([], true);
  }
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
      children: [
        {
          path: '/boards/:boardId',
          element: <BoardDetailPage />,
          children: [
            { path: 'settings', element: null },
            { path: 'members', element: <BoardMembersPage /> },
          ],
        },
      ],
    },
  ],
  {
    initialEntries: [
      `/boards/${board.id}${params.get('route') === 'members' ? '/members' : params.get('settings') === 'true' ? '/settings' : ''}`,
    ],
  },
);
if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{
          generation: 0,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
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
