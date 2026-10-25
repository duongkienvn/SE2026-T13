import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../../app/AppProviders';
import { makeActivity, makeMember, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { ActivityHistoryDialog } from './ActivityHistoryDialog';

const BOARD = 'board-1';
const MEMBERS = `GET /boards/${BOARD}/members?page=1&limit=100`;
const page = (n: number) => `GET /boards/${BOARD}/activities?page=${n}&limit=8`;
const COLUMN = '00000000-0000-4000-9000-0000000000cc';

const grace = makeMember({
  id: 'membership-grace',
  role: 'MEMBER',
  user: {
    id: 'user-grace',
    email: 'grace@example.com',
    displayName: 'Grace <b>Hopper</b>',
    avatarUrl: null,
  },
});

function renderDialog(
  handlers: Record<string, MockResponse | (() => MockResponse)>,
  { open = true } = {},
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [MEMBERS]: okPage([makeMember(), grace]),
    ...handlers,
  });
  const onClose = vi.fn();
  render(
    <AppProviders>
      <ActivityHistoryDialog boardId={BOARD} open={open} onClose={onClose} />
    </AppProviders>,
  );
  return { calls, onClose };
}

const activityCalls = (calls: MockRequest[]) =>
  calls.filter((call) => call.path.includes('/activities'));

function rows() {
  return within(screen.getByRole('list', { name: 'Activity' })).getAllByRole(
    'listitem',
  );
}

