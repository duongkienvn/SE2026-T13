import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  openCardDetail,
  writes,
  type Handler,
} from '../../../test/card-detail-fixtures';
import { fail, ok, type MockResponse } from '../../../test/mock-api';
import { createdSockets, joined } from '../../../test/fake-socket';
import type { Card } from '../types';
import type { CardChecklists, Checklist, ChecklistItem } from './api';
import {
  previewChecklistAction,
  storeChecklist,
  withChecklists,
} from './hooks';

const stamp = '2026-10-31T00:00:00.000Z';
const item = (
  id: string,
  text: string,
  isChecked = false,
  position = '100.0000000000',
): ChecklistItem => ({
  id,
  checklistId: 'list-1',
  text,
  isChecked,
  position,
  createdAt: stamp,
  updatedAt: stamp,
});
const checklist = (
  id: string,
  title: string,
  items: ChecklistItem[],
): Checklist => {
  const checked = items.filter((row) => row.isChecked).length;
  return {
    id,
    cardId: 'card',
    title,
    position: '100.0000000000',
    createdAt: stamp,
    updatedAt: stamp,
    items: items.map((row) => ({ ...row, checklistId: id })),
    checkedItems: checked,
    totalItems: items.length,
    completionPercentage:
      items.length === 0
        ? 0
        : Math.round((checked * 10000) / items.length) / 100,
  };
};
const detail = (lists: Checklist[]): CardChecklists =>
  withChecklists(
    {
      cardId: 'card',
      checklists: [],
      checkedItems: 0,
      totalItems: 0,
      completionPercentage: 0,
    },
    lists,
  );

