/** Standalone DEV-only QA entry. Never imported by the production application. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthenticatedLayout } from '../src/app/layout/AuthenticatedLayout';
import {
  AuthContext,
  type AuthContextValue,
} from '../src/features/auth/auth-context';
import { AuthSessionContext } from '../src/features/auth/auth-session-context';
import { ThemeSync } from '../src/features/settings/ThemeSync';
import { preferencesKeys } from '../src/features/settings/query-keys';
import { WorkspaceGatewayContext } from '../src/features/workspaces/gateway-context';
import {
  WorkspaceBoardsGatewayContext,
  workspaceBoardsGateway,
} from '../src/features/workspaces/boards/gateway';
import {
  workspaceGateway,
  type WorkspaceGateway,
} from '../src/features/workspaces/api';
import type {
  WorkspaceBoardsGateway,
  WorkspaceBoardSummary,
} from '../src/features/workspaces/boards/types';
import type { WorkspaceSummary } from '../src/features/workspaces/types';
import { WorkspaceLayout } from '../src/features/workspaces/components/WorkspaceLayout';
import { WorkspaceBoardsPage } from '../src/features/workspaces/pages/WorkspaceBoardsPage';
import { WorkspaceOverviewPage } from '../src/features/workspaces/pages/WorkspaceOverviewPage';
import { WorkspacesPage } from '../src/features/workspaces/pages/WorkspacesPage';
import { ApiError } from '../src/lib/api-client';
import '../src/style.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'ready';
const theme =
  params.get('theme') === 'dark'
    ? 'dark'
    : params.get('theme') === 'light'
      ? 'light'
      : 'system';
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
client.setQueryData(preferencesKeys.current, {
  theme,
  timeZone: 'Asia/Bangkok',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});
const team: WorkspaceSummary = {
  id: 'qa-space',
  name: 'Development Team',
  description: 'Build amazing products together.',
  role: 'ADMIN',
  type: 'TEAM',
};
const personal: WorkspaceSummary = {
  ...team,
  id: 'qa-personal',
  name: 'Personal',
  type: 'PERSONAL',
};
const names = [
  'Frontend Development',
  'Backend Development',
  'Product Roadmap',
  'Design System',
  'Deployment',
  'Team Planning',
];
const boards: WorkspaceBoardSummary[] = Array.from(
  { length: scenario === 'many' ? 60 : 6 },
  (_, index) => ({
    id: `qa-private-board-${index}`,
    name:
      scenario === 'long'
        ? 'BoardNameWithoutSpaces'.repeat(6).slice(0, 120)
        : `${names[index % 6]}${index >= 6 ? ` ${index + 1}` : ''}`,
    description: null,
    updatedAt: '2026-10-27T09:00:00Z',
    isArchived: scenario === 'archived',
    visibility: 'PRIVATE',
    currentUserRole: index % 2 ? 'MEMBER' : 'OWNER',
    canArchive: false,
    canRestore: false,
    memberCount: index % 3 ? null : 4,
  }),
);
const workspace: WorkspaceGateway =
  scenario === 'unavailable'
    ? workspaceGateway
    : {
        available: true,
        list: async () => [personal, team],
        overview: async (_token, id) => ({
          workspace: id === team.id ? team : personal,
          visibleBoardCount: boards.length,
          memberCount: 5,
          recentBoards: [],
        }),
        createTeam: async () => {
          throw new Error('QA does not save.');
        },
      };
const gateway: WorkspaceBoardsGateway =
  scenario === 'unavailable'
    ? workspaceBoardsGateway
    : {
        available: true,
        features: {
          search: true,
          status: true,
          sorts: ['updated-desc', 'name-asc'],
          pagination: true,
        },
        list: async (_token, id, filters, signal) => {
          if (scenario === 'loading')
            return new Promise((_resolve, reject) =>
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              ),
            );
          if (scenario === 'forbidden' || scenario === 'not-found')
            throw new ApiError(
              scenario === 'forbidden' ? 403 : 404,
              'DENIED',
              'Unavailable',
            );
          if (scenario === 'error')
            throw new ApiError(0, 'NETWORK_ERROR', 'QA network failure');
          // Simulated server semantics exist only in this isolated fixture entry.
          let items =
            scenario === 'empty'
              ? []
              : boards.filter(
                  (item) =>
                    item.isArchived === (filters.status === 'archived') &&
                    item.name
                      .toLowerCase()
                      .includes(filters.search.toLowerCase()),
                );
          if (id !== team.id) items = [];
          if (filters.sort === 'name-asc')
            items = [...items].sort((a, b) => a.name.localeCompare(b.name));
          return {
            items: items.slice((filters.page - 1) * 6, filters.page * 6),
            total: items.length,
            page: filters.page,
            pageCount: Math.ceil(items.length / 6),
            canCreateBoard: scenario !== 'no-permission',
          };
        },
        create: async () => {
          throw new Error('QA preview does not save boards.');
        },
      };
const auth: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'qa-user',
    email: 'qa@example.invalid',
    displayName: 'QA Preview',
    avatarUrl: null,
    createdAt: '',
    updatedAt: '',
  },
  runAuthorized: (request) => request('isolated-boards-qa-credential'),
  signIn: () => {
    throw new Error('No QA login');
  },
  signOut: () => {
    location.href = '/qa/workspace-boards.html?scenario=unavailable';
  },
  retry: () => location.reload(),
};
const router = createMemoryRouter(
  [
    {
      element: <AuthenticatedLayout />,
      children: [
        { path: '/workspaces', element: <WorkspacesPage /> },
        {
          path: '/workspaces/:workspaceId',
          element: <WorkspaceLayout />,
          children: [
            { index: true, element: <WorkspaceOverviewPage /> },
            { path: 'boards', element: <WorkspaceBoardsPage /> },
          ],
        },
        {
          path: '*',
          element: (
            <p className="p-6">
              QA preview only renders Workspace screens. Board links use the
              real application’s existing routes.
            </p>
          ),
        },
      ],
    },
  ],
  {
    initialEntries: [
      params.get('route') ??
        `/workspaces/qa-space/boards${scenario === 'archived' ? '?status=archived' : ''}`,
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
          <ThemeSync />
          <WorkspaceGatewayContext.Provider value={workspace}>
            <WorkspaceBoardsGatewayContext.Provider value={gateway}>
              <div className="fixed right-1 bottom-1 z-30 max-w-[calc(100vw-1rem)] rounded border border-line bg-surface px-2 py-1 text-[10px] text-muted">
                ISOLATED BOARDS QA FIXTURES · {scenario} · {theme} · No saved
                data
              </div>
              <RouterProvider router={router} />
            </WorkspaceBoardsGatewayContext.Provider>
          </WorkspaceGatewayContext.Provider>
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
