import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../app/routes';
import { AppProviders } from '../../../app/AppProviders';
import { fail, mockApi, ok } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

// Synthetic values exercise encoding only; no real verification credentials.
const token = 'x'.repeat(43);

describe('email verification pages', () => {
  it('removes query/history and performs exactly one POST under StrictMode', async () => {
    const calls = mockApi({ 'POST /auth/verify-email': { status: 204 } });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/verify-email?token=${token}`],
    });
    render(
      <StrictMode>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </StrictMode>,
    );
    expect(
      await screen.findByText('Email verified. You can now log in to Kanvexa.'),
    ).toBeTruthy();
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
    expect(
      calls.filter((call) => call.path === '/auth/verify-email'),
    ).toHaveLength(1);
    expect(calls[0].body).toEqual({ token });
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to login' })).toBeTruthy();
  });

  it.each(['', '?token=malformed'])(
    'shows a missing/malformed link without sending a request',
    (query) => {
      const calls = mockApi({});
      renderApp(`/verify-email${query}`);
      expect(screen.getByRole('alert').textContent).toContain(
        'invalid or expired',
      );
      expect(calls).toHaveLength(0);
    },
  );

  it('offers resend for expired/consumed links', async () => {
    mockApi({
      'POST /auth/verify-email': fail(400, 'INVALID_VERIFICATION_TOKEN'),
    });
    renderApp(`/verify-email?token=${token}`);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'invalid or expired',
    );
    expect(
      screen
        .getByRole('link', { name: 'Request a new verification email' })
        .getAttribute('href'),
    ).toBe('/check-email');
  });

  it('does not retry an ambiguous network failure or retain token in browser storage', async () => {
    const calls = mockApi({
      'POST /auth/verify-email': fail(503, 'UNAVAILABLE'),
    });
    const { router } = renderApp(`/verify-email?token=${token}`);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not confirm',
    );
    expect(calls).toHaveLength(1);
    expect(router.state.location.search).toBe('');
    expect(Object.values(localStorage).join()).not.toContain(token);
    expect(Object.values(localStorage).join()).not.toContain(token);
  });

  it('supports direct check-email access, normalizes email and enforces cooldown', async () => {
    const calls = mockApi({ 'POST /auth/resend-verification': ok(null, 202) });
    renderApp('/check-email');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: ' Ada@Example.com ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Resend verification email' }),
    );
    expect((await screen.findByRole('status')).textContent).toContain(
      'an email may arrive',
    );
    expect(calls[0].body).toEqual({ email: 'ada@example.com' });
    expect(
      (
        screen.getByRole('button', {
          name: 'Resend in 60s',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(
      screen.getByRole('button', { name: 'Resend in 60s' }).closest('form')!,
    );
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('shows rate-limit failures and validates email before sending', async () => {
    const calls = mockApi({
      'POST /auth/resend-verification': fail(429, 'TOO_MANY_REQUESTS'),
    });
    renderApp('/check-email');
    fireEvent.click(
      screen.getByRole('button', { name: 'Resend verification email' }),
    );
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Resend verification email' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Too many requests',
    );
  });
});
