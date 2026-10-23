import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';
import {
  makeBoard,
  makeCard,
  makeColumn,
  makeMember,
  okPage,
} from '../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import type { Comment } from './types';

const comment = (
  cardId: string,
  overrides: Partial<Comment> = {},
): Comment => ({
  id: '00000000-0000-4000-8000-000000000009',
  cardId,
  authorId: testUser.id,
  content: 'Hello\n<script>alert(1)</script>',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...overrides,
});

function setup({
  archivedBoard = false,
  archivedCard = false,
  role = 'OWNER',
  list,
  extra = {},
}: {
  archivedBoard?: boolean;
  archivedCard?: boolean;
  role?: 'OWNER' | 'MEMBER';
  list: MockResponse | (() => MockResponse | Promise<MockResponse>);
  extra?:
    | Record<
        string,
        MockResponse | (() => MockResponse | Promise<MockResponse>)
      >
    | ((
        path: string,
        cardId: string,
      ) => Record<
        string,
        MockResponse | (() => MockResponse | Promise<MockResponse>)
      >);
}) {
  storeSession();
  const board = makeBoard({ isArchived: archivedBoard, currentUserRole: role });
  const column = makeColumn({ boardId: board.id });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Discussion',
  });
  const path = `/boards/${board.id}/cards/${card.id}/comments`;
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([
      makeMember(),
    ]),
    [`GET /boards/${board.id}/cards/${card.id}`]: ok({
      ...card,
      isArchived: archivedCard,
    }),
    [`GET ${path}?page=1&limit=20`]: list,
    ...(typeof extra === 'function' ? extra(path, card.id) : extra),
  });
  renderApp(`/boards/${board.id}`);
  return { card, path, calls };
}

async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Discussion' }));
  return screen.findByRole('dialog', { name: 'Discussion' });
}

