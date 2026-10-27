import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { SESSION_STORAGE_KEY } from '../session';

const uploadId = '00000000-0000-4000-8000-000000000103';
const managed = `/users/${testUser.id}/avatar/${uploadId}`;
const target = {
  uploadId,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  upload: {
    kind: 's3',
    url: 'https://avatar-upload.example.test/',
    fields: { key: 'pending/test', Policy: 'test-only' },
  },
};
const saved = { ...testUser, avatarUrl: managed, avatarRevision: 1 };
const createObjectURL = vi.fn(() => 'blob:local-preview');
const revokeObjectURL = vi.fn();
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }),
  );
});
async function open(
  extra: Parameters<typeof mockApi>[0] = {},
  user = testUser,
) {
  storeSession('avatar-token');
  const calls = mockApi({
    'GET /users/me': ok(user),
    'GET /auth/linked-providers': ok({
      googleLinked: false,
      hasPassword: true,
    }),
    'POST /users/me/avatar/uploads': ok(target, 201),
    'POST https://avatar-upload.example.test/': { status: 204 },
    [`POST /users/me/avatar/uploads/${uploadId}/complete`]: ok(saved),
    ...extra,
  });
  const apiFetch = fetch;
  const transfers: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === target.upload.url) transfers.push(init ?? {});
      if (/\/users\/[\da-f-]{36}\/avatar\/[\da-f-]{36}$/.test(input))
        return new Response(new Blob(['webp']), {
          headers: { 'Content-Type': 'image/webp' },
        });
      return apiFetch(input, init);
    }),
  );
  const view = renderApp('/settings/profile');
  await screen.findByLabelText('Photo file');
  return { ...view, calls, transfers };
}
const select = (
  file = new File(['png bytes'], 'portrait.png', { type: 'image/png' }),
) => {
  fireEvent.change(screen.getByLabelText('Photo file'), {
    target: { files: [file] },
  });
};
const photo = () => screen.getByRole('region', { name: 'Profile photo' });

