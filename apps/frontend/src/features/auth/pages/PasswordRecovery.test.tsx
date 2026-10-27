import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import {
  captureRecoveryLink,
  clearIncomingRecoveryToken,
  readIncomingRecoveryToken,
} from '../recovery-link';

const token = 'A'.repeat(43);
function fillReset(password = 'NewPass123!') {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
}

describe('password recovery routes', () => {
  it('navigates from Login and validates email with focus before requesting', async () => {
    const calls = mockApi({});
    renderApp('/login');
    fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    await screen.findByRole('heading', { name: 'Forgot your password?' });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'));
    expect(calls).toHaveLength(0);
  });
  it('normalizes email, shows generic acknowledgement and disables repeated sends', async () => {
    const calls = mockApi({ 'POST /auth/forgot-password': ok(null, 202) });
    renderApp('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: ' PERSON@Example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
    expect(await screen.findByText(/If this email is eligible/)).toBeTruthy();
    expect(calls[0].body).toEqual({ email: 'person@example.com' });
    expect(
      screen
        .getByRole('button', { name: /Wait 60 seconds/ })
        .hasAttribute('disabled'),
    ).toBe(true);
  });
  it('allows a retry after failure without showing false success', async () => {
    let attempts = 0;
    mockApi({
      'POST /auth/forgot-password': () =>
        ++attempts === 1 ? fail(429, 'TOO_MANY_REQUESTS') : ok(null, 202),
    });
    renderApp('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
    await screen.findByText(/Too many attempts/);
    expect(screen.queryByText(/If this email is eligible/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery link' }));
    await screen.findByText(/If this email is eligible/);
  });
  it('captures a copied link only in memory and strips query/hash at bootstrap', () => {
    window.history.replaceState(
      null,
      '',
      `/reset-password?token=${token}#sensitive`,
    );
    captureRecoveryLink();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(readIncomingRecoveryToken()).toBe(token);
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(localStorage.length).toBe(0);
    clearIncomingRecoveryToken();
    window.history.replaceState(null, '', '/');
  });
  it('validates new passwords and matching confirmation before the API call', async () => {
    const calls = mockApi({});
    const { router } = renderApp(`/reset-password?token=${token}`);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByLabelText('New password').getAttribute('type')).toBe(
      'password',
    );
    fillReset('weak');
    expect(calls).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText('New password'));
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'NewPass123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  });
  it('resets with a POST body and returns to login with feedback and no session', async () => {
    const calls = mockApi({ 'POST /auth/reset-password': { status: 204 } });
    renderApp(`/reset-password?token=${token}`);
    fillReset();
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(
      screen.getByText('Password updated. Log in with your new password.'),
    ).toBeTruthy();
    expect(calls[0]).toMatchObject({
      path: '/auth/reset-password',
      body: { token, newPassword: 'NewPass123!' },
    });
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });
  it('shows a safe expired/replayed error and recovery guidance without success', async () => {
    mockApi({
      'POST /auth/reset-password': fail(400, 'INVALID_PASSWORD_RESET_TOKEN'),
    });
    renderApp(`/reset-password?token=${token}`);
    fillReset();
    await screen.findByText(
      'This recovery link is invalid or expired. Request a new link.',
    );
    expect(
      screen
        .getByRole('button', { name: 'Save password' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('link', { name: 'Request a new recovery link' }),
    ).toBeTruthy();
    expect(screen.queryByText(/Password updated/)).toBeNull();
  });
  it('handles missing/malformed links without a password form', () => {
    mockApi({});
    renderApp('/reset-password?token=bad');
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.getByText(/This recovery link is invalid/)).toBeTruthy();
  });
  it('keeps recovery accessible for an authenticated Google-only user', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    renderApp(`/reset-password?token=${token}`);
    expect(await screen.findByLabelText('New password')).toBeTruthy();
  });
});
