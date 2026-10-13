import { describe, expect, it } from 'vitest';
import { clearSession, readSession, saveSession } from './session';

describe('session storage', () => {
  it('stores the token with an expiry derived from expiresIn (seconds)', () => {
    const stored = saveSession('token', 3600, 1_000);
    expect(stored).toEqual({ accessToken: 'token', expiresAt: 3_601_000 });
    expect(readSession(2_000)).toEqual(stored);
    expect(localStorage.length).toBe(0);
  });

  it('treats expired sessions as missing and removes them', () => {
    saveSession('token', 60, 0);
    expect(readSession(60_000)).toBeNull();
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('ignores malformed entries', () => {
    sessionStorage.setItem('kanban.session', '{not json');
    expect(readSession()).toBeNull();
    sessionStorage.setItem(
      'kanban.session',
      JSON.stringify({ accessToken: 1 }),
    );
    expect(readSession()).toBeNull();
  });

  it('clears the stored session', () => {
    saveSession('token', 60);
    clearSession();
    expect(readSession()).toBeNull();
  });
});
