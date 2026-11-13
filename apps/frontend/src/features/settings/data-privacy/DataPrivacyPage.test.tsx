import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import {
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';

const WORKSPACE = workspaceResponse.id;
const owned = makeBoard({
  id: '6f1c2b8e-3d4a-4b5c-9d8e-7f6a5b4c3d2e',
  name: 'Roadmap',
  workspaceId: WORKSPACE,
});
const memberOnly = makeBoard({
  name: 'Shared with me',
  currentUserRole: 'MEMBER',
  workspaceId: WORKSPACE,
});
const workspaceOnly = makeBoard({
  name: 'Workspace visible',
  currentUserRole: null,
  workspaceId: WORKSPACE,
});
const archivedOwned = makeBoard({
  id: '7a2d3c9f-4e5b-4c6d-8e9f-0a1b2c3d4e5f',
  name: 'Old launch',
  isArchived: true,
  archivedAt: '2026-11-01T00:00:00.000Z',
  workspaceId: WORKSPACE,
});

const ACCOUNT_JSON = '{"schemaVersion":1}';
const exportPath = (id: string, format: 'json' | 'csv') =>
  `GET /boards/${id}/export?format=${format}`;

function file(raw: string, type = 'application/json'): MockResponse {
  return { status: 200, raw, headers: { 'Content-Type': type } };
}

function deferred() {
  let resolve!: (value: MockResponse) => void;
  const promise = new Promise<MockResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function signedIn(
  overrides: Record<
    string,
    | MockResponse
    | ((request: MockRequest) => MockResponse | Promise<MockResponse>)
  > = {},
) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  storeSession();
  const handlers: typeof overrides = {
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=100': okPage([owned, memberOnly, workspaceOnly]),
    'GET /boards?page=1&limit=100&status=archived': okPage([archivedOwned]),
    'GET /workspaces?page=1&limit=100': workspacePage(
      [workspaceResponse],
      1,
      1,
      100,
    ),
    'GET /users/me/export': file(ACCOUNT_JSON),
    [exportPath(owned.id, 'json')]: file('{"board":1}'),
    [exportPath(owned.id, 'csv')]: file('boardId\r\n', 'text/csv'),
    [exportPath(archivedOwned.id, 'json')]: file('{"board":2}'),
    'POST /auth/logout': ok(null),
    ...overrides,
  };
  // Preserve the existing content/security fixtures at the download boundary;
  // Board UI now starts a job rather than calling the synchronous GET route.
  const prepared = new Map<string, MockResponse>();
  for (const board of [owned, archivedOwned]) {
    const path = `/boards/${board.id}/export-jobs`;
    handlers[`POST ${path}`] = async (request) => {
      const format = (request.body as { format: 'json' | 'csv' }).format;
      const fixture = handlers[exportPath(board.id, format)];
      if (!fixture) throw new Error('Missing export fixture');
      const response =
        typeof fixture === 'function' ? await fixture(request) : fixture;
      if (response.status !== 200) return response;
      prepared.set(board.id, response);
      return {
        status: 202,
        body: {
          id: board.id,
          state: 'COMPLETED',
          format,
          attempts: 1,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          progress: 100,
          error: null,
        },
      };
    };
    handlers[`GET ${path}/${board.id}/download`] = () => {
      const response = prepared.get(board.id);
      if (!response) throw new Error('Download before completed fixture');
      return response;
    };
  }
  return mockApi({ ...handlers, ...overrides });
}

let downloads: { name: string; href: string }[];
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
const originalUrl = {
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
};

beforeEach(() => {
  downloads = [];
  createUrl = vi.fn(() => `blob:kanvexa/${downloads.length + 1}`);
  revokeUrl = vi.fn();
  URL.createObjectURL = createUrl as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeUrl as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({
      name: this.download,
      href: this.getAttribute('href') ?? '',
    });
  });
});

afterEach(() => {
  URL.createObjectURL = originalUrl.create;
  URL.revokeObjectURL = originalUrl.revoke;
  vi.restoreAllMocks();
});

