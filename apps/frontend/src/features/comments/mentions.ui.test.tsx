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
import type { BoardMember } from '../board-members/types';
import type { Comment } from './types';

const LINH = '10000000-0000-4000-8000-000000000001';
const LINH_2 = '10000000-0000-4000-8000-000000000002';
const DANG = '10000000-0000-4000-8000-000000000003';
const member = (id: string, displayName: string, email: string) =>
  makeMember({
    id: `membership-${id}`,
    role: 'MEMBER',
    user: { id, displayName, email, avatarUrl: null },
  });
const roster = [
  makeMember(),
  member(LINH, 'Linh', 'linh@example.com'),
  member(LINH_2, 'Linh', 'linh.tran@example.com'),
  member(DANG, 'Đặng Thị Linh', 'dang@example.com'),
];

type Handler = MockResponse | (() => MockResponse | Promise<MockResponse>);

function setup({
  comments = [],
  members = roster,
  role = 'OWNER',
  extra = () => ({}),
}: {
  comments?: Comment[];
  members?: BoardMember[] | (() => BoardMember[]);
  role?: 'OWNER' | 'MEMBER' | null;
  extra?: (path: string, cardId: string) => Record<string, Handler>;
} = {}) {
  storeSession();
  const board = makeBoard({ currentUserRole: role as 'OWNER' });
  const column = makeColumn({ boardId: board.id });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Discussion',
  });
  const path = `/boards/${board.id}/cards/${card.id}/comments`;
  const list = comments.map((item) => ({ ...item, cardId: card.id }));
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: () =>
      okPage(typeof members === 'function' ? members() : members),
    [`GET /boards/${board.id}/cards/${card.id}`]: ok(card),
    [`GET ${path}?page=1&limit=20`]: () => okPage(list),
    [`POST ${path}`]: (request) => {
      const body = request.body as { content: string; mentions: unknown[] };
      const created = {
        id: '20000000-0000-4000-8000-000000000099',
        cardId: card.id,
        authorId: testUser.id,
        ...body,
        createdAt: '2026-11-04T10:00:00.000Z',
        updatedAt: '2026-11-04T10:00:00.000Z',
      } as Comment;
      list.push(created);
      return ok(created, 201);
    },
    ...extra(path, card.id),
  });
  renderApp(`/boards/${board.id}`);
  return { calls, path };
}

async function openComposer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Discussion' }));
  const dialog = await screen.findByRole('dialog', { name: 'Discussion' });
  const box = (await within(dialog).findByLabelText(
    'Write a comment',
  )) as HTMLTextAreaElement;
  return { dialog, box };
}

/** Type as a browser would: new value, caret where the edit ended, then input. */
function edit(box: HTMLTextAreaElement, value: string, caret = value.length) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(box, value);
    box.setSelectionRange(caret, caret);
    fireEvent.input(box);
  });
}

const posted = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.find(
    (call) => call.method === 'POST' && call.path.endsWith('/comments'),
  )?.body;

