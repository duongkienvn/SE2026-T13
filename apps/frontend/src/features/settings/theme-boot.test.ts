import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stubColorScheme, tokenFor } from '../../test/theme-fixtures';
import { THEME_CACHE_KEY } from './theme';

// Runs the real inline script from index.html, not a copy of its logic.
// Vitest runs from the frontend package (jsdom's import.meta.url is HTTP).
const html = readFileSync(resolve('index.html'), 'utf8');
const source = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)?.[1];

function boot() {
  if (!source) throw new Error('theme-boot script not found in index.html');
  new Function(source)();
  return document.documentElement.dataset.theme;
}

function storeSession(accessToken: string, expiresAt = Date.now() + 60_000) {
  sessionStorage.setItem(
    'kanban.session',
    JSON.stringify({ accessToken, expiresAt }),
  );
}

function cacheTheme(userId: string, theme: string) {
  localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ userId, theme }));
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme boot script', () => {
  it('follows the OS when signed out, even with a cached theme', () => {
    cacheTheme('user-a', 'dark');
    stubColorScheme(false);
    expect(boot()).toBe('light');
    stubColorScheme(true);
    expect(boot()).toBe('dark');
  });

  it("applies the signed-in user's cached theme", () => {
    stubColorScheme(true);
    storeSession(tokenFor('user-a'));
    cacheTheme('user-a', 'light');
    expect(boot()).toBe('light');
  });

  it('resolves a cached system choice against the OS', () => {
    stubColorScheme(true);
    storeSession(tokenFor('user-a'));
    cacheTheme('user-a', 'system');
    expect(boot()).toBe('dark');
  });

  it("never applies another account's cached theme", () => {
    stubColorScheme(false);
    storeSession(tokenFor('user-b'));
    cacheTheme('user-a', 'dark');
    expect(boot()).toBe('light');
  });

  it('ignores an expired session', () => {
    stubColorScheme(false);
    storeSession(tokenFor('user-a'), Date.now() - 1);
    cacheTheme('user-a', 'dark');
    expect(boot()).toBe('light');
  });

  it.each([
    ['a token without a payload', 'opaque-token', 'dark'],
    ['a malformed payload', 'header.%%%.signature', 'dark'],
    ['an unknown theme value', tokenFor('user-a'), 'sepia'],
  ])('falls back to the OS for %s', (_case, token, theme) => {
    stubColorScheme(false);
    storeSession(token);
    cacheTheme('user-a', theme);
    expect(boot()).toBe('light');
  });

  it('defaults to light where matchMedia is unavailable', () => {
    expect(boot()).toBe('light');
  });
});
