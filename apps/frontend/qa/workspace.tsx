/** Separate Vite DEV entry. Never imported by src/main.tsx or production routes. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
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
import type { ThemePreference } from '../src/features/settings/types';
import {
  workspaceGateway,
  type WorkspaceGateway,
} from '../src/features/workspaces/api';
import { WorkspaceGatewayContext } from '../src/features/workspaces/gateway-context';
import { WorkspaceLayout } from '../src/features/workspaces/components/WorkspaceLayout';
import { WorkspaceOverviewPage } from '../src/features/workspaces/pages/WorkspaceOverviewPage';
import { WorkspacesPage } from '../src/features/workspaces/pages/WorkspacesPage';
import type { WorkspaceSummary } from '../src/features/workspaces/types';
import { ApiError } from '../src/lib/api-client';
import '../src/style.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'ready';
const requestedTheme = params.get('theme');
const theme: ThemePreference =
  requestedTheme === 'dark' || requestedTheme === 'light'
    ? requestedTheme
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
client.setQueryDefaults(preferencesKeys.current, { staleTime: Infinity });
client.setQueryData(preferencesKeys.current, {
  theme,
  timeZone: 'Asia/Bangkok',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});
const team: WorkspaceSummary = {
  id: 'qa-team',
  name:
    scenario === 'long'
      ? 'ResearchAndDevelopmentWithoutSpaces'.repeat(4)
      : 'Development Team',
  description: 'Build amazing products together.',
  type: 'TEAM',
  role: 'ADMIN',
  canCreateBoards: true,
};
const personal: WorkspaceSummary = {
  id: 'qa-personal',
  name: 'Personal',
  description: 'A home for your own work.',
  type: 'PERSONAL',
  role: 'ADMIN',
  canCreateBoards: true,
};
const other: WorkspaceSummary = {
  id: 'qa-marketing',
  name: 'Marketing',
  description: 'Bring ideas to life.',
  type: 'TEAM',
  role: 'MEMBER',
  canCreateBoards: true,
};
const memberships = [
  personal,
  team,
  other,
  ...(scenario === 'many'
    ? Array.from({ length: 45 }, (_, index) => ({
        ...other,
        id: `qa-${index}`,
        name: `QA team ${index + 1}`,
      }))
    : []),
];
const gateway: WorkspaceGateway =
  scenario === 'unavailable'
    ? { ...workspaceGateway, available: false }
    : {
        available: true,
        list: async () => (scenario === 'no-workspaces' ? [] : memberships),
        overview: async (_token, id, signal) => {
          if (scenario === 'loading')
            return new Promise((_resolve, reject) =>
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              ),
            );
          if (scenario === 'forbidden')
            throw new ApiError(403, 'FORBIDDEN', 'Unavailable');
          if (scenario === 'not-found')
            throw new ApiError(404, 'NOT_FOUND', 'Unavailable');
          if (scenario === 'error')
            throw new ApiError(0, 'NETWORK_ERROR', 'Offline');
          const workspace = memberships.find((item) => item.id === id);
          if (!workspace) throw new ApiError(404, 'NOT_FOUND', 'Unavailable');
          return {
            workspace,
            visibleBoardCount: scenario === 'empty' ? 0 : 3,
            memberCount: id === personal.id ? 1 : 5,
            recentBoards:
              scenario === 'empty'
                ? []
                : [
                    'Frontend Development',
                    'Backend Development',
                    'Product Roadmap',
                  ].map((name, index) => ({
                    id: `qa-board-${index}`,
                    name,
                    updatedAt: '2026-10-27T09:00:00Z',
                    archived: index === 2,
                  })),
          };
        },
        createTeam: async () => {
          throw new Error('QA preview does not save workspaces.');
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
  runAuthorized: (request) => request('isolated-qa-credential'),
  signIn: () => {
    throw new Error('No login in isolated preview');
  },
  signOut: () => {
    location.href = '/qa/workspace.html?scenario=unavailable';
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
          children: [{ index: true, element: <WorkspaceOverviewPage /> }],
        },
        {
          path: '*',
          element: (
            <p className="p-6">
              This destination belongs to the real application. QA preview only
              renders Workspace screens.
            </p>
          ),
        },
      ],
    },
  ],
  { initialEntries: [params.get('route') ?? '/workspaces/qa-team'] },
);

function Preview() {
  useEffect(() => {
    document.title = `Workspace QA · ${scenario} · ${theme}`;
  }, []);
  return (
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 0, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <ThemeSync />
          <WorkspaceGatewayContext.Provider value={gateway}>
            <div className="fixed right-1 bottom-1 z-30 max-w-[calc(100vw-1rem)] rounded border border-line bg-surface px-2 py-1 text-[10px] text-muted">
              ISOLATED QA FIXTURES · {scenario} · {theme} · No saved data
            </div>
            <RouterProvider router={router} />
          </WorkspaceGatewayContext.Provider>
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
}

if (import.meta.env.DEV)
  createRoot(document.getElementById('root')!).render(<Preview />);