describe('ActivityHistoryDialog', () => {
  it('shows board archive and restore actions in history', async () => {
    renderDialog({
      [page(1)]: okPage(
        [
          makeActivity({ actionType: 'BOARD_RESTORED', entityType: 'BOARD' }),
          makeActivity({ actionType: 'BOARD_ARCHIVED', entityType: 'BOARD' }),
        ],
        { limit: 8 },
      ),
    });

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0].textContent).toContain('You restored the board');
    expect(rows()[1].textContent).toContain('You archived the board');
  });

  it('renders the server order with actors, labels, details and times', async () => {
    renderDialog({
      [page(1)]: okPage(
        [
          makeActivity({
            actorId: 'user-grace',
            actionType: 'CARD_MOVED',
            entityType: 'CARD',
            metadata: { fromColumnId: COLUMN, toColumnId: COLUMN },
            createdAt: '2026-10-22T08:30:00.000Z',
          }),
          makeActivity({
            actionType: 'ROLE_CHANGED',
            entityType: 'MEMBER',
            metadata: { fromRole: 'MEMBER', toRole: 'OWNER' },
          }),
          makeActivity({
            actorId: 'user-gone',
            actionType: 'COLUMN_DELETED',
            entityType: 'COLUMN',
            createdAt: 'not-a-date',
          }),
        ],
        { limit: 8 },
      ),
    });

    await waitFor(() => expect(rows()).toHaveLength(3));
    const [moved, role, deleted] = rows();
    expect(moved.textContent).toContain('Grace <b>Hopper</b> reordered a card');
    expect(role.textContent).toContain("You changed a member's role");
    expect(role.textContent).toContain('Member → Owner');
    expect(deleted.textContent).toContain('Former member deleted a column');
    expect(deleted.textContent).toContain('Unknown time');
    expect(within(deleted).queryByRole('time')).toBeNull();

    const time = moved.querySelector('time')!;
    expect(time.getAttribute('dateTime')).toBe('2026-10-22T08:30:00.000Z');
    expect(time.getAttribute('title')).toMatch(/Oct 22, 2026/);

    const dialog = screen.getByRole('dialog', { name: 'Activity' });
    expect(dialog.querySelector('b')).toBeNull();
    expect(dialog.textContent).not.toContain(COLUMN);
    expect(dialog.textContent).not.toContain('user-gone');
    expect(dialog.textContent).not.toContain('@example.com');
    expect(screen.getByText('3 activities')).toBeTruthy();
  });

  it('waits for the member list instead of flashing "Former member"', async () => {
    let releaseMembers!: () => void;
    renderDialog({
      [MEMBERS]: () =>
        new Promise<MockResponse>((resolve) => {
          releaseMembers = () => resolve(okPage([grace]));
        }) as unknown as MockResponse,
      [page(1)]: okPage([makeActivity({ actorId: 'user-grace' })], {
        limit: 8,
      }),
    });

    await waitFor(() => expect(releaseMembers).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Loading activity…')).toBeTruthy();
    expect(screen.queryByText(/Former member/)).toBeNull();

    releaseMembers();
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('Grace <b>Hopper</b>'),
    );
  });

  it('hides cached history when the session is rejected', async () => {
    let rejected = false;
    renderDialog({
      [page(1)]: () =>
        rejected
          ? fail(401, 'UNAUTHORIZED')
          : okPage([makeActivity({ actionType: 'CARD_CREATED' })], {
              limit: 8,
            }),
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    rejected = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    // The session ends and the cache is cleared; in the app the route guard
    // then redirects to sign-in.
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Activity' })).toBeNull(),
    );
    expect(screen.queryByText(/created a card/)).toBeNull();
  });

  it('does not request anything while closed', async () => {
    const { calls } = renderDialog({ [page(1)]: okPage([]) }, { open: false });
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/users/me')).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(activityCalls(calls)).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an empty state', async () => {
    renderDialog({ [page(1)]: okPage([], { limit: 8 }) });
    expect(await screen.findByText('No activity yet')).toBeTruthy();
  });

  it('pages through the history', async () => {
    const first = makeActivity({ actionType: 'CARD_CREATED' });
    const second = makeActivity({ actionType: 'COMMENT_DELETED' });
    const { calls } = renderDialog({
      [page(1)]: okPage([first], { limit: 8, total: 9 }),
      [page(2)]: okPage([second], { page: 2, limit: 8, total: 9 }),
    });

    await waitFor(() =>
      expect(rows()[0].textContent).toContain('created a card'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('deleted a comment'),
    );
    expect(rows()).toHaveLength(1);
    expect(
      screen
        .getByRole('button', { name: 'Page 2' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(activityCalls(calls).map((call) => call.path)).toEqual([
      `/boards/${BOARD}/activities?page=1&limit=8`,
      `/boards/${BOARD}/activities?page=2&limit=8`,
    ]);
  });

  it('refreshes on demand', async () => {
    let served = 0;
    renderDialog({
      [page(1)]: () => {
        served += 1;
        return okPage(
          served === 1 ? [] : [makeActivity({ actionType: 'CARD_ARCHIVED' })],
          { limit: 8 },
        );
      },
    });

    await screen.findByText('No activity yet');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('archived a card'),
    );
    expect(served).toBe(2);
  });

  it('moves back to the last page when the history shrinks', async () => {
    let shrunk = false;
    renderDialog({
      [page(1)]: () =>
        okPage([makeActivity({ actionType: 'CARD_CREATED' })], {
          limit: 8,
          total: shrunk ? 1 : 9,
        }),
      [page(2)]: () =>
        shrunk
          ? okPage([], { page: 2, limit: 8, total: 1 })
          : okPage([makeActivity({ actionType: 'COLUMN_MOVED' })], {
              page: 2,
              limit: 8,
              total: 9,
            }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('reordered a column'),
    );
    shrunk = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('created a card'),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('navigation', { name: 'Activity pages' }),
      ).toBeNull(),
    );
    expect(screen.getByText('1 activity')).toBeTruthy();
  });

  it('hides cached history once access is lost', async () => {
    let lost = false;
    renderDialog({
      [page(1)]: () =>
        lost
          ? fail(404, 'NOT_FOUND')
          : okPage([makeActivity({ actionType: 'CARD_CREATED' })], {
              limit: 8,
            }),
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    lost = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText('Activity unavailable')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Activity' })).toBeNull();
    expect(screen.queryByText(/created a card/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  it('keeps the history on a failed background refresh', async () => {
    let failing = false;
    renderDialog({
      [page(1)]: () =>
        failing
          ? fail(503, 'UNAVAILABLE')
          : okPage([makeActivity({ actionType: 'CARD_CREATED' })], {
              limit: 8,
            }),
    });

    await waitFor(() => expect(rows()).toHaveLength(1));
    failing = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(
      await screen.findByText(
        'Activity could not be refreshed.',
        {},
        {
          timeout: 5000,
        },
      ),
    ).toBeTruthy();
    expect(rows()[0].textContent).toContain('created a card');
  });

  it('recovers from a failed first load', async () => {
    let failing = true;
    renderDialog({
      [page(1)]: () =>
        failing
          ? fail(400, 'BAD_REQUEST')
          : okPage([makeActivity({ actionType: 'CARD_UPDATED' })], {
              limit: 8,
            }),
    });

    expect(await screen.findByText('We couldn’t load activity')).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(rows()[0].textContent).toContain('updated a card'),
    );
  });

  it('closes on Escape', async () => {
    const { onClose } = renderDialog({ [page(1)]: okPage([]) });
    await screen.findByText('No activity yet');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
