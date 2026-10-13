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

const PAGE_1 = 'GET /boards?page=1&limit=24';
const PAGE_2 = 'GET /boards?page=2&limit=24';

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
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Recovered' })).toBeTruthy();
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

    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(
      screen.getByRole('heading', { name: 'No matching boards' }),
    ).toBeTruthy();
  });

  it('loads more boards when the API has more pages', async () => {
    openBoards({
      [PAGE_1]: okPage([makeBoard({ name: 'Page one board' })], {
        page: 1,
        limit: 24,
        total: 25,
      }),
      [PAGE_2]: okPage([makeBoard({ name: 'Page two board' })], {
        page: 2,
        limit: 24,
        total: 25,
      }),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Load more boards' }),
    );

    expect(
      await screen.findByRole('link', { name: 'Page two board' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Page one board' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Load more boards' }),
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
});
