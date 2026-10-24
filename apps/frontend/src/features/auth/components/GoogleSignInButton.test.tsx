import { StrictMode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleSignInButton } from './GoogleSignInButton';
import { AuthSessionContext } from '../auth-session-context';
import { installGoogle } from '../../../test/fake-google';

afterEach(() => vi.unstubAllEnvs());
function mount(
  onStart = vi.fn(() => vi.fn().mockResolvedValue(undefined)),
  current = () => true,
) {
  return render(
    <StrictMode>
      <AuthSessionContext value={{ generation: 0, isCurrent: current }}>
        <GoogleSignInButton onStart={onStart} />
      </AuthSessionContext>
    </StrictMode>,
  );
}

describe('Google sign-in button lifecycle', () => {
  it('keeps local login guidance when not configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    mount();
    expect(screen.getByText(/not configured/)).toBeTruthy();
  });
  it('handles StrictMode and duplicate responses without initializing twice or making duplicate requests', async () => {
    const google = installGoogle();
    const execute = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn(() => execute);
    mount(start);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => {
      google.respond();
      google.respond();
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledTimes(1);
    expect(google.api.initialize).toHaveBeenCalledTimes(1);
  });
  it('does nothing when popup closes without a credential; a later click remains usable', async () => {
    const google = installGoogle();
    const execute = vi.fn().mockResolvedValue(undefined);
    mount(vi.fn(() => execute));
    const button = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    fireEvent.click(button);
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByText(/If it closes or is blocked/)).toBeTruthy();
    fireEvent.click(button);
    act(() => google.respond());
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  });
  it('drops credentials after session switch or unmount', async () => {
    const google = installGoogle();
    const execute = vi.fn().mockResolvedValue(undefined);
    let current = true;
    const view = mount(
      vi.fn(() => execute),
      () => current,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    current = false;
    act(() => google.respond());
    expect(execute).not.toHaveBeenCalled();
    view.unmount();
    act(() => google.respond());
    expect(execute).not.toHaveBeenCalled();
  });
  it('catches API failure and permits retry', async () => {
    const google = installGoogle();
    const execute = vi.fn().mockRejectedValue(new Error('API failed'));
    mount(vi.fn(() => execute));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    expect(await screen.findByText(/could not complete/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  });
  it('shows a safe fallback when the official script fails', async () => {
    vi.stubEnv(
      'VITE_GOOGLE_CLIENT_ID',
      '123456-test.apps.googleusercontent.com',
    );
    mount();
    const script = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    expect(script).toBeTruthy();
    act(() => script!.dispatchEvent(new Event('error')));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
