import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installGoogle } from '../../../test/fake-google';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

type Handler = MockResponse | ((request: MockRequest) => MockResponse);

function signedIn(
  providers: { hasPassword: boolean; googleLinked: boolean },
  overrides: Record<string, Handler> = {},
) {
  storeSession();
  return mockApi({
    'GET /users/me': ok(testUser),
    'GET /auth/linked-providers': ok(providers),
    'GET /auth/email-change/pending': ok(null),
    'POST /auth/logout': { status: 204 },
    ...overrides,
  });
}

const accepted: MockResponse = {
  status: 202,
  body: {
    success: true,
    statusCode: 202,
    message:
      'If this email change is eligible, a confirmation link may arrive.',
    data: null,
  },
};

async function emailCard() {
  return within(await screen.findByRole('region', { name: 'Change email' }));
}

async function fillPassword(
  card: ReturnType<typeof within>,
  { email = 'new@example.com', password = 'Current1!' } = {},
) {
  fireEvent.change(await card.findByLabelText('Current password'), {
    target: { value: password },
  });
  fireEvent.change(card.getByLabelText('New email'), {
    target: { value: email },
  });
  fireEvent.click(card.getByRole('button', { name: 'Send verification link' }));
}

const requests = (calls: MockRequest[]) =>
  calls.filter((call) => call.path === '/auth/email-change/request');

