import { fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { okPage } from '../../../test/board-fixtures';
import {
  openCardDetail,
  writes,
  type Handler,
} from '../../../test/card-detail-fixtures';
import { fail, ok } from '../../../test/mock-api';
import type { Card } from '../../cards/types';
import type { Label } from '../api';
import { labelTextColor } from './LabelBadge';

const stamp = '2026-10-31T00:00:00.000Z';
const label = (id: string, name: string, color = '#615CF7'): Label => ({
  id,
  boardId: 'board',
  name,
  color,
  createdAt: stamp,
  updatedAt: stamp,
});

function labelsApi(
  catalog: Label[],
  assigned: Label[],
  handlers: (card: Card, board: string) => Record<string, Handler> = () => ({}),
) {
  const state = { catalog, assigned };
  return {
    state,
    extra: (card: Card, path: string) => {
      const board = `/boards/${card.boardId}`;
      return {
        [`GET ${board}/labels?page=1&limit=100`]: () => okPage(state.catalog),
        [`GET ${path}/labels`]: () =>
          ok({ cardId: card.id, labels: state.assigned }),
        [`POST ${path}/labels`]: (request: { body: unknown }) => {
          const { labelId } = request.body as { labelId: string };
          const picked = state.catalog.find((row) => row.id === labelId)!;
          state.assigned = [...state.assigned, picked];
          return ok({ cardId: card.id, labels: state.assigned }, 201);
        },
        ...handlers(card, board),
      } as Record<string, Handler>;
    },
  };
}

describe('label colors', () => {
  it('picks the more readable text color for each label', () => {
    expect(labelTextColor('#615CF7')).toBe('#FFFFFF');
    expect(labelTextColor('#CA8A04')).toBe('#172038');
    expect(labelTextColor('#FDE68A')).toBe('#172038');
    expect(labelTextColor('not-a-color')).toBe('#172038');
  });
});

describe('Card Detail labels', () => {
  it('uses Escape to leave label editing before closing the Card Detail', async () => {
    const api = labelsApi([label('l-bug', 'Bug')], []);
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    const opener = await within(view).findByRole('button', {
      name: 'Edit labels',
    });
    fireEvent.click(opener);
    expect(document.activeElement).toBe(
      within(view).getByLabelText('Search labels'),
    );
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit label Bug' }),
    );
    expect(document.activeElement).toBe(
      within(view).getByLabelText('Label name'),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(
      await within(view).findByRole('list', { name: 'Board labels' }),
    ).toBeTruthy();
    const search = within(view).getByLabelText('Search labels');
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() =>
      expect(
        within(view).queryByRole('list', { name: 'Board labels' }),
      ).toBeNull(),
    );
    expect(view.isConnected).toBe(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(view).getByRole('button', { name: 'Edit labels' }),
      ),
    );
  });
  it('focuses the safe choice in label deletion and Escape returns to the picker', async () => {
    const api = labelsApi([label('l-bug', 'Bug')], []);
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit labels' }),
    );
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Delete label Bug' }),
    );
    expect(document.activeElement).toBe(
      within(view).getByRole('button', { name: 'Keep label' }),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(
      within(view).getByLabelText('Search labels'),
    );
    expect(view.isConnected).toBe(true);
  });
  it('shows assigned labels as named badges in the header and rail', async () => {
    const bug = label('l-bug', 'Bug', '#DC2626');
    const api = labelsApi([bug], [bug]);
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    await waitFor(() =>
      expect(within(view).getAllByText('Bug').length).toBeGreaterThanOrEqual(2),
    );
  });

  it('assigns and unassigns on this card only, never touching the catalog', async () => {
    const bug = label('l-bug', 'Bug', '#DC2626');
    const ui = label('l-ui', 'Frontend');
    const api = labelsApi([bug, ui], [bug], (card) => ({
      [`DELETE /boards/${card.boardId}/cards/${card.id}/labels/l-bug`]: () => {
        api.state.assigned = api.state.assigned.filter(
          (row) => row.id !== 'l-bug',
        );
        return { status: 204 };
      },
    }));
    const { calls, path, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit labels' }),
    );
    const picker = await within(view).findByRole('list', {
      name: 'Board labels',
    });
    const bugBox = within(picker).getByRole('checkbox', { name: 'Bug' });
    expect((bugBox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Frontend' }));
    await waitFor(() =>
      expect(writes(calls)).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: `${path}/labels`,
          body: { labelId: 'l-ui' },
        }),
      ]),
    );
    await waitFor(() =>
      expect(
        (
          within(picker).getByRole('checkbox', {
            name: 'Bug',
          }) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Bug' }));
    await waitFor(() =>
      expect(
        writes(calls).map((call) => `${call.method} ${call.path}`),
      ).toEqual([`POST ${path}/labels`, `DELETE ${path}/labels/l-bug`]),
    );
    expect(
      writes(calls).some(
        (call) =>
          call.path.includes('/boards/') &&
          call.path.endsWith('/labels/l-bug') &&
          !call.path.includes('/cards/'),
      ),
    ).toBe(false);
  });

  it('creates a catalog label and puts it on this card', async () => {
    const api = labelsApi([], [], (card, board) => ({
      [`POST ${board}/labels`]: (request) => {
        const created = {
          ...label('l-new', 'Urgent'),
          ...(request.body as object),
          boardId: card.boardId,
        };
        api.state.catalog = [created];
        return ok(created, 201);
      },
    }));
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit labels' }),
    );
    expect(
      await within(view).findByText('This board has no labels yet.'),
    ).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Create label' }));
    fireEvent.change(within(view).getByLabelText('Label name'), {
      target: { value: '  Urgent ' },
    });
    fireEvent.click(within(view).getByRole('radio', { name: 'Red' }));
    fireEvent.click(within(view).getByRole('button', { name: 'Create label' }));
    await waitFor(() =>
      expect(writes(calls).map((call) => call.body)).toEqual([
        { name: 'Urgent', color: '#DC2626' },
        { labelId: 'l-new' },
      ]),
    );
  });

  it('explains a duplicate name and keeps the form', async () => {
    const api = labelsApi([label('l-bug', 'Bug')], [], (_card, board) => ({
      [`POST ${board}/labels`]: fail(409, 'LABEL_NAME_EXISTS'),
    }));
    const { dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit labels' }),
    );
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Create label' }),
    );
    fireEvent.change(within(view).getByLabelText('Label name'), {
      target: { value: 'bug' },
    });
    fireEvent.click(within(view).getByRole('button', { name: 'Create label' }));
    expect(
      await within(view).findByText(
        'A label with this name already exists on this board.',
      ),
    ).toBeTruthy();
    expect(
      (within(view).getByLabelText('Label name') as HTMLInputElement).value,
    ).toBe('bug');
  });

  it('warns that deleting a label removes it from every card', async () => {
    const bug = label('l-bug', 'Bug');
    const api = labelsApi([bug], [bug], (_card, board) => ({
      [`DELETE ${board}/labels/l-bug`]: () => {
        api.state.catalog = [];
        api.state.assigned = [];
        return { status: 204 };
      },
    }));
    const { calls, dialog } = openCardDetail({ extra: api.extra });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Edit labels' }),
    );
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Delete label Bug' }),
    );
    expect(
      within(view).getByText(/removed from every card that uses it/),
    ).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(view).getByRole('button', { name: 'Delete label' }));
    await waitFor(() =>
      expect(writes(calls).map((call) => call.method)).toEqual(['DELETE']),
    );
    expect(await within(view).findByText('No labels.')).toBeTruthy();
  });

  it('lets a read-only viewer see labels but not change them', async () => {
    const bug = label('l-bug', 'Bug');
    const api = labelsApi([bug], [bug]);
    const { dialog } = openCardDetail({
      readOnlyViewer: true,
      extra: api.extra,
    });
    const view = await dialog();
    await waitFor(() =>
      expect(within(view).getAllByText('Bug').length).toBe(2),
    );
    expect(
      within(view).queryByRole('button', { name: 'Edit labels' }),
    ).toBeNull();
    expect(
      within(view).queryByRole('button', { name: 'Manage board labels' }),
    ).toBeNull();
  });

  it('keeps the catalog editable for an archived card on an active board', async () => {
    const bug = label('l-bug', 'Bug');
    const api = labelsApi([bug], [bug]);
    const { dialog } = openCardDetail({
      card: { isArchived: true },
      extra: api.extra,
    });
    const view = await dialog();
    fireEvent.click(
      await within(view).findByRole('button', { name: 'Manage board labels' }),
    );
    const box = await within(view).findByRole('checkbox', { name: 'Bug' });
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(
      within(view).getByRole('button', { name: 'Edit label Bug' }),
    ).toBeTruthy();
  });
});
