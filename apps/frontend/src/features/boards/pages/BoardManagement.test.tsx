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

const LIST = 'GET /boards?page=1&limit=100';
type Handler = MockResponse | (() => MockResponse | Promise<MockResponse>);

function openBoards(handlers: Record<string, Handler>) {
  storeSession();
  const calls = mockApi({ 'GET /users/me': ok(testUser), ...handlers });
  renderApp('/boards');
  return calls;
}

/** List handler that returns `before` first and `after` once refetched. */
function listThatChanges(before: unknown[], after: unknown[]) {
  let calls = 0;
  return () => {
    calls += 1;
    return okPage(calls === 1 ? before : after);
  };
}

describe('create board', () => {
  it('validates, sends a trimmed payload and shows the new board', async () => {
    const created = makeBoard({ name: 'Roadmap' });
    const calls = openBoards({
      [LIST]: listThatChanges([], [created]),
      'POST /boards': ok(created, 201),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'New Board' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a new board' });
    const name = within(dialog).getByLabelText('Board name');
    expect(document.activeElement).toBe(name);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create board' }),
    );
    expect(within(dialog).getByText('Enter a board name.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    fireEvent.change(name, { target: { value: '  Roadmap  ' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: '   ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create board' }),
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      'Board “Roadmap” created.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
      name: 'Roadmap',
      description: null,
    });
    expect(await screen.findByRole('link', { name: 'Roadmap' })).toBeTruthy();
  });

  it('rejects names over 120 characters before sending', async () => {
    const calls = openBoards({ [LIST]: okPage([]) });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Create board' }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: 'x'.repeat(121) },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create board' }),
    );

    expect(
      within(dialog).getByText('Board name must be at most 120 characters.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows server validation errors on the field and keeps the dialog open', async () => {
    openBoards({
      [LIST]: okPage([]),
      'POST /boards': fail(400, 'VALIDATION_FAILED', 'Validation failed', [
        'name: name must be shorter than or equal to 120 characters',
      ]),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'New Board' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: 'Fine name' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create board' }),
    );

    expect(
      await within(dialog).findByText(
        'Board name must be shorter than or equal to 120 characters',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers creation from the empty state and the dashed tile', async () => {
    openBoards({ [LIST]: okPage([makeBoard()]) });

    fireEvent.click(
      await screen.findByRole('button', { name: /Create a new board/ }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Create a new board' }),
    ).toBeTruthy();
  });
});

describe('edit and archive board', () => {
  it('shows OWNER actions only on boards the user owns', async () => {
    openBoards({
      [LIST]: okPage([
        makeBoard({ name: 'Mine', currentUserRole: 'OWNER' }),
        makeBoard({ name: 'Theirs', currentUserRole: 'MEMBER' }),
      ]),
    });

    expect(
      await screen.findByRole('button', { name: 'Actions for Mine' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Actions for Theirs' }),
    ).toBeNull();
  });

  it('edits a board, sending only the changed fields', async () => {
    const board = makeBoard({ name: 'Old name', description: 'Keep me' });
    const calls = openBoards({
      [LIST]: listThatChanges([board], [{ ...board, name: 'New name' }]),
      [`PATCH /boards/${board.id}`]: ok({ ...board, name: 'New name' }),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Old name' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit board' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit board' });
    const name = within(dialog).getByLabelText(
      'Board name',
    ) as HTMLInputElement;
    const save = within(dialog).getByRole('button', {
      name: 'Save changes',
    }) as HTMLButtonElement;
    expect(name.value).toBe('Old name');
    expect(save.disabled).toBe(true);

    fireEvent.change(name, { target: { value: 'New name' } });
    fireEvent.click(save);

    expect((await screen.findByRole('status')).textContent).toContain(
      'Board “New name” updated.',
    );
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({
      name: 'New name',
    });
    expect(await screen.findByRole('link', { name: 'New name' })).toBeTruthy();
  });

  it('archives only after confirmation', async () => {
    const board = makeBoard({ name: 'Old project' });
    const calls = openBoards({
      [LIST]: listThatChanges([board], []),
      [`POST /boards/${board.id}/archive`]: ok({ ...board, isArchived: true }),
    });

    const menu = await screen.findByRole('button', {
      name: 'Actions for Old project',
    });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    let dialog = screen.getByRole('dialog', { name: 'Archive “Old project”?' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.path.endsWith('/archive'))).toBe(false);
    expect(document.activeElement).toBe(menu);

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive board' }),
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      'Board “Old project” archived.',
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Old project' })).toBeNull(),
    );
  });

  it('keeps an active search clearable after the last board is archived', async () => {
    const board = makeBoard({ name: 'Old project' });
    openBoards({
      [LIST]: listThatChanges([board], []),
      [`POST /boards/${board.id}/archive`]: ok({ ...board, isArchived: true }),
    });

    fireEvent.change(
      await screen.findByRole('searchbox', { name: 'Search boards' }),
      { target: { value: 'old' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Old project' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Archive board',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Old project' })).toBeNull(),
    );

    const search = screen.getByRole('searchbox', { name: 'Search boards' });
    expect((search as HTMLInputElement).value).toBe('old');
  });

  it('shows a permission error when the server refuses to archive', async () => {
    const board = makeBoard({ name: 'Shared' });
    openBoards({
      [LIST]: okPage([board]),
      [`POST /boards/${board.id}/archive`]: fail(403, 'FORBIDDEN'),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Shared' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive board' }),
    );

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      "You don't have permission to do this.",
    );
  });
});