describe('card comments', () => {
  it('allows a MEMBER to write from an empty list', async () => {
    setup({
      role: 'MEMBER',
      list: okPage([]),
    });
    const dialog = await open();
    expect(await within(dialog).findByText('No comments yet')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    ).toBeTruthy();
  }, 15000);

  it('shows escaped Unicode/newlines, former member and no edit for another author even as OWNER', async () => {
    const former = '00000000-0000-4000-8000-000000000005';
    const board = makeBoard();
    // Use the actual generated card id by returning the response on request.
    storeSession();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Discussion',
    });
    const path = `/boards/${board.id}/cards/${card.id}`;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET ${path}`]: ok(card),
      [`GET ${path}/comments?page=1&limit=20`]: okPage(
        [
          comment(card.id, {
            authorId: former,
            content: 'Xin chào\n<script>alert(1)</script>',
          }),
        ],
        { limit: 20 },
      ),
    });
    renderApp(`/boards/${board.id}`);
    const dialog = await open();
    expect(await within(dialog).findByText('Former member')).toBeTruthy();
    const text = within(dialog).getByText(/Xin chào/);
    expect(text.textContent).toContain('<script>alert(1)</script>');
    expect(text.querySelector('script')).toBeNull();
    expect(text.className).toContain('whitespace-pre-wrap');
    expect(
      within(dialog).queryByRole('button', { name: 'Edit comment' }),
    ).toBeNull();
  });

  it.each([{ archivedBoard: true }, { archivedCard: true }])(
    'keeps comments readable but hides writes when archived (%o)',
    async (state) => {
      setup({ ...state, list: okPage([]) });
      // List is still fetched even in read-only mode.
      const dialog = await open();
      await within(dialog).findByText('No comments yet');
      expect(
        within(dialog).queryByRole('button', { name: 'Post comment' }),
      ).toBeNull();
    },
  );

  it('offers retry on failure without hiding the card', async () => {
    let count = 0;
    setup({
      list: () =>
        ++count === 1 ? fail(404, 'CARD_NOT_FOUND') : okPage([], { limit: 20 }),
    });
    const dialog = await open();
    expect(
      await within(dialog).findByText('Comments unavailable'),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: 'Post comment' }),
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('No comments yet')).toBeTruthy();
  });

  it('uses numbered pages in ascending order and navigates to the last page after posting', async () => {
    let last: Comment[] = [
      comment('card', { id: 'last', content: 'Older last page' }),
    ];
    const { path, calls } = setup({
      list: okPage(
        Array.from({ length: 20 }, (_, i) =>
          comment('card', { id: `first-${i}`, content: `First ${i}` }),
        ),
        { limit: 20, total: 21 },
      ),
      extra: (commentsPath, cardId) => ({
        [`GET ${commentsPath}?page=2&limit=20`]: () =>
          okPage(last, { page: 2, limit: 20, total: last.length + 20 }),
        [`POST ${commentsPath}`]: () => {
          last = [...last, comment(cardId, { id: 'new', content: 'Newest' })];
          return ok(last[1], 201);
        },
      }),
    });
    const dialog = await open();
    await within(dialog).findByText('First 0');
    expect(within(dialog).queryByText('Older last page')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Write a comment'), {
      target: { value: 'Newest' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    expect(await within(dialog).findByText('Newest')).toBeTruthy();
    expect(calls.some((call) => call.path === `${path}?page=2&limit=20`)).toBe(
      true,
    );
    expect(
      (
        await within(dialog).findByRole('button', { name: 'Page 2' })
      ).getAttribute('aria-current'),
    ).toBe('page');
  }, 15000);

  it('follows the last page when a remote comment creates a new page', async () => {
    let total = 20;
    const first = Array.from({ length: 20 }, (_, i) =>
      comment('card', { id: `first-${i}`, content: `First ${i}` }),
    );
    setup({
      list: () => okPage(first, { limit: 20, total }),
      extra: (path, cardId) => ({
        [`GET ${path}?page=2&limit=20`]: () =>
          okPage(
            [comment(cardId, { id: 'remote', content: 'Remote newest' })],
            {
              page: 2,
              limit: 20,
              total,
            },
          ),
      }),
    });
    const dialog = await open();
    await within(dialog).findByText('First 0');
    try {
      act(() => {
        focusManager.setFocused(false);
        total = 21;
        focusManager.setFocused(true);
      });
      expect(await within(dialog).findByText('Remote newest')).toBeTruthy();
      expect(
        within(dialog)
          .getByRole('button', { name: 'Page 2' })
          .getAttribute('aria-current'),
      ).toBe('page');
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it.each([20, 0])(
    'returns to page 1 when the current page is removed (total %i)',
    async (total) => {
      let remaining = 21;
      const first = Array.from({ length: 20 }, (_, i) =>
        comment('card', { id: `first-${i}`, content: `First ${i}` }),
      );
      const { path, calls } = setup({
        list: () =>
          okPage(remaining ? first : [], {
            limit: 20,
            total: remaining,
          }),
        extra: (commentsPath) => ({
          [`GET ${commentsPath}?page=2&limit=20`]: () => {
            remaining = total;
            return okPage([], { page: 2, limit: 20, total });
          },
        }),
      });
      const dialog = await open();
      await within(dialog).findByText('First 0');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Page 2' }));
      await waitFor(() =>
        expect(
          within(dialog)
            .getByRole('button', { name: 'Page 1' })
            .getAttribute('aria-current'),
        ).toBe('page'),
      );
      expect(
        calls.some((call) => call.path === `${path}?page=2&limit=20`),
      ).toBe(true);
      if (total === 0) {
        expect(await within(dialog).findByText('No comments yet')).toBeTruthy();
      }
    },
    15000,
  );

  it('keeps a failed validation draft and shows the backend field error', async () => {
    const { calls } = setup({
      list: okPage([], { limit: 20 }),
      extra: (path) => ({
        [`POST ${path}`]: fail(400, 'VALIDATION_FAILED', 'Validation failed', [
          'content: content must be shorter than or equal to 2000 characters',
        ]),
      }),
    });
    const dialog = await open();
    await within(dialog).findByText('No comments yet');
    fireEvent.change(within(dialog).getByLabelText('Write a comment'), {
      target: { value: 'draft' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    expect(
      await within(dialog).findByText(/Comment must be shorter/),
    ).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('Write a comment') as HTMLTextAreaElement)
        .value,
    ).toBe('draft');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    fireEvent.change(within(dialog).getByLabelText('Write a comment'), {
      target: { value: 'corrected draft' },
    });
    expect(within(dialog).queryByText(/Comment must be shorter/)).toBeNull();
  });

  it('clears a failed edit error when the comment draft changes', async () => {
    const own = comment('card', { content: 'Original' });
    setup({
      list: okPage([own], { limit: 20 }),
      extra: (path) => ({
        [`PATCH ${path}/${own.id}`]: fail(
          400,
          'VALIDATION_FAILED',
          'Validation failed',
          ['content: content is invalid'],
        ),
      }),
    });
    const dialog = await open();
    await within(dialog).findByText('Original');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Edit comment' }),
    );
    const input = within(dialog).getByLabelText('Edit comment');
    fireEvent.change(input, { target: { value: 'First edit' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save comment' }),
    );
    expect(await within(dialog).findByText('Comment is invalid')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Corrected edit' } });
    expect(within(dialog).queryByText('Comment is invalid')).toBeNull();
  });

  it('creates, edits and soft-deletes with trimmed body and 204, without submitting the card form', async () => {
    // Handlers populated with card-specific paths in the same style as board fixtures.
    storeSession();
    const board = makeBoard({ currentUserRole: 'MEMBER' });
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Discussion',
    });
    const path = `/boards/${board.id}/cards/${card.id}`;
    const initial = comment(card.id, { content: 'Xin chào' });
    const edited = {
      ...initial,
      content: 'Changed\n✅',
      updatedAt: '2026-10-17T00:00:00.000Z',
    };
    let current: Comment[] = [];
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([
        makeMember(),
      ]),
      [`GET ${path}`]: ok(card),
      [`GET ${path}/comments?page=1&limit=20`]: () =>
        okPage(current, { limit: 20 }),
      [`POST ${path}/comments`]: () => {
        current = [initial];
        return ok(initial, 201);
      },
      [`PATCH ${path}/comments/${initial.id}`]: () => {
        current = [edited];
        return ok(edited);
      },
      [`DELETE ${path}/comments/${initial.id}`]: () => {
        current = [];
        return { status: 204 };
      },
    });
    renderApp(`/boards/${board.id}`);
    const dialog = await open();
    await within(dialog).findByText('No comments yet');
    const input = within(dialog).getByLabelText('Write a comment');
    const post = within(dialog).getByRole('button', { name: 'Post comment' });
    expect((post as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  Xin chào  ' } });
    fireEvent.click(post);
    fireEvent.click(post);
    await within(dialog).findByText('Xin chào');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      content: 'Xin chào',
    });
    expect(calls.some((c) => c.method === 'PATCH' && c.path === path)).toBe(
      false,
    );

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Edit comment' }),
    );
    fireEvent.change(within(dialog).getByLabelText('Edit comment'), {
      target: { value: ' Changed\n✅ ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save comment' }),
    );
    await within(dialog).findByText(
      (_, node) => node?.tagName === 'P' && node.textContent === 'Changed\n✅',
    );
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      content: 'Changed\n✅',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete comment' }),
    );
    const confirm = within(dialog).getByRole('group', {
      name: 'Delete comment',
    });
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Delete comment' }),
    );
    await within(dialog).findByText('No comments yet');
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
