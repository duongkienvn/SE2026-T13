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
import {
  filterSearchParams,
  parseBoardFilters,
} from '../src/features/cards/board-filter';
import { BoardRealtimeClient } from '../src/features/realtime/board-realtime-client';
import { livePresence } from '../src/features/realtime/board-presence-state';
import { RealtimeContext } from '../src/features/realtime/realtime-context';
import type { Board } from '../src/features/boards/types';
import type { Card } from '../src/features/cards/types';
import { DEFAULT_PREFERENCES } from '../src/features/settings/format';
import { env } from '../src/lib/env';
import { refreshAccessSnapshots } from '../src/features/realtime/access-revocation';
import '../src/style.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'wide';
// Layout-only snapshot, resolved through the same QA roster as Card assignees.
// No socket is created; this fixture does not claim a live backend connection.
const previewPresence = livePresence([
  'qa-owner',
  ...Array.from({ length: 5 }, (_, index) => `qa-member-${index}`),
]);
class PreviewRealtimeClient extends BoardRealtimeClient {
  override watch() {
    return () => undefined;
  }
  override status() {
    return 'live' as const;
  }
  override presence() {
    return previewPresence;
  }
}
const previewRealtime = params.has('viewers')
  ? new PreviewRealtimeClient({
      createSocket: () => {
        throw new Error('No QA socket');
      },
      invalidate: () => undefined,
      verifySession: () => undefined,
    })
  : null;
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
  description: params.has('long')
    ? 'Plan, build, and ship the next Kanvexa release together with product, design, engineering, and operations. '.repeat(
        12,
      )
    : 'Plan, build, and ship the next Kanvexa release together.',
  workspaceId:
    scenario === 'workspace-owner' ? 'joined-destination' : 'source-not-joined',
  visibility: scenario === 'reader' ? 'WORKSPACE_VISIBLE' : 'PRIVATE',
  backgroundPreset: params.get('background') ?? 'mountains',
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
const detailCard: Card = {
  id: 'qa-detail',
  boardId: board.id,
  columnId: 'qa-column-0',
  createdById: 'qa-owner',
  title: 'Prepare the release',
  description: params.has('emptyDescription')
    ? null
    : 'Keep the release notes clear and confirm the final review before sharing the update.',
  position: '1024',
  startDate: '2026-11-04T09:00:00Z',
  dueDate: '2026-11-19T17:00:00Z',
  isArchived: scenario === 'archived',
  archivedAt: null,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  assignees: [
    {
      userId: 'qa-member-1',
      assignedById: 'qa-owner',
      createdAt: board.createdAt,
    },
  ],
};
const detailLabel = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  boardId: board.id,
  name: 'Design review',
  color: '#615CF7',
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
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
  if (params.has('view') && path === '/notifications/unread-count')
    return response({ count: 2 });
  if (params.has('detail') || params.has('view')) {
    const base = params.has('view')
      ? `/boards/${board.id}/cards/${/^\/boards\/qa-board\/cards\/([^/?]+)/.exec(path)?.[1] ?? 'card-0'}`
      : `/boards/${board.id}/cards/${detailCard.id}`;
    if (path === '/users/me/preferences')
      return response({
        ...DEFAULT_PREFERENCES,
        theme: params.get('theme') ?? 'light',
      });
    if (path === base) return response(detailCard);
    if (path === `${base}/labels`)
      return response({ cardId: detailCard.id, labels: [detailLabel] });
    if (path === `${base}/checklists`)
      return response({
        cardId: detailCard.id,
        checkedItems: 2,
        totalItems: 2,
        completionPercentage: 100,
        checklists: [
          {
            id: 'qa-checklist',
            cardId: detailCard.id,
            title: 'Release readiness',
            position: '1024',
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
            checkedItems: 2,
            totalItems: 2,
            completionPercentage: 100,
            items: ['Review the release notes', 'Confirm the final design'].map(
              (text, index) => ({
                id: `qa-item-${index}`,
                checklistId: 'qa-checklist',
                text,
                isChecked: true,
                position: String((index + 1) * 1024),
                createdAt: board.createdAt,
                updatedAt: board.updatedAt,
              }),
            ),
          },
        ],
      });
    if (path.startsWith(`${base}/attachments?`))
      return response(
        [
          {
            id: 'qa-file',
            boardId: board.id,
            cardId: detailCard.id,
            uploaderId: 'qa-owner',
            kind: 'FILE',
            state: 'ACTIVE',
            displayName: 'Release specification.pdf',
            url: null,
            originalFilename: 'specification.pdf',
            mimeType: 'application/pdf',
            byteSize: 438272,
            revision: 1,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
          {
            id: 'qa-link',
            boardId: board.id,
            cardId: detailCard.id,
            uploaderId: 'qa-owner',
            kind: 'URL',
            state: 'ACTIVE',
            displayName: 'Design reference',
            url: 'https://example.invalid/design',
            originalFilename: null,
            mimeType: null,
            byteSize: null,
            revision: 1,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
        ],
        true,
      );
    if (path.startsWith(`${base}/comments?`))
      return response(
        [
          {
            id: 'qa-comment',
            cardId: detailCard.id,
            authorId: 'qa-owner',
            content:
              'The final review is ready. Thanks for the thoughtful updates.',
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
          },
        ],
        true,
      );
  }
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

  if (path.startsWith(`/boards/${board.id}/labels?`))
    return response(
      [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          boardId: board.id,
          name: 'Design review',
          color: '#615CF7',
        },
      ],
      true,
    );
  if (path.startsWith(`/boards/${board.id}/card-preview-summaries?`)) {
    document.documentElement.dataset.summaryRequests = String(
      Number(document.documentElement.dataset.summaryRequests ?? 0) + 1,
    );
    return response({
      summaries: new URLSearchParams(path.split('?')[1])
        .get('cardIds')
        ?.split(',')
        .map((cardId) => ({
          cardId,
          labelIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
          checklist: {
            checkedItems: 2,
            totalItems: params.has('view') ? 2 : 3,
          },
          attachmentCount: 1,
          commentCount: 2,
        })),
    });
  }
  if (params.has('empty') && /\/boards\/qa-board\/(columns|cards)\?/.test(path))
    return response([], true);
  if (/^\/boards\/qa-board\/(columns|cards|members)\?/.test(path)) {
    if (
      ['wide', 'large', 'tall', 'reader', 'archived'].includes(scenario) &&
      path.includes('/columns?')
    )
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
    if (
      ['wide', 'large', 'tall', 'reader', 'archived'].includes(scenario) &&
      path.includes('/cards?')
    ) {
      document.documentElement.dataset.cardPageRequests = String(
        Number(document.documentElement.dataset.cardPageRequests ?? 0) + 1,
      );
      const total =
        scenario === 'large'
          ? 1000
          : scenario === 'tall'
            ? 40
            : params.has('view')
              ? 6
              : 10;
      const page = Number(
        new URLSearchParams(path.split('?')[1]).get('page') ?? 1,
      );
      const rows = Array.from(
        { length: Math.min(100, Math.max(0, total - (page - 1) * 100)) },
        (_, offset) => {
          const index = (page - 1) * 100 + offset;
          return {
            id: `card-${index}`,
            boardId: board.id,
            columnId: `column-${index % 5}`,
            title: [
              'Design landing page',
              'Implement board filter',
              'Review release notes',
              'Update dependencies',
              'Write documentation',
            ][index % 5],
            description:
              'A longer description to check the compact preview layout.',
            position: `${index + 1}.0000000000`,
            createdById: board.createdById,
            startDate: params.has('view')
              ? `${new Date().toISOString().slice(0, 7)}-02T08:00:00Z`
              : index % 3 === 1
                ? '2027-04-12T08:00:00Z'
                : null,
            dueDate: params.has('view')
              ? `${new Date().toISOString().slice(0, 7)}-${['05', '04', '19', '16', '10', '13'][index % 6]}T12:00:00Z`
              : index % 3 === 2
                ? null
                : '2027-04-15T12:00:00Z',
            isArchived: false,
            archivedAt: null,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
            assignees:
              index % 3 === 0
                ? []
                : [
                    {
                      userId: `qa-member-${index % 5}`,
                      assignedById: board.createdById,
                      createdAt: board.createdAt,
                    },
                  ],
          };
        },
      );
      return new Response(
        JSON.stringify({
          success: true,
          statusCode: 200,
          message: 'OK',
          data: rows,
          meta: { page, limit: 100, total, totalPages: Math.ceil(total / 100) },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    return response([], true);
  }
  throw new Error(`Unexpected QA request: ${path}`);
};
const auth: AuthContextValue = {
  status: 'authenticated',
  user: {
    id: 'qa-owner',
    email: 'qa@example.invalid',
    displayName: params.has('detail') ? 'Linh Nguyen' : 'QA Owner',
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
            { path: 'cards/:cardId', element: null },
            { path: 'settings', element: null },
            { path: 'members', element: <BoardMembersPage /> },
            { path: 'calendar', element: null },
            { path: 'table', element: null },
          ],
        },
      ],
    },
  ],
  {
    initialEntries: [
      `/boards/${board.id}${params.has('detail') ? `/cards/${detailCard.id}` : ['calendar', 'table'].includes(params.get('view') ?? '') ? `/${params.get('view')}` : params.get('route') === 'members' ? '/members' : params.get('settings') === 'true' ? '/settings' : ''}?${filterSearchParams(parseBoardFilters(params))}`,
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
          <div className="fixed right-1 bottom-1 z-30 rounded border border-line bg-surface px-2 py-1 text-[10px] text-muted">
            ISOLATED QA · {scenario} · No saved data
          </div>
          <RealtimeContext.Provider value={previewRealtime}>
            <RouterProvider router={router} />
          </RealtimeContext.Provider>
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );

if (params.has('openFilter')) {
  const observer = new MutationObserver(() => {
    const button = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === 'Filter',
    );
    if (button) {
      observer.disconnect();
      button.click();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

document.documentElement.dataset.qaViewportWidth = String(window.innerWidth);