describe('profile photo workflow', () => {
  it.each(['upload', 'verify', 'remove'] as const)(
    'guards navigation and tab close during photo %s until it settles',
    async (phase) => {
      const pending = deferred<MockResponse>();
      const endpoint =
        phase === 'upload'
          ? target.upload.url
          : phase === 'verify'
            ? `/users/me/avatar/uploads/${uploadId}/complete`
            : '/users/me/avatar';
      const { router } = await open(
        {
          [`${phase === 'remove' ? 'DELETE' : 'POST'} ${endpoint}`]: () =>
            pending.promise,
        },
        phase === 'remove'
          ? { ...testUser, avatarUrl: 'https://images.example.test/old.jpg' }
          : testUser,
      );
      if (phase !== 'remove') select();
      fireEvent.click(
        screen.getByRole('button', {
          name: phase === 'remove' ? 'Remove photo' : 'Upload photo',
        }),
      );
      await waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.some(([input]) => String(input).endsWith(endpoint)),
        ).toBe(true),
      );
      const signal = vi
        .mocked(fetch)
        .mock.calls.find(([input]) => String(input).endsWith(endpoint))![1]!
        .signal!;
      const closing = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(closing);
      expect(closing.defaultPrevented).toBe(true);
      await act(() => router.navigate('/settings/appearance'));
      await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
      expect(router.state.location.pathname).toBe('/settings/profile');
      expect(signal.aborted).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(signal.aborted).toBe(false);
      await act(async () =>
        pending.resolve(
          phase === 'upload'
            ? { status: 204 }
            : ok(
                phase === 'remove' ? { ...testUser, avatarRevision: 1 } : saved,
              ),
        ),
      );
      await screen.findByText(
        phase === 'remove' ? 'Photo removed.' : 'Photo saved.',
      );
      const settled = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(settled);
      expect(settled.defaultPrevented).toBe(false);
      await act(() => router.navigate('/settings/appearance'));
      await screen.findByRole('heading', { name: 'Appearance' });
    },
  );

  it('previews and cancels without starting an upload; releases object URLs', async () => {
    const { calls } = await open();
    select();
    await waitFor(() =>
      expect(photo().querySelector('img')?.getAttribute('src')).toBe(
        'blob:local-preview',
      ),
    );
    expect(screen.getByText(/Preview only until uploaded/)).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel photo' }));
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview'),
    );
    expect(within(photo()).getByText('AL')).toBeTruthy();
  });

  it.each([
    [
      new File(['<svg/>'], 'picture.svg', { type: 'image/svg+xml' }),
      /Choose a JPEG, PNG or WebP/,
    ],
    [
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', {
        type: 'image/png',
      }),
      /no larger than 5 MiB/,
    ],
    [new File([], 'empty.png', { type: 'image/png' }), /no larger than 5 MiB/],
  ])(
    'rejects invalid selection before requesting an intent (%s)',
    async (file, message) => {
      const { calls } = await open();
      select(file);
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Upload photo' })).toBeNull();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    },
  );

  it('waits for backend confirmation, disables controls and transfers only signed fields to S3', async () => {
    const confirmation = deferred<MockResponse>();
    const { calls, transfers } = await open({
      [`POST /users/me/avatar/uploads/${uploadId}/complete`]: () =>
        confirmation.promise,
    });
    select();
    fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    await screen.findByRole('button', { name: 'Verifying photo…' });
    expect(
      (
        screen.getByRole('button', {
          name: 'Change photo',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Cancel photo',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText('Photo saved.')).toBeNull();
    expect(
      calls.find((c) => c.path === '/users/me/avatar/uploads')?.body,
    ).toEqual({ contentType: 'image/png', fileSize: 9, expectedRevision: 0 });
    expect(transfers[0].headers).toBeUndefined();
    expect(transfers[0].credentials).toBe('omit');
    expect([...(transfers[0].body as FormData).keys()]).toEqual([
      'key',
      'Policy',
      'file',
    ]);
    await act(async () => confirmation.resolve(ok(saved)));
    await screen.findByText('Photo saved.');
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('keeps the selection and previous avatar on verification failure and can retry', async () => {
    let attempts = 0;
    await open(
      {
        [`POST /users/me/avatar/uploads/${uploadId}/complete`]: () =>
          ++attempts === 1
            ? fail(
                415,
                'AVATAR_INVALID_IMAGE',
                'This photo could not be decoded safely.',
              )
            : ok(saved),
      },
      { ...testUser, avatarUrl: 'https://images.example.test/old.jpg' },
    );
    select();
    fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    await screen.findByText('This photo could not be decoded safely.');
    expect(screen.queryByText('Photo saved.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    await screen.findByText('Photo saved.');
    expect(attempts).toBe(2);
  });

  it('clears a legacy photo using its revision and falls back to initials', async () => {
    const { calls } = await open(
      { 'DELETE /users/me/avatar': ok({ ...testUser, avatarRevision: 8 }) },
      {
        ...testUser,
        avatarUrl: 'https://images.example.test/legacy.jpg',
        avatarRevision: 7,
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await screen.findByText('Photo removed.');
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({
      expectedRevision: 7,
    });
    expect(within(photo()).getByText('AL')).toBeTruthy();
  });

  it.each(['name-first', 'photo-first'])(
    'merges independent profile fields (%s)',
    async (order) => {
      const name = deferred<MockResponse>(),
        avatar = deferred<MockResponse>();
      await open({
        'PATCH /users/me': () => name.promise,
        [`POST /users/me/avatar/uploads/${uploadId}/complete`]: () =>
          avatar.promise,
      });
      select();
      fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
      fireEvent.change(screen.getByLabelText('Display name'), {
        target: { value: 'New Name' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      const finishName = async () => {
        await act(async () =>
          name.resolve(ok({ ...testUser, displayName: 'New Name' })),
        );
        await screen.findByText('Profile updated.');
      };
      const finishAvatar = async () => {
        await act(async () => avatar.resolve(ok(saved)));
        await screen.findByText('Photo saved.');
      };
      if (order === 'name-first') {
        await finishName();
        await finishAvatar();
      } else {
        await finishAvatar();
        await finishName();
      }
      expect(
        screen.getByRole('button', { name: 'Account menu for New Name' }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
      expect(
        (screen.getByLabelText('Display name') as HTMLInputElement).value,
      ).toBe('New Name');
    },
  );

  it('aborts transfer and ignores A completion when a storage event switches to B', async () => {
    const pending = deferred<MockResponse>();
    const b = {
      ...testUser,
      id: '00000000-0000-4000-8000-000000000002',
      displayName: 'Grace Hopper',
      email: 'grace@example.test',
    };
    const { transfers } = await open({
      'GET /users/me': (request) =>
        ok(request.headers.Authorization === 'Bearer b' ? b : testUser),
      'POST https://avatar-upload.example.test/': () => pending.promise,
    });
    select();
    fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    await waitFor(() => expect(transfers).toHaveLength(1));
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
    await screen.findByRole('button', {
      name: 'Account menu for Grace Hopper',
    });
    expect(transfers[0].signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ status: 204 }));
    expect(screen.queryByText('Photo saved.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    expect(within(photo()).getByText('GH')).toBeTruthy();
  });
});
