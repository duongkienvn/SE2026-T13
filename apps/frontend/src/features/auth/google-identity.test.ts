import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGoogle } from '../../test/fake-google';

afterEach(() => {
  vi.unstubAllEnvs();
  document
    .querySelectorAll('script[src="https://accounts.google.com/gsi/client"]')
    .forEach((script) => script.remove());
});

describe('GIS shared loader and callback isolation', () => {
  it('loads a single official script for concurrent consumers', async () => {
    vi.resetModules();
    const { loadGoogleIdentity } = await import('./google-identity');
    const first = loadGoogleIdentity();
    const second = loadGoogleIdentity();
    expect(first).toBe(second);
    const scripts = document.querySelectorAll(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    expect(scripts).toHaveLength(1);
    const { api } = installGoogle();
    scripts[0].dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(api);
  });

  it('recovers on later mount after script failure', async () => {
    vi.resetModules();
    const { loadGoogleIdentity } = await import('./google-identity');
    const first = loadGoogleIdentity();
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('could not load');
    const next = loadGoogleIdentity();
    const { api } = installGoogle();
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await expect(next).resolves.toBe(api);
  });

  it('times out without leaving an indefinitely pending loader', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    try {
      const { loadGoogleIdentity } = await import('./google-identity');
      const promise = loadGoogleIdentity();
      const result = expect(promise).rejects.toThrow('could not load');
      await vi.advanceTimersByTimeAsync(10_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it('initializes once across mounts, renders official buttons and drops old/missing button state', async () => {
    const { api, respond } = installGoogle();
    const { renderGoogleButton } = await import('./google-identity');
    const old = vi.fn(),
      next = vi.fn(),
      click = vi.fn();
    const firstElement = document.createElement('div');
    const dispose = renderGoogleButton(
      api,
      '123456-test.apps.googleusercontent.com',
      firstElement,
      old,
      click,
    );
    dispose();
    renderGoogleButton(
      api,
      '123456-test.apps.googleusercontent.com',
      document.createElement('div'),
      next,
      click,
    );
    expect(api.initialize).toHaveBeenCalledTimes(1);
    expect(api.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ auto_select: false, ux_mode: 'popup' }),
    );
    respond('old-token', 0);
    expect(old).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    respond('current-token', 1);
    expect(next).toHaveBeenCalledWith('current-token');
    expect(firstElement.childElementCount).toBe(0);
  });

  it.each(['', 'arbitrary', 'https://evil.test'])(
    'disables missing/malformed public configuration',
    async (value) => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', value);
      const { getGoogleClientId } = await import('./google-identity');
      expect(getGoogleClientId()).toBeNull();
    },
  );
});
