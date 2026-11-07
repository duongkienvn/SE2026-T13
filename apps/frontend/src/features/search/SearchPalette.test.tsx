import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { GlobalSearchResults } from '@kanban/shared';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { AuthSessionContext } from '../auth/auth-session-context';
import { testUser } from '../../test/mock-api';
import { SearchTrigger } from './SearchTrigger';
import { refreshSearch } from './cache';
import { globalSearch } from './api';
import { ApiError } from '../../lib/api-client';

vi.mock('./api', () => ({ globalSearch: vi.fn() }));

const grouped: GlobalSearchResults = {
  query: 'plan',
  type: 'all',
  groups: {
    workspaces: {
      items: [
        {
          type: 'workspace',
          id: 'w',
          title: 'Workspace',
          subtitle: null,
          path: '/workspaces/w',
        },
      ],
      total: 1,
      hasMore: false,
    },
    boards: {
      items: [
        {
          type: 'board',
          id: 'b',
          title: 'Guest board',
          subtitle: null,
          workspaceId: 'w',
          workspaceName: null,
          path: '/boards/b',
        },
      ],
      total: 2,
      hasMore: true,
    },
    cards: {
      items: [
        {
          type: 'card',
          id: 'c',
          title: 'Card',
          subtitle: '<b>literal</b>',
          boardId: 'b',
          boardName: 'Guest board',
          workspaceId: 'w',
          workspaceName: null,
          path: '/boards/b/cards/c',
        },
      ],
      total: 1,
      hasMore: false,
    },
  },
};
const auth: AuthContextValue = {
  status: 'authenticated',
  user: testUser,
  signIn: vi.fn(),
  signOut: vi.fn(),
  retry: vi.fn(),
  runAuthorized: (request) => request('token'),
};
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <AuthSessionContext.Provider
          value={{
            generation: 1,
            isCurrent: () => true,
            canFinishRevokingRequest: () => true,
          }}
        >
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<SearchTrigger />} />
              <Route path="/boards/b" element={<p>Board destination</p>} />
            </Routes>
          </MemoryRouter>
        </AuthSessionContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { client, ...view };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('global search palette', () => {
  it('keeps settled rows and the selected identity through refresh, reordering and a failed refresh', async () => {
    let finish!: (value: GlobalSearchResults) => void;
    vi.mocked(globalSearch)
      .mockResolvedValueOnce(grouped)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const { client } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'plan' } });
    await screen.findByText('Guest board');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = input.getAttribute('aria-activedescendant');
    act(() => {
      void client.refetchQueries({ queryKey: ['search'] });
    });
    await waitFor(() => expect(globalSearch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Guest board')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(selected);
    expect(document.querySelector('.motion-safe\\:animate-pulse')).toBeNull();
    await act(async () =>
      finish({
        ...grouped,
        groups: {
          ...grouped.groups,
          workspaces: { items: [], total: 0, hasMore: false },
        },
      }),
    );
    expect(input.getAttribute('aria-activedescendant')).toBe(selected);
    expect(
      screen
        .getByRole('option', { name: /Guest board/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    vi.mocked(globalSearch).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['search'] });
    });
    await screen.findByText(/Could not refresh search/);
    expect(screen.getByText('Guest board')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(selected);
    // An authorization refresh must discard even this retained failed snapshot.
    vi.mocked(globalSearch).mockImplementation(() => new Promise(() => {}));
    act(() => refreshSearch(client));
    await waitFor(() => expect(screen.queryByText('Guest board')).toBeNull());
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('never restores a denied snapshot while retrying or after another network failure', async () => {
    vi.mocked(globalSearch)
      .mockResolvedValueOnce(grouped)
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    const { client } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    await screen.findByText('Guest board');
    await act(async () => {
      await client.refetchQueries({ queryKey: ['search'] });
    });
    await screen.findByText('Search is unavailable. Please try again.');
    expect(screen.queryByText('Guest board')).toBeNull();
    vi.mocked(globalSearch).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(globalSearch).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Guest board')).toBeNull();
  });

  it('debounces, renders safe grouped fields, and navigates the active result', async () => {
    vi.mocked(globalSearch).mockResolvedValue(grouped);
    setup();
    const trigger = screen.getByRole('button', { name: 'Search' });
    trigger.focus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  plan  ' } });
    expect(globalSearch).not.toHaveBeenCalled();
    expect(await screen.findByText('Guest board')).toBeTruthy();
    expect(globalSearch).toHaveBeenCalledWith(
      'token',
      { q: 'plan', type: 'all' },
      expect.any(AbortSignal),
    );
    expect(screen.getByText('<b>literal</b>').querySelector('b')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(
      screen
        .getByRole('option', { name: /Guest board/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Board destination')).toBeTruthy();
  });

  it('switches views and deduplicates loaded pages', async () => {
    const first: GlobalSearchResults = {
      ...grouped,
      type: 'boards',
      groups: {
        ...grouped.groups,
        boards: { ...grouped.groups.boards, hasMore: true },
      },
    };
    const second: GlobalSearchResults = {
      ...first,
      groups: {
        ...first.groups,
        boards: { ...first.groups.boards, hasMore: false },
      },
    };
    vi.mocked(globalSearch).mockImplementation(async (_token, request) =>
      request.type === 'all' ? grouped : request.page === 1 ? first : second,
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'See all Boards' }),
    );
    await waitFor(() =>
      expect(globalSearch).toHaveBeenCalledWith(
        'token',
        { q: 'plan', type: 'boards', page: 1 },
        expect.any(AbortSignal),
      ),
    );
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    act(() => {
      loadMore.click();
      loadMore.click();
    });
    await waitFor(() =>
      expect(globalSearch).toHaveBeenCalledWith(
        'token',
        { q: 'plan', type: 'boards', page: 2 },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull(),
    );
    expect(
      vi
        .mocked(globalSearch)
        .mock.calls.filter(
          ([, request]) => request.type === 'boards' && request.page === 2,
        ),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(globalSearch)
        .mock.calls.some(
          ([, request]) => request.type === 'boards' && request.page > 2,
        ),
    ).toBe(false);
    expect(screen.getAllByRole('option', { name: /Guest board/ })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByRole('button', { name: /Back to all/ }));
    expect(await screen.findByText('Workspace')).toBeTruthy();
  });

  it('keeps the selected settled page visible while loading another page', async () => {
    let finish!: (value: GlobalSearchResults) => void;
    const first = { ...grouped, type: 'boards' as const };
    vi.mocked(globalSearch).mockImplementation((_token, request) => {
      if (request.type === 'all') return Promise.resolve(grouped);
      if (request.page === 1) return Promise.resolve(first);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'plan' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'See all Boards' }),
    );
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = input.getAttribute('aria-activedescendant');
    fireEvent.click(loadMore);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.getByText('Guest board')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBe(selected);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(document.querySelector('.motion-safe\\:animate-pulse')).toBeNull();
    await act(async () =>
      finish({
        ...first,
        groups: {
          ...first.groups,
          boards: { ...first.groups.boards, hasMore: false },
        },
      }),
    );
    expect(screen.getAllByRole('option', { name: /Guest board/ })).toHaveLength(
      1,
    );
    expect(input.getAttribute('aria-activedescendant')).toBe(selected);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('clears protected results on revocation and restores focus on close', async () => {
    vi.mocked(globalSearch)
      .mockResolvedValueOnce(grouped)
      .mockImplementation(() => new Promise(() => {}));
    const { client } = setup();
    const trigger = screen.getByRole('button', { name: 'Search' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    expect(await screen.findByText('Guest board')).toBeTruthy();
    act(() => refreshSearch(client));
    await waitFor(() => expect(screen.queryByText('Guest board')).toBeNull());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not open over another modal or search whitespace and rejects overlong Unicode', async () => {
    setup();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(within(modal).queryByRole('combobox')).toBeNull();
    modal.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.change(input, { target: { value: '😀'.repeat(121) } });
    expect(screen.getByRole('status').textContent).toBe(
      'Search is limited to 120 characters.',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(globalSearch).not.toHaveBeenCalled();
  });

  it('aborts and ignores an old response when the query changes', async () => {
    let finish: (value: GlobalSearchResults) => void = () => {};
    vi.mocked(globalSearch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        ...grouped,
        query: 'new',
        groups: {
          workspaces: { items: [], total: 0, hasMore: false },
          boards: { items: [], total: 0, hasMore: false },
          cards: { items: [], total: 0, hasMore: false },
        },
      });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'old' } });
    await waitFor(() => expect(globalSearch).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(globalSearch).mock.calls[0][2];
    fireEvent.change(input, { target: { value: 'new' } });
    await waitFor(() => expect(oldSignal.aborted).toBe(true));
    await act(async () => finish(grouped));
    expect(screen.queryByText('Guest board')).toBeNull();
    expect(
      await screen.findByText('No results. Try a different search.'),
    ).toBeTruthy();
  });

  it('retries errors and keeps a composing Escape inside the dialog', async () => {
    vi.mocked(globalSearch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(grouped);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'plan' } });
    expect(
      await screen.findByText('Search is unavailable. Please try again.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Guest board')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers an offline message and dismisses from the backdrop', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(globalSearch).mockRejectedValue(new Error('network'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    expect(
      await screen.findByText(
        'You are offline. Check your connection and try again.',
      ),
    ).toBeTruthy();
    const backdrop = document.querySelector('[data-dialog-backdrop]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('dialog')).toBeNull();
    online.mockRestore();
  });

  it('clears results when a Board query is invalidated by an existing mutation', async () => {
    vi.mocked(globalSearch)
      .mockResolvedValueOnce(grouped)
      .mockImplementation(() => new Promise(() => {}));
    const { client } = setup();
    client.setQueryData(['boards', 'list'], []);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    expect(await screen.findByText('Guest board')).toBeTruthy();
    act(() => {
      void client.invalidateQueries({ queryKey: ['boards', 'list'] });
    });
    await waitFor(() => expect(screen.queryByText('Guest board')).toBeNull());
  });

  it('traps keyboard focus and ignores shortcuts while another dialog is open', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Search' });
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close search' });
    const input = screen.getByRole('combobox');
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the previously focused element after a shortcut', () => {
    setup();
    const previous = document.createElement('button');
    document.body.append(previous);
    previous.focus();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(previous);
    previous.remove();
  });

  it('waits for IME composition to finish before searching', async () => {
    vi.mocked(globalSearch).mockResolvedValue(grouped);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('combobox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'plan' } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(globalSearch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    expect(await screen.findByText('Guest board')).toBeTruthy();
  });

  it('accepts 120 Unicode code points without splitting surrogate pairs', async () => {
    vi.mocked(globalSearch).mockResolvedValue(grouped);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const value = '😀'.repeat(120);
    fireEvent.change(screen.getByRole('combobox'), { target: { value } });
    await waitFor(() =>
      expect(globalSearch).toHaveBeenCalledWith(
        'token',
        { q: value, type: 'all' },
        expect.any(AbortSignal),
      ),
    );
  });

  it('aborts the old session on unmount and does not expose its late response', async () => {
    let finish: (value: GlobalSearchResults) => void = () => {};
    vi.mocked(globalSearch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'plan' },
    });
    await waitFor(() => expect(globalSearch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(globalSearch).mock.calls[0][2];
    first.unmount();
    expect(signal.aborted).toBe(true);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => finish(grouped));
    expect(screen.queryByText('Guest board')).toBeNull();
    expect(
      screen.getByText(
        'Start typing to search your workspaces, boards and cards.',
      ),
    ).toBeTruthy();
  });
});
