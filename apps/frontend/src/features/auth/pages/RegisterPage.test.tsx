import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok, testUser } from '../../../test/mock-api';
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
  });

  it('maps backend validation details to fields', async () => {
    mockApi({
      'POST /auth/register': fail(
        400,
        'VALIDATION_FAILED',
        'Validation failed',
        ['displayName must be shorter than or equal to 80 characters'],
      ),
    });
    renderApp('/register');

    fillRegister(validInput);

    expect(
      await screen.findByText(
        'Display name must be shorter than or equal to 80 characters',
      ),
    ).toBeTruthy();
  });
});