describe('checklist cache helpers', () => {
  it('previews a toggle with recomputed progress, empty checklists at 0%', () => {
    const data = detail([
      checklist('list-1', 'Release', [item('a', 'Write'), item('b', 'Ship')]),
      checklist('list-2', 'Empty', []),
    ]);
    const next = previewChecklistAction(data, {
      type: 'toggleItem',
      checklistId: 'list-1',
      itemId: 'b',
      isChecked: true,
    });
    expect(next.checklists[0]).toMatchObject({
      checkedItems: 1,
      totalItems: 2,
      completionPercentage: 50,
    });
    expect(next.checklists[1].completionPercentage).toBe(0);
    expect(next).toMatchObject({ checkedItems: 1, totalItems: 2 });
  });

  it('previews anchor moves and keeps unknown anchors unchanged', () => {
    const data = detail([
      checklist('list-1', 'Release', [
        item('a', 'A'),
        item('b', 'B'),
        item('c', 'C'),
      ]),
    ]);
    const moved = previewChecklistAction(data, {
      type: 'moveItem',
      checklistId: 'list-1',
      itemId: 'c',
      beforeItemId: 'a',
    });
    expect(moved.checklists[0].items.map((row) => row.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    const last = previewChecklistAction(data, {
      type: 'moveItem',
      checklistId: 'list-1',
      itemId: 'a',
      beforeItemId: null,
    });
    expect(last.checklists[0].items.map((row) => row.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    const stale = previewChecklistAction(data, {
      type: 'moveItem',
      checklistId: 'list-1',
      itemId: 'a',
      beforeItemId: 'gone',
    });
    expect(stale.checklists[0].items.map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('stores a server checklist in place or appends a new one', () => {
    const data = detail([checklist('list-1', 'Release', [item('a', 'A')])]);
    const renamed = storeChecklist(
      data,
      checklist('list-1', 'Renamed', [item('a', 'A', true)]),
    );
    expect(renamed.checklists.map((row) => row.title)).toEqual(['Renamed']);
    expect(renamed.checkedItems).toBe(1);
    const added = storeChecklist(data, checklist('list-2', 'New', []));
    expect(added.checklists.map((row) => row.id)).toEqual(['list-1', 'list-2']);
  });
});

function withChecklistsApi(
  lists: Checklist[],
  handlers: (card: Card, base: string) => Record<string, Handler> = () => ({}),
) {
  let current = lists;
  return {
    set: (next: Checklist[]) => {
      current = next;
    },
    extra: (card: Card, path: string) => ({
      [`GET ${path}/checklists`]: () =>
        ok(
          detail(current.map((row) => ({ ...row, cardId: card.id }))),
        ) as MockResponse,
      ...handlers(card, `${path}/checklists`),
    }),
  };
}

describe('Card Detail checklists', () => {
  it('keeps one in-flight checklist read after an early matching hint', async () => {
    const initial = checklist('list-1', 'Release', [item('a', 'Ship')]);
    const updated = checklist('list-1', 'Release', [item('a', 'Ship', true)]);
    let finishWrite!: (value: MockResponse) => void;
    let finishRead!: (value: MockResponse) => void;
    let holdRead = false;
    const api = withChecklistsApi([initial], (card, base) => ({
      [`GET ${base}`]: () =>
        holdRead
          ? new Promise<MockResponse>((resolve) => {
              finishRead = resolve;
            })
          : ok(detail([{ ...initial, cardId: card.id }])),
      [`PATCH ${base}/list-1/items/a`]: () =>
        new Promise<MockResponse>((resolve) => {
          finishWrite = resolve;
        }),
    }));
    const { card, calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const box = await within(view).findByRole('checkbox', { name: 'Ship' });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const socket = createdSockets.at(-1)!.socket;
    act(() => socket.open());
    await waitFor(() => expect(socket.requests('board:join')).toHaveLength(1));
    act(() => socket.lastJoin().reply(joined(card.boardId)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const reads = () =>
      calls.filter(
        (call) => call.method === 'GET' && call.path === `${path}/checklists`,
      ).length;
    const before = reads();
    fireEvent.click(box);
    await waitFor(() => expect(finishWrite).toBeTypeOf('function'));
    act(() =>
      socket.push('card:updated', {
        boardId: card.boardId,
        cardId: card.id,
        columnId: card.columnId,
        changeScope: 'checklists',
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(reads()).toBe(before);
    holdRead = true;
    act(() => finishWrite(ok({ ...updated, cardId: card.id })));
    await waitFor(() => expect(finishRead).toBeTypeOf('function'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(reads()).toBe(before + 1);
    act(() => finishRead(ok(detail([{ ...updated, cardId: card.id }]))));
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(reads()).toBe(before + 1);
  });

  it('shows progress and toggles an item at once, persisting it', async () => {
    const release = checklist('list-1', 'Release', [
      item('a', 'Write notes', true),
      item('b', 'Ship', false, '200.0000000000'),
    ]);
    const api = withChecklistsApi([release], (_card, base) => ({
      [`PATCH ${base}/list-1/items/b`]: () => {
        const next = checklist('list-1', 'Release', [
          item('a', 'Write notes', true),
          item('b', 'Ship', true, '200.0000000000'),
        ]);
        api.set([next]);
        return ok(next);
      },
    }));
    const { calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();

    expect(await within(view).findByText('1 of 2 completed')).toBeTruthy();
    const bar = within(view).getByRole('progressbar', {
      name: 'Release progress',
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    const box = within(view).getByRole('checkbox', { name: 'Ship' });
    fireEvent.click(box);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    await waitFor(() =>
      expect(writes(calls)).toEqual([
        expect.objectContaining({
          method: 'PATCH',
          path: `${path}/checklists/list-1/items/b`,
          body: { isChecked: true },
        }),
      ]),
    );
    expect(await within(view).findByText('2 of 2 completed')).toBeTruthy();
  });

  it('rolls a failed toggle back to the server state and says so', async () => {
    const api = withChecklistsApi(
      [checklist('list-1', 'Release', [item('a', 'Ship')])],
      (_card, base) => ({
        [`PATCH ${base}/list-1/items/a`]: fail(500, 'INTERNAL_ERROR'),
      }),
    );
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const box = await within(view).findByRole('checkbox', { name: 'Ship' });
    fireEvent.click(box);
    expect(
      await within(view).findByText('The change was not saved. Try again.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          within(view).getByRole('checkbox', {
            name: 'Ship',
          }) as HTMLInputElement
        ).checked,
      ).toBe(false),
    );
  });

  it('sends rapid toggles one after another, in order', async () => {
    const answers: ((response: MockResponse) => void)[] = [];
    const api = withChecklistsApi(
      [checklist('list-1', 'Release', [item('a', 'Ship')])],
      (_card, base) => ({
        [`PATCH ${base}/list-1/items/a`]: () =>
          new Promise<MockResponse>((resolve) => answers.push(resolve)),
      }),
    );
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const box = await within(view).findByRole('checkbox', { name: 'Ship' });
    fireEvent.click(box);
    fireEvent.click(box);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toEqual({ isChecked: true });
    answers[0](ok(checklist('list-1', 'Release', [item('a', 'Ship', true)])));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1].body).toEqual({ isChecked: false });
    answers[1](ok(checklist('list-1', 'Release', [item('a', 'Ship')])));
  });

  it('creates a checklist and adds trimmed items, keeping the item field open', async () => {
    const created = checklist('list-9', 'Launch', []);
    const api = withChecklistsApi([], (_card, base) => ({
      [`POST ${base}`]: () => {
        api.set([created]);
        return ok(created, 201);
      },
      [`POST ${base}/list-9/items`]: () => {
        const next = checklist('list-9', 'Launch', [item('x', 'Book room')]);
        api.set([next]);
        return ok(next, 201);
      },
    }));
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    expect(
      await within(view).findByText(
        'No checklists yet. Add one to track steps.',
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(view).getByRole('button', { name: 'Add checklist' }),
    );
    fireEvent.click(
      within(view).getByRole('button', { name: 'Add checklist' }),
    );
    expect(within(view).getByText('Enter a checklist title.')).toBeTruthy();
    fireEvent.change(within(view).getByLabelText('Checklist title'), {
      target: { value: '  Launch  ' },
    });
    fireEvent.click(
      within(view).getByRole('button', { name: 'Add checklist' }),
    );
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Add item to Launch' }),
    );
    fireEvent.change(within(view).getByLabelText('New item in Launch'), {
      target: { value: ' Book room ' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Add' }));
    expect(await within(view).findByText('Book room')).toBeTruthy();
    expect(
      (within(view).getByLabelText('New item in Launch') as HTMLInputElement)
        .value,
    ).toBe('');
    expect(writes(calls).map((call) => call.body)).toEqual([
      { title: 'Launch' },
      { text: 'Book room' },
    ]);
  });

  it('moves with server anchors, never invented positions', async () => {
    const ordered = (...ids: string[]) =>
      checklist(
        'list-1',
        'Release',
        ids.map((id, index) =>
          item(id, id.toUpperCase(), false, `${(index + 1) * 100}.0000000000`),
        ),
      );
    const api = withChecklistsApi([ordered('a', 'b', 'c')], (_card, base) => ({
      [`PATCH ${base}/list-1/items/a/move`]: () => {
        api.set([ordered('b', 'a', 'c')]);
        return ok(ordered('b', 'a', 'c'));
      },
    }));
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const up = await within(view).findByRole('button', { name: 'Move A up' });
    expect((up as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(view).getByRole('button', { name: 'Move A down' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    // "Down one" means "before the item after next" (or the end).
    expect(writes(calls)[0].body).toEqual({ beforeItemId: 'c' });
    const labels = () =>
      within(view)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent);
    await waitFor(() => expect(labels()).toEqual(['B', 'A', 'C']));
  });

  it('confirms before deleting a checklist that has items', async () => {
    const api = withChecklistsApi(
      [checklist('list-1', 'Release', [item('a', 'A'), item('b', 'B')])],
      (_card, base) => ({
        [`DELETE ${base}/list-1`]: () => {
          api.set([]);
          return { status: 204 };
        },
      }),
    );
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Delete Release' }),
    );
    expect(
      within(view).getByText(/Delete “Release” and its 2 items\?/),
    ).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(
      within(view).getByRole('button', { name: 'Delete checklist' }),
    );
    await waitFor(() =>
      expect(writes(calls).map((call) => call.method)).toEqual(['DELETE']),
    );
    expect(
      await within(view).findByText(
        'No checklists yet. Add one to track steps.',
      ),
    ).toBeTruthy();
  });

  it('shows checklists read-only on an archived card', async () => {
    const api = withChecklistsApi([
      checklist('list-1', 'Release', [item('a', 'Ship', true)]),
    ]);
    const { dialog } = openCardDetail({
      card: { isArchived: true },
      extra: api.extra,
    });
    const view = await dialog();
    const box = await within(view).findByRole('checkbox', { name: 'Ship' });
    expect((box as HTMLInputElement).disabled).toBe(true);
    for (const name of [
      'Add checklist',
      'Add item to Release',
      'Edit Ship',
      'Remove Ship',
      'Delete Release',
    ])
      expect(within(view).queryByRole('button', { name })).toBeNull();
  });

  it('explains when checklists cannot be read any more', async () => {
    const { dialog } = openCardDetail({
      extra: (_card, path) => ({
        [`GET ${path}/checklists`]: fail(404, 'CARD_NOT_FOUND'),
      }),
    });
    const view = await dialog();
    expect(
      await within(view).findByText(
        /You no longer have access to this card’s checklists/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add checklist' })).toBeNull();
  });
});
