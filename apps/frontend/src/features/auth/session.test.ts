import { describe, expect, it, vi } from 'vitest';
import { clearSession, readSession, saveSession } from './session';

describe('session storage', () => {
  it('stores the token with an expiry derived from expiresIn (seconds)', () => {
    const { session: stored } = saveSession('token', 3600, 1_000);
    expect(stored).toEqual({ accessToken: 'token', expiresAt: 3_601_000 });
    expect(readSession(2_000)).toEqual(stored);
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('treats expired sessions as missing and removes them', () => {
    saveSession('token', 60, 0);
    expect(readSession(60_000)).toBeNull();
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('ignores malformed entries', () => {
    localStorage.setItem('kanban.session', '{not json');
    expect(readSession()).toBeNull();
    localStorage.setItem('kanban.session', JSON.stringify({ accessToken: 1 }));
    expect(readSession()).toBeNull();
  });

  it('clears the stored session', () => {
    saveSession('token', 60);
    clearSession();
    expect(readSession()).toBeNull();
  });

  it('removes legacy per-tab credentials without importing them', () => {
    sessionStorage.setItem(
      'kanban.session',
      JSON.stringify({ accessToken: 'legacy', expiresAt: Date.now() + 60000 }),
    );
    expect(readSession()).toBeNull();
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(localStorage.getItem('kanban.session')).toBeNull();
    saveSession('new', 3600);
    sessionStorage.setItem('kanban.session', 'legacy-again');
    clearSession();
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(readSession()).toBeNull();
  });

  it.each([
    'null',
    '[]',
    '{"accessToken":"token","expiresAt":1e999}',
    '{"accessToken":"token","expiresAt":"99999999999999"}',
  ])('rejects malformed session shape %s', (raw) => {
    localStorage.setItem('kanban.session', raw);
    expect(readSession()).toBeNull();
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('returns an in-memory session without throwing when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readSession()).toBeNull();
    expect(saveSession('in-memory', 60, 0).session).toEqual({
      accessToken: 'in-memory',
      expiresAt: 60000,
    });
    expect(() => clearSession()).not.toThrow();
  });
});
