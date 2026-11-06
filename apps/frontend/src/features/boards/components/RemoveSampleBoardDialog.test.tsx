import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

function setup(
  customized = false,
  stale = false,
  role: 'OWNER' | 'MEMBER' = 'OWNER',
  marked = true,
) {
  storeSession();
  const board = makeBoard({
    name: 'Welcome to Kanvexa',
    isStarterBoard: marked,
    currentUserRole: role,
  });
  let previews = 0;
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`PATCH /boards/${board.id}`]: ({ body }) => ok(Object.assign(board, body)),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    'GET /boards?page=1&limit=100': okPage([]),
    [`GET /boards/${board.id}/sample-removal`]: () => {
      previews++;
      const changed = customized || previews > 1;
      return ok({
        boardName: board.name,
        isCustomized: changed,
        version: (changed ? 'b' : 'a').repeat(64),
        confirmation: changed
          ? 'DELETE MY CUSTOMIZED BOARD'
          : 'REMOVE SAMPLE BOARD',
      });
    },
    [`DELETE /boards/${board.id}/sample-removal`]: stale
      ? fail(
          409,
          'STARTER_BOARD_CHANGED',
          'The sample board changed. Review a fresh removal confirmation.',
        )
      : { status: 204 },
  });
  return { board, calls, ...renderApp(`/boards/${board.id}`) };
}
async function open(name: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: `Actions for ${name}` }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove Sample Board' }));
  return within(screen.getByRole('dialog', { name: 'Remove Sample Board' }));
}
describe('Sample board removal', () => {
  it('keeps removal available after editing a starter board', async () => {
    const { board, calls } = setup();
    await screen.findByRole('heading', { name: board.name });
    fireEvent.click(screen.getByRole('link', { name: 'Board settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit board' }));
    fireEvent.change(screen.getByLabelText('Board name'), {
      target: { value: 'My edited sample board' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'My edited sample board' });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      name: 'My edited sample board',
    });
    const dialog = await open('My edited sample board');
    expect(await dialog.findByRole('textbox')).toBeTruthy();
  });

  it.each([false, true])(
    'requires the exact reviewed phrase for customized=%s',
    async (customized) => {
      const { board, calls, router } = setup(customized);
      const dialog = await open(board.name);
      const input = await dialog.findByRole('textbox');
      const remove = dialog.getByRole('button', {
        name: 'Remove Sample Board',
      }) as HTMLButtonElement;
      expect(remove.disabled).toBe(true);
      fireEvent.change(input, {
        target: {
          value: customized ? 'REMOVE SAMPLE BOARD' : 'remove sample board',
        },
      });
      expect(remove.disabled).toBe(true);
      if (customized) expect(dialog.getByText(/customized work/)).toBeTruthy();
      const confirmation = customized
        ? 'DELETE MY CUSTOMIZED BOARD'
        : 'REMOVE SAMPLE BOARD';
      fireEvent.change(input, { target: { value: confirmation } });
      fireEvent.click(remove);
      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/boards'),
      );
      const request = calls.find((call) => call.method === 'DELETE');
      expect(request?.body).toEqual({
        version: (customized ? 'b' : 'a').repeat(64),
        confirmation,
      });
    },
  );
  it('requires explicit review after a stale confirmation and clears the old input', async () => {
    const { board, calls } = setup(false, true);
    const dialog = await open(board.name);
    fireEvent.change(await dialog.findByRole('textbox'), {
      target: { value: 'REMOVE SAMPLE BOARD' },
    });
    fireEvent.click(
      dialog.getByRole('button', { name: 'Remove Sample Board' }),
    );
    await dialog.findByText(/sample board changed/);
    expect(
      calls.filter(
        (call) =>
          call.path.endsWith('/sample-removal') && call.method === 'GET',
      ),
    ).toHaveLength(1);
    expect(
      (
        dialog.getByRole('button', {
          name: 'Remove Sample Board',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: 'Review again' }));
    const input = await dialog.findByRole('textbox', {
      name: 'Type DELETE MY CUSTOMIZED BOARD to confirm',
    });
    expect((input as HTMLInputElement).value).toBe('');
  });
  it.each([
    ['MEMBER', true],
    ['OWNER', false],
  ] as const)('hides removal for role %s marked=%s', async (role, marked) => {
    const { board } = setup(false, false, role, marked);
    fireEvent.click(
      await screen.findByRole('button', { name: `Actions for ${board.name}` }),
    );
    expect(
      screen.queryByRole('button', { name: 'Remove Sample Board' }),
    ).toBeNull();
  });
});
