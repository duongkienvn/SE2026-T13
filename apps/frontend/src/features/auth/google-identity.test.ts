import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGoogle } from '../../test/fake-google';

afterEach(() => {
  vi.unstubAllEnvs();
  document
    .querySelectorAll(
      'script[src="https://accounts.google.com/gsi/client?hl=en"]',
    )
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
      'script[src="https://accounts.google.com/gsi/client?hl=en"]',
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
    const callback = vi.mocked(api.initialize).mock.calls[0][0].callback;
    callback({ credential: 'without-state' });
    callback({ credential: 'wrong-state', state: 'unknown-button' });
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

  it('fits SDK width to the auth container, caps it at 400 and preserves callback state through resize', async () => {
    const google = installGoogle();
    const { renderGoogleButton } = await import('./google-identity');
    let resize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const element = document.createElement('div');
    let width = 560;
    Object.defineProperty(element, 'clientWidth', { get: () => width });
    const received = vi.fn(),
      click = vi.fn();
    const dispose = renderGoogleButton(
      google.api,
      '123456-test.apps.googleusercontent.com',
      element,
      received,
      click,
      true,
    );
    const firstOptions = vi.mocked(google.api.renderButton).mock.calls[0][1];
    expect(firstOptions).toMatchObject({
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      locale: 'en',
      text: 'continue_with',
      width: 400,
    });
    expect(observe).toHaveBeenCalledWith(element);
    const notify = () => resize([], {} as ResizeObserver);
    notify();
    expect(google.api.renderButton).toHaveBeenCalledTimes(1);
    width = 310;
    notify();
    expect(vi.mocked(google.api.renderButton).mock.lastCall?.[1]).toMatchObject(
      { width: 310, state: firstOptions.state, click_listener: click },
    );
    expect(element.querySelectorAll('button')).toHaveLength(1);
    google.respond('resized-token');
    expect(received).toHaveBeenCalledWith('resized-token');
    expect(google.api.initialize).toHaveBeenCalledTimes(1);
    width = 900;
    notify();
    expect(vi.mocked(google.api.renderButton).mock.lastCall?.[1].width).toBe(
      400,
    );
    dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
    width = 250;
    notify();
    expect(google.api.renderButton).toHaveBeenCalledTimes(3);
    expect(element.childElementCount).toBe(0);
  });

  it('keeps compact consumers unchanged and does not observe them', async () => {
    const google = installGoogle();
    const { renderGoogleButton } = await import('./google-identity');
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
      },
    );
    const dispose = renderGoogleButton(
      google.api,
      '123456-test.apps.googleusercontent.com',
      document.createElement('div'),
      vi.fn(),
      vi.fn(),
    );
    expect(google.api.renderButton).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 280 }),
    );
    expect(
      vi.mocked(google.api.renderButton).mock.lastCall?.[1],
    ).not.toHaveProperty('locale');
    expect(observe).not.toHaveBeenCalled();
    dispose();
  });
});