async function openPage() {
  const app = renderApp('/settings/data-privacy');
  await screen.findByRole('heading', { name: 'Data & Privacy', level: 1 });
  return app;
}

const accountCard = () =>
  screen.getByRole('region', { name: 'Export account data' });
const boardCard = () =>
  screen.getByRole('region', { name: 'Export board data' });
const boardSelect = () =>
  within(boardCard()).getByLabelText('Board') as HTMLSelectElement;
const exportBoardButton = () =>
  within(boardCard()).getByRole('button', { name: /Export board data/ });

async function boardsLoaded() {
  await waitFor(() => expect(boardSelect().disabled).toBe(false));
}

describe('Data & Privacy page', () => {
  it('matches the approved anatomy: plain heading, two export cards and a notice', async () => {
    signedIn();
    await openPage();
    const heading = screen.getByRole('heading', {
      name: 'Data & Privacy',
      level: 1,
    });
    // No decorative padlock beside the page title.
    expect(heading.parentElement?.querySelector('svg')).toBeNull();
    expect(
      screen.getByText(
        'Manage your data, export a copy, and control your account privacy.',
      ),
    ).toBeTruthy();
    expect(accountCard()).toBeTruthy();
    expect(boardCard()).toBeTruthy();
    expect(within(accountCard()).getByText(/JSON format/)).toBeTruthy();
    expect(screen.getByText(/contain only data you can access/)).toBeTruthy();
    // Honest copy: no activity history promise, no account-format selector.
    expect(screen.queryByText(/activity history/i)).toBeNull();
    expect(within(accountCard()).queryByRole('radio')).toBeNull();
    expect(
      within(screen.getByRole('navigation', { name: 'Settings' }))
        .getByRole('link', { name: 'Data & Privacy' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('downloads the account JSON once with the safe fallback name and revokes the URL', async () => {
    const pending = deferred();
    const calls = signedIn({ 'GET /users/me/export': () => pending.promise });
    await openPage();
    const button = within(accountCard()).getByRole('button', {
      name: 'Export my data',
    });

    fireEvent.click(button);
    const busy = within(accountCard()).getByRole('button', {
      name: /Preparing export/,
    }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(
      calls.filter((call) => call.path === '/users/me/export'),
    ).toHaveLength(1);
    expect(
      calls.find((c) => c.path === '/users/me/export')?.headers,
    ).toMatchObject({ Authorization: 'Bearer stored-token' });

    await act(async () => pending.resolve(file(ACCOUNT_JSON)));
    await within(accountCard()).findByText(/Download started/);
    const today = new Date().toISOString().slice(0, 10);
    expect(downloads).toEqual([
      { name: `kanvexa-account-${today}.json`, href: 'blob:kanvexa/1' },
    ]);
    await waitFor(
      () => expect(revokeUrl).toHaveBeenCalledWith('blob:kanvexa/1'),
      {
        timeout: 2_500,
      },
    );
  });

  it.each([
    [413, 'EXPORT_TOO_LARGE', /larger than the 20 MB limit/],
    [503, 'EXPORT_TIMEOUT', /took too long/],
    [429, 'TOO_MANY_REQUESTS', /Too many export requests/],
    [500, 'INTERNAL_ERROR', /could not be prepared/],
  ])(
    'shows a safe %i message and never saves the error body',
    async (status, code, text) => {
      signedIn({
        'GET /users/me/export': fail(status, code, 'internal detail xyz'),
      });
      await openPage();
      fireEvent.click(
        within(accountCard()).getByRole('button', { name: 'Export my data' }),
      );
      expect(await within(accountCard()).findByRole('alert')).toHaveProperty(
        'textContent',
        expect.stringMatching(text),
      );
      expect(screen.queryByText(/internal detail xyz/)).toBeNull();
      expect(createUrl).not.toHaveBeenCalled();
      expect(downloads).toEqual([]);
      // Retry after a transient failure works.
      expect(
        (
          within(accountCard()).getByRole('button', {
            name: 'Export my data',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    },
  );

  it('reports an offline network failure without a file', async () => {
    signedIn();
    await openPage();
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) =>
        input.endsWith('/users/me/export')
          ? Promise.reject(new TypeError('offline'))
          : realFetch(input, init),
      ),
    );
    fireEvent.click(
      within(accountCard()).getByRole('button', { name: 'Export my data' }),
    );
    expect(
      await within(accountCard()).findByText(/Could not reach the server/),
    ).toBeTruthy();
    expect(downloads).toEqual([]);
  });

  it('lists only Boards the user owns, archived included, with Workspace context', async () => {
    signedIn();
    await openPage();
    await boardsLoaded();
    const options = Array.from(boardSelect().options).map((o) => ({
      value: o.value,
      text: o.textContent,
    }));
    expect(options).toEqual([
      { value: '', text: 'Choose a board you own' },
      { value: owned.id, text: 'Roadmap · Engineering' },
      { value: archivedOwned.id, text: 'Old launch · Engineering · Archived' },
    ]);
    expect(exportBoardButton()).toHaveProperty('disabled', true);
    const json = within(boardCard()).getByRole('radio', { name: /JSON/ });
    const csv = within(boardCard()).getByRole('radio', { name: /CSV/ });
    expect((json as HTMLInputElement).checked).toBe(true);
    expect((csv as HTMLInputElement).checked).toBe(false);
    expect(within(boardCard()).getByText(/One row per card/)).toBeTruthy();
  });

  it('exports the selected Board as CSV and an archived Board as JSON', async () => {
    const calls = signedIn();
    await openPage();
    await boardsLoaded();
    const today = new Date().toISOString().slice(0, 10);

    fireEvent.change(boardSelect(), { target: { value: owned.id } });
    fireEvent.click(within(boardCard()).getByRole('radio', { name: /CSV/ }));
    fireEvent.click(exportBoardButton());
    await within(boardCard()).findByText(/Download started/);
    expect(downloads.at(-1)?.name).toBe(
      `kanvexa-board-${owned.id}-${today}.csv`,
    );

    fireEvent.change(boardSelect(), { target: { value: archivedOwned.id } });
    expect(within(boardCard()).queryByText(/Download started/)).toBeNull();
    fireEvent.click(within(boardCard()).getByRole('radio', { name: /JSON/ }));
    fireEvent.click(exportBoardButton());
    await within(boardCard()).findByText(/Download started/);
    expect(downloads.at(-1)?.name).toBe(
      `kanvexa-board-${archivedOwned.id}-${today}.json`,
    );
    expect(
      calls
        .filter(
          (call) =>
            call.method === 'POST' && call.path.endsWith('/export-jobs'),
        )
        .map((c) => ({
          path: c.path,
          format: (c.body as { format: string }).format,
        })),
    ).toEqual([
      { path: `/boards/${owned.id}/export-jobs`, format: 'csv' },
      { path: `/boards/${archivedOwned.id}/export-jobs`, format: 'json' },
    ]);
  });

  it('TC14: preserves the operation key when acknowledgement is lost and the user retries', async () => {
    let starts = 0;
    const path = `/boards/${owned.id}/export-jobs`;
    const calls = signedIn({
      [`POST ${path}`]: () =>
        ++starts === 1
          ? fail(503, 'UNAVAILABLE')
          : {
              status: 202,
              body: {
                id: owned.id,
                state: 'COMPLETED',
                format: 'json',
                attempts: 1,
                expiresAt: new Date(Date.now() + 900_000).toISOString(),
                progress: 100,
                error: null,
              },
            },
      [`GET ${path}/${owned.id}/download`]: file('{"board":1}'),
    });
    await openPage();
    await boardsLoaded();
    fireEvent.change(boardSelect(), { target: { value: owned.id } });
    fireEvent.click(exportBoardButton());
    await within(boardCard()).findByText(/took too long/);
    fireEvent.click(exportBoardButton());
    await within(boardCard()).findByText(/Download started/);
    const keys = calls
      .filter((call) => call.method === 'POST' && call.path === path)
      .map((call) => call.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(downloads).toHaveLength(1);
  });

  it('shows guidance when the user owns no Boards', async () => {
    signedIn({
      'GET /boards?page=1&limit=100': okPage([memberOnly, workspaceOnly]),
      'GET /boards?page=1&limit=100&status=archived': okPage([]),
    });
    await openPage();
    expect(
      await within(boardCard()).findByText(/You don’t own any boards yet/),
    ).toBeTruthy();
    expect(boardSelect().disabled).toBe(true);
    expect(exportBoardButton()).toHaveProperty('disabled', true);
  });

  it('offers a retry when the Board list cannot load', async () => {
    let attempts = 0;
    signedIn({
      'GET /boards?page=1&limit=100&status=archived': () => {
        attempts += 1;
        return attempts === 1
          ? fail(403, 'FORBIDDEN')
          : okPage([archivedOwned]);
      },
    });
    await openPage();
    fireEvent.click(
      await within(boardCard()).findByRole('button', { name: 'Try again' }),
    );
    await boardsLoaded();
    expect(boardSelect().options).toHaveLength(3);
  });

  it.each([
    [403, 'FORBIDDEN', /Only a current owner/],
    [404, 'NOT_FOUND', /no longer available/],
  ])(
    'on %i clears the selection, refreshes the owner list and saves nothing',
    async (status, code, text) => {
      let listReads = 0;
      signedIn({
        'GET /boards?page=1&limit=100': () => {
          listReads += 1;
          return listReads === 1
            ? okPage([owned, memberOnly])
            : okPage([{ ...owned, currentUserRole: 'MEMBER' }, memberOnly]);
        },
        [exportPath(owned.id, 'json')]: fail(status, code),
      });
      await openPage();
      await boardsLoaded();
      fireEvent.change(boardSelect(), { target: { value: owned.id } });
      fireEvent.click(exportBoardButton());
      expect(await within(boardCard()).findByText(text)).toBeTruthy();
      await waitFor(() => expect(listReads).toBe(2));
      await waitFor(() =>
        expect(Array.from(boardSelect().options).map((o) => o.value)).toEqual([
          '',
          archivedOwned.id,
        ]),
      );
      expect(boardSelect().value).toBe('');
      expect(downloads).toEqual([]);
    },
  );

  it('does not save a file when the session changes during the export', async () => {
    const pending = deferred();
    signedIn({ 'GET /users/me/export': () => pending.promise });
    await openPage();
    fireEvent.click(
      within(accountCard()).getByRole('button', { name: 'Export my data' }),
    );
    // Another tab signs in as someone else before the bytes arrive.
    storeSession('other-account-token');
    await act(async () => pending.resolve(file(ACCOUNT_JSON)));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(createUrl).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('does not save a file after leaving the page mid-export', async () => {
    const pending = deferred();
    signedIn({
      [exportPath(owned.id, 'json')]: () => pending.promise,
      'GET /users/me/preferences': ok({
        theme: 'light',
        timeZone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        weekStartsOn: 'monday',
      }),
    });
    const { router } = await openPage();
    await boardsLoaded();
    fireEvent.change(boardSelect(), { target: { value: owned.id } });
    fireEvent.click(exportBoardButton());
    await act(async () => {
      await router.navigate('/settings/preferences');
    });
    await act(async () => pending.resolve(file('{"board":1}')));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(downloads).toEqual([]);
  });

  it('revokes a fresh object URL at once when the page unmounts', async () => {
    signedIn({
      'GET /users/me/preferences': ok({
        theme: 'light',
        timeZone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        weekStartsOn: 'monday',
      }),
    });
    const { router } = await openPage();
    fireEvent.click(
      within(accountCard()).getByRole('button', { name: 'Export my data' }),
    );
    await within(accountCard()).findByText(/Download started/);
    expect(revokeUrl).not.toHaveBeenCalled();
    await act(async () => {
      await router.navigate('/settings/preferences');
    });
    expect(revokeUrl).toHaveBeenCalledWith('blob:kanvexa/1');
  });

  it('a 401 ends the session instead of saving a file', async () => {
    signedIn({ 'GET /users/me/export': fail(401, 'UNAUTHORIZED') });
    const { router } = await openPage();
    fireEvent.click(
      within(accountCard()).getByRole('button', { name: 'Export my data' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(downloads).toEqual([]);
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });
});