describe('comment @mentions', () => {
  it('suggests Board members, selects with the keyboard and posts exact UTF-16 spans', async () => {
    const { calls } = setup();
    const { dialog, box } = await openComposer();
    edit(box, '  😀 @li');
    const list = await within(dialog).findByRole('listbox', {
      name: 'Mention a board member',
    });
    const options = within(list).getAllByRole('option');
    // Two members share "Linh": their emails tell them apart.
    expect(
      options.map(
        (option) =>
          option.querySelector('.mention-option-name')?.textContent +
          (option.querySelector('.mention-option-detail')?.textContent ?? ''),
      ),
    ).toEqual([
      'Linhlinh@example.com',
      'Linhlinh.tran@example.com',
      'Đặng Thị Linh',
    ]);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('  😀 @Linh ');
    expect(box.selectionStart).toBe(box.value.length);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls)).toEqual({
      content: '😀 @Linh',
      mentions: [{ userId: LINH, start: 3, end: 8 }],
    });
    const mention = await within(dialog).findByText('@Linh', {
      selector: '.comment-mention',
    });
    expect(mention.closest('p')?.textContent).toBe('😀 @Linh');
  });

  it('treats a typed @Name without selecting it as plain text', async () => {
    const { calls } = setup();
    const { dialog, box } = await openComposer();
    edit(box, 'ping @Linh');
    edit(box, 'ping @Linh now');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls)).toEqual({ content: 'ping @Linh now', mentions: [] });
  });

  it('never opens inside an email address', async () => {
    setup();
    const { dialog, box } = await openComposer();
    edit(box, 'mail ada@li');
    expect(within(dialog).queryByRole('listbox')).toBeNull();
  });

  it('closes only the suggestions on Escape, not the Card dialog', async () => {
    setup();
    const { dialog, box } = await openComposer();
    edit(box, '@d');
    await within(dialog).findByRole('listbox');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Discussion' })).toBe(dialog);
    expect(box.value).toBe('@d');
  });

  it('selects with a pointer without losing the caret, handling diacritics', async () => {
    const { calls } = setup();
    const { dialog, box } = await openComposer();
    edit(box, 'cc @dang');
    const option = await within(dialog).findByRole('option', {
      name: /Đặng Thị Linh/,
    });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(box.value).toBe('cc @Đặng Thị Linh ');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls)).toEqual({
      content: 'cc @Đặng Thị Linh',
      mentions: [{ userId: DANG, start: 3, end: 17 }],
    });
  });

  it('unlinks a mention edited in the middle but keeps its text', async () => {
    const { calls } = setup();
    const { dialog, box } = await openComposer();
    edit(box, '@d');
    fireEvent.keyDown(await within(dialog).findByRole('combobox'), {
      key: 'Enter',
    });
    expect(box.value).toBe('@Đặng Thị Linh ');
    // Delete the "T": the caret sits where the edit happened.
    edit(box, '@Đặng hị Linh ', 6);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls)).toEqual({
      content: '@Đặng hị Linh',
      mentions: [],
    });
  });

  it('blocks posting a mention of a member who left, and can unlink it', async () => {
    let current = roster;
    const { calls } = setup({ members: () => current });
    const { dialog, box } = await openComposer();
    edit(box, '@d');
    fireEvent.keyDown(await within(dialog).findByRole('combobox'), {
      key: 'Enter',
    });
    current = roster.filter((item) => item.user.id !== DANG);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    const warning = await within(dialog).findByText(/no longer a board member/);
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Post comment',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      within(warning.closest('[role="alert"]') as HTMLElement).getByRole(
        'button',
        { name: 'Remove mention' },
      ),
    );
    expect(box.value).toBe('@Đặng Thị Linh ');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls)).toEqual({
      content: '@Đặng Thị Linh',
      mentions: [],
    });
    act(() => focusManager.setFocused(undefined));
  });

  it('refuses an eleventh person with a visible message', async () => {
    const many = [
      makeMember(),
      ...Array.from({ length: 11 }, (_, index) =>
        member(
          `10000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
          `Member ${String.fromCharCode(65 + index)}`,
          `m${index}@example.com`,
        ),
      ),
    ];
    setup({ members: many });
    const { dialog, box } = await openComposer();
    for (let index = 0; index < 11; index++) {
      edit(box, `${box.value}@Member ${String.fromCharCode(65 + index)}`);
      fireEvent.keyDown(await within(dialog).findByRole('combobox'), {
        key: 'Enter',
      });
    }
    expect(await within(dialog).findByText(/at most 10 people/)).toBeTruthy();
    expect(box.value.match(/@Member/g)).toHaveLength(11);
    expect(box.value).not.toContain('@Member K ');
  });

  it('shows no suggestions to a reader without Board member access', async () => {
    setup({ role: null, members: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Discussion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discussion' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
  });
});

describe('editing and rendering mentions', () => {
  const base: Comment = {
    id: '20000000-0000-4000-8000-000000000002',
    cardId: 'x',
    authorId: testUser.id,
    content: '😀 @Linh hello',
    mentions: [{ userId: LINH, start: 3, end: 8 }],
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
  };

  it('keeps an unchanged edit a no-op and sends [] after removing the mention', async () => {
    const { calls } = setup({
      comments: [base],
      extra: (path) => ({
        [`PATCH ${path}/${base.id}`]: (request?: unknown) =>
          ok({ ...base, ...(request as { body: object })?.body }),
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discussion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discussion' });
    expect(
      await within(dialog).findByText('@Linh', {
        selector: '.comment-mention',
      }),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Edit comment' }),
    );
    const box = within(dialog).getByLabelText(
      'Edit comment',
    ) as HTMLTextAreaElement;
    const save = within(dialog).getByRole('button', { name: 'Save comment' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    // Delete the last letter of "@Linh": the mention becomes plain text.
    edit(box, '😀 @Lin hello', 7);
    fireEvent.click(save);
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')).toBeTruthy(),
    );
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      content: '😀 @Lin hello',
      mentions: [],
    });
  });

  it('renders malformed or HTML-looking content as plain text', async () => {
    setup({
      comments: [
        {
          ...base,
          content: '<b>@Linh</b>',
          mentions: [{ userId: LINH, start: 2, end: 7 }],
        },
        {
          ...base,
          id: '20000000-0000-4000-8000-000000000003',
          content: 'old comment with @Linh',
          mentions: undefined,
        },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discussion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discussion' });
    expect(await within(dialog).findByText('<b>@Linh</b>')).toBeTruthy();
    expect(within(dialog).getByText('old comment with @Linh')).toBeTruthy();
    expect(dialog.querySelector('.comment-mention')).toBeNull();
    expect(dialog.querySelector('b')).toBeNull();
  });

  it('keeps the draft when the server rejects mentions', async () => {
    setup({
      extra: (path) => ({
        [`POST ${path}`]: fail(400, 'VALIDATION_FAILED', 'Invalid mention'),
      }),
    });
    const { dialog, box } = await openComposer();
    edit(box, '@d');
    fireEvent.keyDown(await within(dialog).findByRole('combobox'), {
      key: 'Enter',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Post comment' }),
    );
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(box.value).toBe('@Đặng Thị Linh ');
  });
});
