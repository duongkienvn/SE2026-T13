import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

function fillRegister(values: {
  displayName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}) {
  const fields: Record<string, string | undefined> = {
    'Display name': values.displayName,
    'Email address': values.email,
    Password: values.password,
    'Confirm password': values.confirmPassword,
  };
  for (const [label, value] of Object.entries(fields)) {
    if (value !== undefined)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

const validInput = {
  displayName: '  Ada Lovelace ',
  email: 'Ada@Example.com',
  password: 'analytical-engine',
  confirmPassword: 'analytical-engine',
};

describe('RegisterPage', () => {
  it('registers without signing in and continues to login', async () => {
    const calls = mockApi({ 'POST /auth/register': ok(testUser, 201) });
    const { router } = renderApp('/register');

    fillRegister(validInput);

    expect((await screen.findByRole('status')).textContent).toContain(
      'Account created',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(
      (screen.getByLabelText('Email address') as HTMLInputElement).value,
    ).toBe(testUser.email);
    expect(calls[0].body).toEqual({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'analytical-engine',
    });
    expect(calls[0].body).not.toHaveProperty('confirmPassword');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    // The one-time feedback is removed from history so reloads don't repeat it.
    // The history update happens in an effect after the message renders.
    await waitFor(() =>
      expect(router.state.location.state).not.toHaveProperty('registeredEmail'),
    );
    expect(screen.getByRole('status').textContent).toContain('Account created');
  });

  it('keeps the originally requested page through register and login', async () => {
    mockApi({
      'POST /auth/register': ok(testUser, 201),
      'POST /auth/login': ok(loginResponse()),
    });
    const { router } = renderApp('/profile');

    fireEvent.click(await screen.findByRole('link', { name: 'Create one' }));
    fillRegister(validInput);
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: validInput.password },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/profile'),
    );
  });

  it('checks the password confirmation and lengths on the client', () => {
    const calls = mockApi({});
    renderApp('/register');

    fillRegister({
      displayName: 'A',
      email: 'ada@example.com',
      password: 'short',
      confirmPassword: 'different',
    });

    expect(
      screen.getByText('Display name must be at least 2 characters.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Password must be at least 8 characters.'),
    ).toBeTruthy();
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('treats a generic 409 conflict as a duplicate email', async () => {
    mockApi({
      'POST /auth/register': fail(
        409,
        'CONFLICT',
        'Database constraint conflict',
      ),
    });
    renderApp('/register');

    fillRegister(validInput);

    expect(
      await screen.findByText('This email is already registered.'),
    ).toBeTruthy();
  });

  it('shows a duplicate-email error on the email field', async () => {
    mockApi({
      'POST /auth/register': fail(409, 'EMAIL_ALREADY_EXISTS', 'Email exists'),
    });
    renderApp('/register');

    fillRegister(validInput);

    expect(
      await screen.findByText('This email is already registered.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Email address').getAttribute('aria-invalid'),
    ).toBe('true');
    // Server-side field errors also move focus to the field.
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'));
    expect(document.title).toBe('Create account · Kanban');
  });

  it('maps backend validation details to fields', async () => {
    mockApi({
      'POST /auth/register': fail(
        400,
        'VALIDATION_FAILED',
        'Validation failed',
        // Real backend format: "<path>: <class-validator message>".
        [
          'displayName: displayName must be shorter than or equal to 80 characters',
          'unexpectedField: property unexpectedField should not exist',
        ],
      ),
    });
    renderApp('/register');

    fillRegister(validInput);

    expect(
      await screen.findByText(
        'Display name must be shorter than or equal to 80 characters',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Property unexpectedField should not exist',
    );
    expect(screen.getByRole('alert').textContent).not.toContain(
      'unexpectedField:',
    );
  });
});
