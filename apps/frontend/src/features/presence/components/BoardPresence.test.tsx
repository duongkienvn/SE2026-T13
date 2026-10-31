import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../../app/AppProviders';
import { okPage } from '../../../test/board-fixtures';
import { createdSockets, joined } from '../../../test/fake-socket';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { useBoardRealtime } from '../../realtime/useBoardRealtime';
import { BoardPresence } from './BoardPresence';

const BOARD = '11111111-1111-4111-8111-111111111111';
const IDS = Array.from(
  { length: 6 },
  (_, index) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
);
async function openPresence(
  ids = [testUser.id],
  membersError?: number,
  beforeJoin?: () => void,
  canReadMembers = true,
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${BOARD}/members?page=1&limit=100`]: membersError
      ? fail(membersError, 'NOT_FOUND')
      : okPage(
          IDS.map((id, index) => ({
            id: `membership-${index}`,
            user: {
              id,
              displayName: `Viewer ${index}`,
              avatarUrl:
                index === 0 ? 'https://images.example/broken.png' : null,
              email: 'private@example.com',
            },
            role: 'MEMBER',
            joinedAt: '2026-10-22T00:00:00Z',
          })),
        ),
  });
  function Page() {
    useBoardRealtime(BOARD);
    return <BoardPresence boardId={BOARD} canReadMembers={canReadMembers} />;
  }
  const result = render(
    <AppProviders>
      <Page />
    </AppProviders>,
  );
  await waitFor(() => expect(createdSockets).toHaveLength(1));
  const { socket } = createdSockets[0];
  beforeJoin?.();
  act(() => socket.open());
  await waitFor(() => expect(socket.requests('board:join')).toHaveLength(1));
  act(() => {
    socket.push('presence:sync', { boardId: BOARD, userIds: ids });
    socket.lastJoin().reply(joined(BOARD));
  });
  return { ...result, socket, calls };
}

describe('BoardPresence', () => {
  it('keeps Workspace-visible viewers anonymous without requesting an unauthorized roster, deduplicates tabs and clears on revocation', async () => {
    const { socket, calls, container } = await openPresence(
      [testUser.id, IDS[0], IDS[0]],
      undefined,
      undefined,
      false,
    );
    const trigger = await screen.findByRole('button', {
      name: '2 people viewing. Show viewers',
    });
    fireEvent.click(trigger);
    expect(await screen.findByText('Unknown viewer')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.queryByText('Viewer 0')).toBeNull();
    expect(container.textContent).not.toContain(IDS[0]);
    expect(container.textContent).not.toContain('@');
    expect(calls.some((call) => call.path.includes('/members'))).toBe(false);
    act(() => socket.push('board:access-revoked', { boardId: BOARD }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Show viewers/ })).toBeNull(),
    );
    expect(screen.queryByText('Unknown viewer')).toBeNull();
  });
  it('uses a compact avatar and overflow count on small screens and dismisses on outside interaction', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await openPresence(IDS);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByText('+5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('list')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('list')).toBeNull();
  });
  it('shows the current viewer using UserAvatar and an accessible count/name', async () => {
    await openPresence([testUser.id], undefined, () => {
      expect(screen.getByText('Connecting viewers…')).toBeTruthy();
      expect(screen.queryByRole('img')).toBeNull();
    });
    expect(
      screen.getByRole('button', { name: '1 person viewing. Show viewers' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'Ada Lovelace is viewing' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('(You)')).toBeTruthy();
    expect(screen.queryByText(testUser.email)).toBeNull();
  });

  it('shows a neutral paused indicator after join retries exhaust, without retaining avatars', async () => {
    const { socket } = await openPresence();
    vi.useFakeTimers();
    try {
      act(() => {
        socket.drop();
        socket.open();
      });
      for (let attempt = 0; attempt < 6; attempt++) {
        act(() => socket.lastJoin().timeOut());
        if (attempt < 5) await act(() => vi.advanceTimersByTimeAsync(30_000));
      }
      expect(screen.getByText('Viewers paused')).toBeTruthy();
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('limits avatars, shows +N and lists all viewers with keyboard dismissal and focus return', async () => {
    await openPresence(IDS);
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Viewer 0 is viewing' }),
      ).toBeTruthy(),
    );
    expect(screen.getByText('+2')).toBeTruthy();
    const button = screen.getByRole('button', {
      name: '6 people viewing. Show viewers',
    });
    button.focus();
    fireEvent.click(button);
    const list = await screen.findByRole('list', {
      name: 'People viewing this board',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it('uses neutral unknown fallbacks and never renders raw UUIDs or emails', async () => {
    const missing = '33333333-3333-4333-8333-333333333333';
    const { container } = await openPresence([missing]);
    expect(
      screen.getByRole('img', { name: 'Unknown viewer is viewing' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Unknown viewer')).toBeTruthy();
    expect(container.textContent).not.toContain(missing);
    expect(container.textContent).not.toContain('@');
  });
  it('uses the existing avatar URL fallback to initials', async () => {
    const { container } = await openPresence([IDS[0]]);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('V0')).toBeTruthy();
  });
  it.each([403, 404])(
    'hides all private viewers if members REST returns %s',
    async (status) => {
      await openPresence([testUser.id], status);
      await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
      expect(screen.queryByText('1 viewing')).toBeNull();
    },
  );
  it('clears avatars during reconnect, distinguishes syncing from zero, and avoids live announcement spam', async () => {
    const { socket, container } = await openPresence();
    act(() => socket.drop());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Viewers reconnecting…')).toBeTruthy();
    act(() => {
      socket.open();
      socket.lastJoin().reply(joined(BOARD));
    });
    expect(screen.getByText('Syncing viewers…')).toBeTruthy();
    act(() => socket.push('presence:sync', { boardId: BOARD, userIds: [] }));
    expect(screen.getByText('0 viewing')).toBeTruthy();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
