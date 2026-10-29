import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
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
    </QueryClientProvider>,
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
    expect(invitationProof.get()).toBeNull();
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
    // Kept so the recipient can switch to the invited account and retry.
    expect(invitationProof.get()).toBe(proof);
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
    const { router, calls } = mount(link, {}, false);
    expect(
      await screen.findByRole('heading', {
        name: 'You’re invited to a workspace',
      }),
    ).toBeTruthy();
    await waitFor(() => expect(router.state.location.hash).toBe(''));
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toEqual({
      from: '/invitations/workspace',
    });
    expect(JSON.stringify(router.state.location)).not.toContain(proof);
    expect(calls.some((call) => call.path.includes('accept'))).toBe(false);
    expect(invitationProof.get()).toBe(proof);
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
