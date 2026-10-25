import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

const PAGE_1 = 'GET /boards?page=1&limit=100';
const PAGE_2 = 'GET /boards?page=2&limit=100';

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

/** Control actual geometry/ResizeObserver; keep the real useFitGrid hook. */
function gridLayout({ width = 300, height = 300, rowHeight = 136 } = {}) {
  const size = { width, height, rowHeight };
  const observers = new Set<() => void>();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => size.width,
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    () => size.height,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return {
        height: 'fitRow' in this.dataset ? size.rowHeight : 0,
      } as DOMRect;
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        observers.add(this.callback);
      }
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
  return {
    size,
    measure: () => act(() => observers.forEach((callback) => callback())),
  };
}

function openBoards(
  handlers: Record<string, MockResponse | (() => MockResponse)>,
) {
  storeSession();
  const calls = mockApi({ 'GET /users/me': ok(testUser), ...handlers });
  const view = renderApp('/boards');
  return { calls, ...view };
}

describe('BoardsPage', () => {
  it.each(['synchronous', 'deferred'])(
    'preserves cached page 5 on Back with %s measurement (fallback 12, actual 2)',
    async (timing) => {
      const layout = gridLayout();
      const boards = fourteenBoards();
      const selected = boards[8];
      let listReads = 0;
      let finishRefresh!: (response: MockResponse) => void;
      const refresh = new Promise<MockResponse>((resolve) => {
        finishRefresh = resolve;
      });
      storeSession();
      mockApi({
        'GET /users/me': ok(testUser),
        [PAGE_1]: () => (++listReads === 1 ? okPage(boards) : refresh),
        [`GET /boards/${selected.id}`]: ok(selected),
        ...Object.fromEntries(
          ['columns', 'cards', 'members'].map((resource) => [
            `GET /boards/${selected.id}/${resource}?page=1&limit=100`,
            okPage([]),
          ]),
        ),
      });
      const { router } = renderApp('/boards?view=grid');
      fireEvent.click(await screen.findByRole('button', { name: 'Page 5' }));
      fireEvent.click(await screen.findByRole('link', { name: 'Item 09' }));
      await screen.findByRole('heading', { name: 'Item 09' });

      // Remount with cached data; the initial render still uses the fallback.
      if (timing === 'deferred') layout.size.width = 0;
      await act(() => router.navigate(-1));
      expect(router.state.location.search).toBe('?view=grid&page=5');
      expect(listReads).toBe(2);
      if (timing === 'deferred') {
        // Fallback 4 x 3 = 12 temporarily renders the last two of fourteen boards.
        expect(screen.getByRole('link', { name: 'Item 14' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Item 09' })).toBeNull();

        // Width alone must not unlock URL clamping while row height is unknown.
        layout.size.width = 300;
        layout.size.rowHeight = 0;
        layout.measure();
        expect(router.state.location.search).toBe('?view=grid&page=5');
        layout.size.rowHeight = 136;
        layout.measure();
      }
      expect(screen.getByRole('link', { name: 'Item 09' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Item 10' })).toBeTruthy();
      expect(router.state.location.search).toBe('?view=grid&page=5');
      expect(
        screen
          .getByRole('button', { name: 'Page 5' })
          .getAttribute('aria-current'),
      ).toBe('page');
      await act(async () => {
        finishRefresh(okPage(boards));
        await refresh;
      });
      expect(router.state.location.search).toBe('?view=grid&page=5');
    },
  );

  it('waits for row measurement before clamping an invalid page, and keeps unrelated parameters', async () => {
    const layout = gridLayout({ rowHeight: 0 });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: okPage(fourteenBoards()),
    });
    const { router } = renderApp('/boards?page=99&view=grid');
    await screen.findByRole('link', { name: 'Item 14' });
    expect(router.state.location.search).toBe('?page=99&view=grid');
    layout.size.rowHeight = 136;
    layout.measure();
    await waitFor(() =>
      expect(router.state.location.search).toBe('?page=7&view=grid'),
    );
    expect(screen.getByRole('link', { name: 'Item 13' })).toBeTruthy();
  });

  it('normalizes an empty loaded list without waiting for a row that does not exist', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser), [PAGE_1]: okPage([]) });
    const { router } = renderApp('/boards?page=5&view=grid');
    await screen.findByRole('heading', { name: 'No boards yet' });
    await waitFor(() =>
      expect(router.state.location.search).toBe('?view=grid'),
    );
    expect(
      screen.queryByRole('navigation', { name: 'Boards pages' }),
    ).toBeNull();
  });

  it('uses measured capacity when sidebar toggles change the available width', async () => {
    // Two rows: expanded has one column; collapsed has two columns.
    const layout = gridLayout();
    const { router } = openBoards({ [PAGE_1]: okPage(fourteenBoards()) });
    fireEvent.click(await screen.findByRole('button', { name: 'Page 5' }));
    await screen.findByRole('link', { name: 'Item 09' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    layout.size.width = 600;
    layout.measure();
    await waitFor(() => expect(router.state.location.search).toBe('?page=4'));
    expect(screen.getByRole('link', { name: 'Item 13' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    layout.size.width = 300;
    layout.measure();
    expect(router.state.location.search).toBe('?page=4');
    expect(screen.getByRole('link', { name: 'Item 07' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page 7' })).toBeTruthy();
  });

  it('keeps creation hidden and preserves the requested page throughout initial loading', async () => {
    let finish!: (response: MockResponse) => void;
    const response = new Promise<MockResponse>((resolve) => {
      finish = resolve;
    });
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser), [PAGE_1]: () => response });
    const { router } = renderApp('/boards?page=2');
    await screen.findByText('Loading boards…');
    expect(
      screen.queryByRole('button', { name: /New Board|Create.*board/i }),
    ).toBeNull();
    expect(router.state.location.search).toBe('?page=2');
    await act(async () => {
      finish(okPage(fourteenBoards()));
      await response;
    });
    await screen.findByRole('link', { name: 'Item 13' });
    expect(router.state.location.search).toBe('?page=2');
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );
  });

  it('clamps after boards disappear and returns to the single empty-state action', async () => {
    gridLayout({ width: 900, height: 600 });
    let count = 13;
    const { router } = openBoards({
      [PAGE_1]: () =>
        okPage(
          Array.from({ length: count }, (_, i) =>
            makeBoard({ name: `Project ${i + 1}` }),
          ),
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await screen.findByRole('link', { name: 'Project 13' });
    count = 12;
    const refocus = () =>
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    refocus();
    await screen.findByRole('link', { name: 'Project 1' });
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(
      screen.queryByRole('navigation', { name: 'Boards pages' }),
    ).toBeNull();
    count = 0;
    refocus();
    await screen.findByRole('heading', { name: 'No boards yet' });
    expect(screen.queryByRole('button', { name: 'New Board' })).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Create board' }),
    ).toHaveLength(1);
  });

  it('shows the boards from the API with role and update time', async () => {
    const product = makeBoard({
      name: 'Product Development',
      description: 'Plan and track product work.',
      currentUserRole: 'OWNER',
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const marketing = makeBoard({
      name: 'Marketing Campaigns',
      currentUserRole: 'MEMBER',
    });
    openBoards({ [PAGE_1]: okPage([product, marketing]) });

    const link = await screen.findByRole('link', {
      name: 'Product Development',
    });
    expect(link.getAttribute('href')).toBe(`/boards/${product.id}`);

    const productCard = link.closest('article')!;
    expect(
      within(productCard).getByText('Plan and track product work.'),
    ).toBeTruthy();
    expect(within(productCard).getByText('Owner')).toBeTruthy();
    expect(productCard.textContent).toContain('Updated 2 hours ago');

    const marketingCard = screen
      .getByRole('link', { name: 'Marketing Campaigns' })
      .closest('article')!;
    expect(within(marketingCard).getByText('Member')).toBeTruthy();
    expect(within(marketingCard).getByText('No description')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );
    expect(screen.queryByRole('button', { name: /Create.*board/i })).toBeNull();
  });

  it('highlights Boards in the sidebar', async () => {
    openBoards({ [PAGE_1]: okPage([]) });
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    await waitFor(() =>
      expect(
        within(nav)
          .getByRole('button', { name: 'Boards' })
          .getAttribute('aria-current'),
      ).toBe('page'),
    );
  });

  it('shows a loading state, then an empty state without a search box', async () => {
    openBoards({ [PAGE_1]: okPage([]) });

    expect((await screen.findByRole('status')).textContent).toMatch(
      /Checking your session|Loading boards/,
    );
    expect(
      await screen.findByRole('heading', { name: 'No boards yet' }),
    ).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New Board' })).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Create board' }),
    ).toHaveLength(1);
  });

  it('shows an error with retry', async () => {
    let attempt = 0;
    openBoards({
      [PAGE_1]: () => {
        attempt += 1;
        return attempt === 1
          ? fail(403, 'FORBIDDEN')
          : okPage([makeBoard({ name: 'Recovered' })]);
      },
    });

    expect(
      await screen.findByRole('heading', {
        name: "We couldn't load your boards",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /New Board|Create.*board/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Recovered' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );
  });

  it('filters loaded boards by name or description', async () => {
    openBoards({
      [PAGE_1]: okPage([
        makeBoard({
          name: 'Design Team',
          description: 'Requests and feedback',
        }),
        makeBoard({
          name: 'Q3 Planning',
          description: 'Goals for the quarter',
        }),
      ]),
    });
    const search = await screen.findByRole('searchbox', {
      name: 'Search boards',
    });

    fireEvent.change(search, { target: { value: 'FEEDBACK' } });
    expect(screen.getByRole('link', { name: 'Design Team' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Q3 Planning' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );

    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(
      screen.getByRole('heading', { name: 'No matching boards' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );
    expect(screen.queryByRole('button', { name: /Create.*board/i })).toBeNull();
  });

  it('loads every page from the API before showing the boards', async () => {
    openBoards({
      [PAGE_1]: okPage([makeBoard({ name: 'Page one board' })], {
        page: 1,
        limit: 100,
        total: 101,
      }),
      [PAGE_2]: okPage([makeBoard({ name: 'Page two board' })], {
        page: 2,
        limit: 100,
        total: 101,
      }),
    });

    expect(
      await screen.findByRole('link', { name: 'Page two board' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Page one board' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('shows the whole list as an error when a later page fails', async () => {
    openBoards({
      [PAGE_1]: okPage([makeBoard({ name: 'First page' })], {
        page: 1,
        limit: 100,
        total: 101,
      }),
      [PAGE_2]: fail(403, 'FORBIDDEN'),
    });

    expect(
      await screen.findByRole('heading', {
        name: "We couldn't load your boards",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'First page' })).toBeNull();
  });

  // Without layout (jsdom), a page holds the fallback 4 rows × 3 columns = 12 tiles.
  const fourteenBoards = () =>
    Array.from({ length: 14 }, (_, index) =>
      makeBoard({ name: `Item ${String(index + 1).padStart(2, '0')}` }),
    );

  it.each([
    [12, 1, 12],
    [13, 2, 1],
    [25, 3, 1],
  ])(
    'paginates %s real boards into %s pages without a creation-only page',
    async (count, pageCount, finalCount) => {
      openBoards({
        [PAGE_1]: okPage(
          Array.from({ length: count }, (_, i) =>
            makeBoard({ name: `Board ${i + 1}` }),
          ),
        ),
      });
      await screen.findByRole('link', { name: 'Board 1' });
      if (pageCount === 1) {
        expect(
          screen.queryByRole('navigation', { name: 'Boards pages' }),
        ).toBeNull();
      } else {
        const pages = within(
          screen.getByRole('navigation', { name: 'Boards pages' }),
        );
        expect(
          pages.queryByRole('button', { name: `Page ${pageCount + 1}` }),
        ).toBeNull();
        fireEvent.click(
          pages.getByRole('button', { name: `Page ${pageCount}` }),
        );
        await screen.findByRole('link', { name: `Board ${count}` });
      }
      expect(
        within(screen.getByRole('main')).getAllByRole('article'),
      ).toHaveLength(finalCount);
      expect(
        screen.queryByRole('button', { name: /Create.*board/i }),
      ).toBeNull();
    },
  );

  it('splits boards into numbered pages instead of scrolling', async () => {
    const { router } = openBoards({ [PAGE_1]: okPage(fourteenBoards()) });

    expect(await screen.findByRole('link', { name: 'Item 01' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Item 12' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Item 13' })).toBeNull();
    const pages = screen.getByRole('navigation', { name: 'Boards pages' });
    expect(
      within(pages)
        .getByRole('button', { name: 'Page 1' })
        .getAttribute('aria-current'),
    ).toBe('page');

    fireEvent.click(within(pages).getByRole('button', { name: 'Page 2' }));

    expect(await screen.findByRole('link', { name: 'Item 13' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Item 14' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Item 01' })).toBeNull();
    // Pagination contains only boards; creation stays in the header.
    expect(
      screen.queryByRole('button', { name: /Create a new board/ }),
    ).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New Board' })).toHaveLength(
      1,
    );
    expect(router.state.location.search).toBe('?page=2');
    expect(
      (
        within(pages).getByRole('button', {
          name: 'Next page',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('opens the page from the URL and clamps it to the last page', async () => {
    gridLayout({ width: 900, height: 600 });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: okPage(fourteenBoards()),
    });
    const { router } = renderApp('/boards?page=9&view=grid');

    expect(await screen.findByRole('link', { name: 'Item 14' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Item 01' })).toBeNull();
    await waitFor(() =>
      expect(router.state.location.search).toBe('?page=2&view=grid'),
    );
  });

  it('goes back to the first page when searching', async () => {
    const { router } = openBoards({ [PAGE_1]: okPage(fourteenBoards()) });
    fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await screen.findByRole('link', { name: 'Item 13' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), {
      target: { value: 'Item 0' },
    });

    expect(await screen.findByRole('link', { name: 'Item 01' })).toBeTruthy();
    expect(router.state.location.search).toBe('');
    // Nine matches fit on one page, so there are no page buttons.
    expect(
      screen.queryByRole('navigation', { name: 'Boards pages' }),
    ).toBeNull();
  });

  it('never shows archived boards', async () => {
    openBoards({
      [PAGE_1]: okPage([
        makeBoard({ name: 'Active board' }),
        makeBoard({ name: 'Old board', isArchived: true }),
      ]),
    });

    expect(
      await screen.findByRole('link', { name: 'Active board' }),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Old board' })).toBeNull();
  });

  it('clears a one-time notice without losing the query string', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser), [PAGE_1]: okPage([]) });
    const { router } = renderApp({
      pathname: '/boards',
      search: '?view=grid',
      state: { notice: 'Board “X” archived.' },
    });

    expect(await screen.findByText('Board “X” archived.')).toBeTruthy();
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(router.state.location.search).toBe('?view=grid');
  });
});
