import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { okPage } from '../../../test/board-fixtures';
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
  password: 'Kanvexa@2026',
  confirmPassword: 'Kanvexa@2026',
};

describe('RegisterPage', () => {
  it('updates all four checklist states while typing and deleting without replacing the list', () => {
    renderApp('/register');
    const list = screen.getByRole('list', { name: 'Password requirements' });
    const password = screen.getByLabelText('Password');
    expect(within(list).getAllByText('Not met:')).toHaveLength(4);
    fireEvent.change(password, { target: { value: '12345678' } });
    expect(within(list).getAllByText('Met:')).toHaveLength(2);
    expect(within(list).getAllByText('Not met:')).toHaveLength(2);
    fireEvent.change(password, { target: { value: 'ABC1234!' } });
    expect(within(list).getAllByText('Met:')).toHaveLength(4);
    expect(screen.getByText(/4 of 4 password requirements met/)).toBeTruthy();
    fireEvent.change(password, { target: { value: '' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getAllByText('Not met:')).toHaveLength(4);
    expect(screen.getByRole('list', { name: 'Password requirements' })).toBe(
      list,
    );
    expect(screen.getByText('0/128')).toBeTruthy();
  });

  it.each([
    '12345678',
    'Abcdefg1',
    'Abcdefg!',
    'abcdef1!',
    'Ab1!xyz',
    'ABC1234 ',
    `A1!${'x'.repeat(126)}`,
  ])(
    'blocks invalid password before sending a registration request: %s',
    (password) => {
      const calls = mockApi({});
      renderApp('/register');
      fillRegister({ ...validInput, password, confirmPassword: password });
      expect(calls).toHaveLength(0);
      const input = screen.getByLabelText('Password');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input);
      const descriptions = input
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => document.getElementById(id));
      expect(descriptions).toHaveLength(2); // checklist and error, both present.
      expect(descriptions.every(Boolean)).toBe(true);
    },
  );

  it('shows the maximum and announces an overlong password', () => {
    renderApp('/register');
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: `A1!${'x'.repeat(126)}` },
    });
    expect(screen.getByText('Maximum 128 characters')).toBeTruthy();
    expect(screen.getByText('129/128')).toBeTruthy();
    expect(screen.getByText(/Password exceeds 128 characters\./)).toBeTruthy();
  });

  it('blocks a confirmation mismatch even when the password satisfies every requirement', () => {
    const calls = mockApi({});
    renderApp('/register');
    fillRegister({ ...validInput, confirmPassword: `${validInput.password} ` });
    expect(calls).toHaveLength(0);
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText('Confirm password'),
    );
  });

  it('keeps both show/hide controls accessible and preserves password values', () => {
    const calls = mockApi({});
    renderApp('/register');
    for (const label of ['Password', 'Confirm password']) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: validInput.password },
      });
    }
    const show = screen.getAllByRole('button', { name: 'Show password' });
    for (const button of show) {
      expect(button.getAttribute('type')).toBe('button');
      fireEvent.click(button);
    }
    for (const label of ['Password', 'Confirm password']) {
      expect(screen.getByLabelText(label).getAttribute('type')).toBe('text');
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(
        validInput.password,
      );
    }
    for (const button of screen.getAllByRole('button', {
      name: 'Hide password',
    }))
      fireEvent.click(button);
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe(
      'password',
    );
    expect(screen.getByLabelText('Confirm password').getAttribute('type')).toBe(
      'password',
    );
    expect(calls).toHaveLength(0);
  });

  it.each(['ABC1234!', '  ABC1234! e\u0301  ', `A1!${'😀'.repeat(125)}`])(
    'sends valid registration passwords verbatim, without confirmPassword: %s',
    async (password) => {
      const calls = mockApi({ 'POST /auth/register': ok(testUser, 201) });
      renderApp('/register');
      fillRegister({ ...validInput, password, confirmPassword: password });
      await screen.findByRole('heading', { name: 'Check your email' });
      expect(calls[0].body).toEqual({
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        password,
      });
    },
  );

  it('continues from valid registration through verification to manual login', async () => {
    const token = 'x'.repeat(43);
    const calls = mockApi({
      'POST /auth/register': ok(testUser, 201),
      'POST /auth/verify-email': { status: 204 },
      'POST /auth/login': ok(loginResponse()),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    const { router } = renderApp('/register');
    fillRegister(validInput);
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    await router.navigate(`/verify-email?token=${token}`);
    await screen.findByText('Email verified. You can now log in to Kanvexa.');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Back to login' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: testUser.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: validInput.password },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await screen.findByRole('heading', { name: 'Boards' });
    expect(
      calls.filter((call) => call.method === 'POST').map((call) => call.path),
    ).toEqual(['/auth/register', '/auth/verify-email', '/auth/login']);
  });

  it('announces backend password errors alongside the checklist', async () => {
    mockApi({
      'POST /auth/register': fail(
        400,
        'VALIDATION_FAILED',
        'Validation failed',
        [
          'password: password must contain an uppercase letter (A–Z), a number (0–9), and a special character (punctuation or symbol, not whitespace)',
        ],
      ),
    });
    renderApp('/register');
    fillRegister(validInput);
    const error = await screen.findByText(
      'Password must contain an uppercase letter (A–Z), a number (0–9), and a special character (punctuation or symbol, not whitespace)',
    );
    const input = screen.getByLabelText('Password');
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain(error.id);
    expect(ids.every((id) => document.getElementById(id))).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('registers without signing in and continues to check-email', async () => {
    const calls = mockApi({ 'POST /auth/register': ok(testUser, 201) });
    const { router } = renderApp('/register');

    fillRegister(validInput);

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(router.state.location.pathname).toBe('/check-email');
    expect(
      (screen.getByLabelText('Email address') as HTMLInputElement).value,
    ).toBe(testUser.email);
    expect(calls[0].body).toEqual({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Kanvexa@2026',
    });
    expect(calls[0].body).not.toHaveProperty('confirmPassword');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(
      screen.queryByText('Account created. Log in to continue.'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Resend in 60s' })).toBeTruthy();
  });

  it('keeps the originally requested page through register and login', async () => {
    mockApi({
      'POST /auth/register': ok(testUser, 201),
      'POST /auth/login': ok(loginResponse()),
    });
    const { router } = renderApp('/profile');

    fireEvent.click(await screen.findByRole('link', { name: 'Create one' }));
    fillRegister(validInput);
    fireEvent.click(await screen.findByRole('link', { name: 'Back to login' }));
    await screen.findByLabelText('Password');
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

  it('keeps provider failure recoverable without asking for duplicate registration', async () => {
    mockApi({ 'POST /auth/register': fail(503, 'MAIL_DELIVERY_UNAVAILABLE') });
    const { router } = renderApp('/register');
    fillRegister(validInput);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'account was created',
    );
    expect(router.state.location.pathname).toBe('/check-email');
    expect(
      (screen.getByLabelText('Email address') as HTMLInputElement).value,
    ).toBe('ada@example.com');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
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
    expect(document.title).toBe('Create account · Kanvexa');
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
