import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../../../test/mock-api';
import { AuthProvider } from '../AuthProvider';
import { SESSION_STORAGE_KEY } from '../session';
import { UserAvatar } from './UserAvatar';
import { revokeBoardAccess } from '../../boards/revoke-board-access';

const path =
  '/users/00000000-0000-4000-8000-000000000002/avatar/00000000-0000-4000-8000-000000000103';
const peer = {
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'Board Peer',
  avatarUrl: path,
};
const createObjectURL = vi.fn(() => 'blob:private-avatar');
const revokeObjectURL = vi.fn();
beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }),
  );
});
function binary(status = 200) {
  return new Response(status === 200 ? new Blob(['image']) : null, {
    status,
    headers: { 'Content-Type': 'image/webp' },
  });
}
function mount(
  read: (init: RequestInit) => Promise<Response>,
  user = testUser,
  shown = peer,
) {
  storeSession('a');
  mockApi({
    'GET /users/me': (r) =>
      ok(
        r.headers.Authorization === 'Bearer b'
          ? { ...testUser, id: 'b', displayName: 'Other Account' }
          : user,
      ),
  });
  const apiFetch = fetch,
    reads: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}) => {
      if (/\/avatar\//.test(input)) {
        reads.push(init);
        return read(init);
      }
      return apiFetch(input, init);
    }),
  );
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <UserAvatar user={shown} />
        <UserAvatar user={shown} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, reads, client };
}
describe('authenticated shared avatar renderer', () => {
  it('deduplicates private binary reads and revokes every local object URL on unmount', async () => {
    const view = mount(async () => binary());
    await waitFor(() =>
      expect(view.container.querySelectorAll('img')).toHaveLength(2),
    );
    expect(view.reads).toHaveLength(1);
    expect(view.reads[0].headers).toEqual({
      Authorization: 'Bearer a',
      Accept: 'image/webp',
    });
    expect(view.reads[0].cache).toBe('no-store');
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      'blob:private-avatar',
    );
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('uses current-user avatar fields when Board DTOs still contain an old external URL', async () => {
    const ownPath = `/users/${testUser.id}/avatar/00000000-0000-4000-8000-000000000103`;
    const view = mount(
      async () => binary(),
      { ...testUser, avatarUrl: ownPath },
      { ...testUser, avatarUrl: 'https://images.example/old.jpg' },
    );
    await waitFor(() => expect(view.reads).toHaveLength(1));
    await waitFor(() =>
      expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
        'blob:private-avatar',
      ),
    );
  });

  it('drops cached bytes on Board access loss and uses initials after a single denied read', async () => {
    let allowed = true;
    const view = mount(async () => binary(allowed ? 200 : 404));
    await waitFor(() =>
      expect(view.container.querySelectorAll('img')).toHaveLength(2),
    );
    allowed = false;
    act(() => revokeBoardAccess(view.client, 'revoked-board'));
    await waitFor(() => expect(view.container.querySelector('img')).toBeNull());
    await waitFor(() => expect(view.reads).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.reads).toHaveLength(2);
    expect(view.container.textContent).toBe('BPBP');
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('aborts A reads and never materializes their bytes after an account switch', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const view = mount(async (init) =>
      (init.headers as Record<string, string>).Authorization === 'Bearer a'
        ? pending
        : binary(404),
    );
    await waitFor(() => expect(view.reads).toHaveLength(1));
    act(() => {
      storeSession('b');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: SESSION_STORAGE_KEY,
          newValue: localStorage.getItem(SESSION_STORAGE_KEY),
          storageArea: localStorage,
        }),
      );
    });
    await waitFor(() => expect(view.reads).toHaveLength(2));
    expect(view.reads[0].signal?.aborted).toBe(true);
    await act(async () => resolve(binary()));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(view.container.querySelector('img')).toBeNull();
  });
});