describe('Security → Change email', () => {
  it('matches the approved layout: plain heading, Change password first, Change email second', async () => {
    signedIn({ hasPassword: true, googleLinked: true });
    renderApp('/settings/security');
    const heading = await screen.findByRole('heading', {
      name: 'Security',
      level: 1,
    });
    expect(heading.parentElement?.querySelector('svg')).toBeNull();
    expect(screen.getByText('Manage your account security.')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Change email' });
    const titles = within(screen.getByRole('main'))
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(titles).toEqual(['Change password', 'Change email']);
    const card = await emailCard();
    expect(
      (card.getByLabelText('Current email') as HTMLInputElement).value,
    ).toBe(testUser.email);
    expect(card.getByText('Verified')).toBeTruthy();
    expect(card.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('password: sends exactly one proof, then shows neutral copy, never “sent”', async () => {
    const calls = signedIn(
      { hasPassword: true, googleLinked: false },
      { 'POST /auth/email-change/request': accepted },
    );
    renderApp('/settings/security');
    const card = await emailCard();
    // Only linked methods are offered.
    expect(card.queryByRole('radio', { name: /Google account/ })).toBeNull();
    expect(
      (
        (await card.findByRole('radio', {
          name: /Password/,
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);

    await fillPassword(card, { email: '  New@Example.com ' });
    expect(await card.findByText(/Request received/)).toBeTruthy();
    expect(card.queryByText(/email (was )?sent/i)).toBeNull();
    expect(requests(calls)).toHaveLength(1);
    expect(requests(calls)[0]).toMatchObject({
      headers: { Authorization: 'Bearer stored-token' },
      body: { newEmail: 'new@example.com', currentPassword: 'Current1!' },
    });
    expect(Object.keys(requests(calls)[0].body as object).sort()).toEqual([
      'currentPassword',
      'newEmail',
    ]);
    // Fields are cleared and the 60-second pause blocks an immediate repeat.
    expect(
      (card.getByLabelText('Current password') as HTMLInputElement).value,
    ).toBe('');
    expect((card.getByLabelText('New email') as HTMLInputElement).value).toBe(
      '',
    );
    expect(
      (
        card.getByRole('button', {
          name: 'Send verification link',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(card.getByText(/request another link in 1:00|0:59/)).toBeTruthy();
    // Pending state is asked again after the request.
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === '/auth/email-change/pending').length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('validates locally before any request', async () => {
    const calls = signedIn({ hasPassword: true, googleLinked: false });
    renderApp('/settings/security');
    const card = await emailCard();
    await fillPassword(card, { email: 'not-an-email' });
    expect(card.getByText('Enter a valid email address.')).toBeTruthy();
    await fillPassword(card, { email: testUser.email.toUpperCase() });
    expect(card.getByText('This is already your email address.')).toBeTruthy();
    await fillPassword(card, { password: '' });
    // The tile description repeats the same words; the error is the second.
    expect(card.getAllByText('Enter your current password.')).toHaveLength(2);
    expect(requests(calls)).toHaveLength(0);
  });

  it.each([
    [fail(403, 'INVALID_CREDENTIALS'), 'Your current password is incorrect.'],
    [fail(429, 'TOO_MANY_REQUESTS'), /Too many attempts/],
    [fail(400, 'VALIDATION_FAILED'), 'Check the new email address.'],
    [fail(500, 'INTERNAL_ERROR', 'SQL detail'), /could not be sent/],
  ])(
    'maps %# failures to safe messages and stays signed in',
    async (response, text) => {
      signedIn(
        { hasPassword: true, googleLinked: false },
        { 'POST /auth/email-change/request': response },
      );
      renderApp('/settings/security');
      const card = await emailCard();
      await fillPassword(card);
      expect(await card.findByText(text)).toBeTruthy();
      expect(screen.queryByText(/SQL detail/)).toBeNull();
      expect(localStorage.getItem('kanban.session')).not.toBeNull();
      expect(card.queryByText(/Request received/)).toBeNull();
    },
  );

  it('Google-only: no password path; a fresh Google credential is the only proof', async () => {
    const google = installGoogle();
    const calls = signedIn(
      { hasPassword: false, googleLinked: true },
      { 'POST /auth/email-change/request': accepted },
    );
    renderApp('/settings/security');
    const card = await emailCard();
    expect(card.queryByLabelText('Current password')).toBeNull();
    expect(card.queryByRole('radio', { name: /^Password/ })).toBeNull();
    const button = await card.findByRole('button', {
      name: 'Continue with Google',
    });

    // Without a new email the popup result is ignored.
    fireEvent.click(button);
    expect(card.getByText('Enter your email address.')).toBeTruthy();
    act(() => google.respond('ignored'));
    expect(requests(calls)).toHaveLength(0);

    fireEvent.change(card.getByLabelText('New email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(button);
    act(() => google.respond('fresh-google-id-token'));
    expect(await card.findByText(/Request received/)).toBeTruthy();
    expect(requests(calls)[0].body).toEqual({
      newEmail: 'new@example.com',
      googleCredential: 'fresh-google-id-token',
    });
  });

  it('a rejected Google proof (401 INVALID_GOOGLE_CREDENTIAL) does not end the session', async () => {
    const google = installGoogle();
    signedIn(
      { hasPassword: true, googleLinked: true },
      {
        'POST /auth/email-change/request': fail(
          401,
          'INVALID_GOOGLE_CREDENTIAL',
        ),
      },
    );
    const { router } = renderApp('/settings/security');
    const card = await emailCard();
    fireEvent.click(await card.findByRole('radio', { name: /Google account/ }));
    expect(card.queryByLabelText('Current password')).toBeNull();
    fireEvent.change(card.getByLabelText('New email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(
      await card.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond('stale-token'));
    expect(
      await card.findByText(/Google couldn’t confirm your identity/),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings/security');
    expect(localStorage.getItem('kanban.session')).not.toBeNull();
  });

  it('shows only the masked pending address with time left and an honest re-request', async () => {
    const expiresAt = new Date(Date.now() + 29 * 60_000 + 48_000).toISOString();
    signedIn(
      { hasPassword: true, googleLinked: false },
      {
        'GET /auth/email-change/pending': ok({
          maskedNewEmail: 'n***@e***',
          issuedAt: new Date().toISOString(),
          expiresAt,
          newEmail: 'leak@example.com',
        }),
      },
    );
    renderApp('/settings/security');
    const card = await emailCard();
    const pending = await card.findByRole('group', {
      name: 'Email change pending',
    });
    expect(pending.textContent).toContain('n***@e***');
    expect(pending.textContent).toMatch(/expires in 29:4\d/);
    expect(screen.queryByText(/leak@example.com/)).toBeNull();
    expect(
      within(pending).queryByRole('button', { name: /cancel/i }),
    ).toBeNull();
    fireEvent.click(
      within(pending).getByRole('button', { name: 'Request another link' }),
    );
    expect(document.activeElement).toBe(card.getByLabelText('New email'));
    expect(
      card.getByText(/confirm your identity to request another link/),
    ).toBeTruthy();
  });

  it('hides an already expired pending intent', async () => {
    signedIn(
      { hasPassword: true, googleLinked: false },
      {
        'GET /auth/email-change/pending': ok({
          maskedNewEmail: 'n***@e***',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:30:00.000Z',
        }),
      },
    );
    renderApp('/settings/security');
    const card = await emailCard();
    await card.findByLabelText('New email');
    expect(card.queryByText(/Email change pending/)).toBeNull();
  });
});

describe('Profile email hint', () => {
  it('links to Security → Change email instead of saying it cannot change', async () => {
    signedIn({ hasPassword: true, googleLinked: false });
    renderApp('/settings/profile');
    const link = await screen.findByRole('link', {
      name: 'Security → Change email',
    });
    expect(link.getAttribute('href')).toBe('/settings/security');
    expect(screen.queryByText('Email cannot be changed.')).toBeNull();
  });
});
