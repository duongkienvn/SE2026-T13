import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { workspacePage } from '../../../test/workspace-fixtures';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import { invitationProof, readProofFragment } from './proof-store';

const proof = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0_-x';
const link = `/invitations/workspace#proof=${proof}`;

function mount(
  path = link,
  overrides: Parameters<typeof mockApi>[0] = {},
  signedIn = true,
) {
  if (signedIn) storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage([], 1, 0, 100),
    ...overrides,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <RealtimeProvider>
            <RouterProvider
              router={router}
              flushSync={(callback) => {
                flushSync(callback);
              }}
            />
          </RealtimeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { calls, router };
}

beforeEach(() => invitationProof.clear());

describe('Workspace invitation acceptance', () => {
  it('reads only a well-formed proof from the fragment', () => {
    expect(readProofFragment(`#proof=${proof}`)).toBe(proof);
    expect(readProofFragment('#proof=short')).toBeNull();
    expect(readProofFragment(`#proof=${proof.slice(1)}!`)).toBeNull();
    expect(readProofFragment('')).toBeNull();
  });

  it('removes the proof from the URL and never joins just by opening the link', async () => {
    const { calls, router } = mount();
    expect(
      await screen.findByRole('heading', { name: 'Join this workspace?' }),
    ).toBeTruthy();
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    expect(router.state.location.pathname).toBe('/invitations/workspace');
    expect(screen.getByText(testUser.email)).toBeTruthy();
    expect(calls.some((call) => call.path.includes('accept'))).toBe(false);
    expect(JSON.stringify(localStorage)).not.toContain(proof);
    expect(JSON.stringify(sessionStorage)).not.toContain(proof);
  });

  it('accepts with the proof in the request body only', async () => {
    const { calls } = mount(link, {
      'POST /workspace-invitations/accept': ok({
        userId: testUser.id,
        displayName: testUser.displayName,
        avatarUrl: null,
        avatarRevision: 0,
        role: 'MEMBER',
        joinedAt: '2026-10-29T00:00:00.000Z',
      }),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'You joined the workspace' }),
    ).toBeTruthy();
    const accept = calls.find((call) => call.path.includes('accept'))!;
    expect(accept.path).toBe('/workspace-invitations/accept');
    expect(accept.body).toEqual({ proof });
    expect(invitationProof.get(null)).toBeNull();
  });

  it('shows one generic message for invalid, expired or wrong-account proofs', async () => {
    mount(link, {
      'POST /workspace-invitations/accept': fail(
        410,
        'INVALID_WORKSPACE_INVITATION',
      ),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    expect(
      await screen.findByText(/This invitation can’t be used/),
    ).toBeTruthy();
    // Kept in the current flow so the recipient can switch accounts and retry.
    expect(
      screen.getByRole('button', { name: 'Use a different account' }),
    ).toBeTruthy();
  });

  it('explains unconfirmed delivery without joining', async () => {
    mount(link, {
      'POST /workspace-invitations/accept': fail(409, 'CONFLICT'),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    expect(await screen.findByText(/not been confirmed as sent/)).toBeTruthy();
  });

  it('keeps the proof in memory across sign-in for a signed-out recipient', async () => {
    const { router, calls } = mount(
      link,
      {
        'POST /auth/login': ok(loginResponse()),
      },
      false,
    );
    expect(
      await screen.findByRole('heading', {
        name: 'You’re invited to a workspace',
      }),
    ).toBeTruthy();
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const from = router.state.location.state.from as string;
    expect(from).toMatch(/^\/invitations\/workspace\?resume=/);
    expect(JSON.stringify(router.state.location)).not.toContain(proof);
    expect(calls.some((call) => call.path.includes('accept'))).toBe(false);
    const returnId = new URLSearchParams(from.split('?')[1]).get('resume');
    expect(invitationProof.get(returnId)).toBe(proof);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: testUser.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Password123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    expect(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    ).toBeTruthy();
    expect(router.state.location.search).toBe('');
    expect(invitationProof.get(returnId)).toBeNull();
    expect(calls.some((call) => call.path.includes('accept'))).toBe(false);
  });

  it('uses a new link on the mounted page and resets the previous failure', async () => {
    const nextProof = 'B'.repeat(43);
    const { router, calls } = mount(link, {
      'POST /workspace-invitations/accept': fail(
        410,
        'INVALID_WORKSPACE_INVITATION',
      ),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    await screen.findByText(/This invitation can’t be used/);
    await act(() =>
      router.navigate(`/invitations/workspace#proof=${nextProof}`),
    );
    expect(screen.queryByText(/This invitation can’t be used/)).toBeNull();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.path.includes('accept'))).toHaveLength(
        2,
      ),
    );
    expect(
      calls
        .filter((call) => call.path.includes('accept'))
        .map((call) => call.body),
    ).toEqual([{ proof }, { proof: nextProof }]);
    expect(router.state.location.hash).toBe('');
    expect(JSON.stringify(router.state.location.state)).not.toContain(
      nextProof,
    );
  });

  it('ignores an earlier acceptance result after a new link and account switch', async () => {
    let resolve!: (response: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      resolve = done;
    });
    const nextProof = 'B'.repeat(43);
    const { router, calls } = mount(link, {
      'POST /workspace-invitations/accept': () => pending,
      'POST /auth/logout': ok(undefined),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    await screen.findByRole('button', { name: 'Joining…' });
    await act(() =>
      router.navigate(`/invitations/workspace#proof=${nextProof}`),
    );
    expect(
      (
        (await screen.findByRole('button', {
          name: 'Accept invitation',
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'Use a different account' }),
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const from = router.state.location.state.from as string;
    const returnId = new URLSearchParams(from.split('?')[1]).get('resume');
    await act(async () => resolve(ok({ userId: testUser.id })));
    expect(invitationProof.get(returnId)).toBe(nextProof);
    expect(
      screen.queryByRole('heading', { name: 'You joined the workspace' }),
    ).toBeNull();
    expect(calls.filter((call) => call.path.includes('accept'))).toHaveLength(
      1,
    );
  });

  it.each(['/invitations/workspace', '/invitations/workspace#proof=invalid'])(
    'does not reuse an abandoned proof at %s',
    async (path) => {
      const { router, calls } = mount();
      await screen.findByRole('button', { name: 'Accept invitation' });
      await act(() => router.navigate('/'));
      await act(() => router.navigate(path));
      expect(
        await screen.findByRole('heading', {
          name: 'Open your invitation link',
        }),
      ).toBeTruthy();
      expect(calls.some((call) => call.path.includes('accept'))).toBe(false);
    },
  );

  it('does not reuse a pending sign-in proof on an unrelated bare visit', async () => {
    const { router } = mount(link, {}, false);
    fireEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const from = router.state.location.state.from as string;
    await act(() => router.navigate('/invitations/workspace'));
    expect(
      await screen.findByRole('heading', { name: 'Open your invitation link' }),
    ).toBeTruthy();
    await act(() => router.navigate(from));
    expect(
      await screen.findByRole('heading', { name: 'Open your invitation link' }),
    ).toBeTruthy();
  });

  it('keeps acceptance explicit after switching accounts and preserves verification refusal', async () => {
    const { calls } = mount(link, {
      'POST /auth/logout': ok(undefined),
      'POST /workspace-invitations/accept': fail(403, 'FORBIDDEN'),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Accept invitation' }),
    );
    expect(
      await screen.findByText(/Verify your email address first/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use a different account' }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'You’re invited to a workspace',
      }),
    ).toBeTruthy();
    expect(calls.filter((call) => call.path.includes('accept'))).toHaveLength(
      1,
    );
    expect(screen.queryByText(testUser.email)).toBeNull();
  });

  it('asks for the email link when no proof is available', async () => {
    mount('/invitations/workspace');
    expect(
      await screen.findByRole('heading', {
        name: 'Open your invitation link',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Accept invitation' }),
    ).toBeNull();
  });
});
