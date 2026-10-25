import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

function openBoards(
  handlers: Record<string, MockResponse | (() => MockResponse)>,
) {
  storeSession();
  const calls = mockApi({ 'GET /users/me': ok(testUser), ...handlers });
  const view = renderApp('/boards');
  return { calls, ...view };
}

describe('BoardsPage', () => {
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
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: okPage(fourteenBoards()),
    });
    renderApp('/boards?page=9');

    expect(await screen.findByRole('link', { name: 'Item 14' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Item 01' })).toBeNull();
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
