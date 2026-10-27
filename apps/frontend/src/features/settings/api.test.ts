import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok } from '../../test/mock-api';
import { getPreferences, updatePreferences } from './api';
import type { UserPreferences } from './types';

const prefs: UserPreferences = {
  theme: 'dark',
  timeZone: 'Asia/Ho_Chi_Minh',
  dateFormat: 'DD/MM/YYYY',
  weekStartsOn: 'sunday',
};

describe('preferences REST adapter', () => {
  it('reads the current user preferences with the bearer token', async () => {
    const calls = mockApi({ 'GET /users/me/preferences': ok(prefs) });
    expect(await getPreferences('secret')).toEqual(prefs);
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
  });

  it('sends only the given fields', async () => {
    const calls = mockApi({ 'PATCH /users/me/preferences': ok(prefs) });
    await updatePreferences('secret', { theme: 'dark' });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].body).toEqual({ theme: 'dark' });
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
  });

  it('surfaces server validation errors', async () => {
    mockApi({
      'PATCH /users/me/preferences': fail(400, 'VALIDATION_FAILED', 'Bad', [
        'timeZone must be a valid time zone',
      ]),
    });
    await expect(
      updatePreferences('secret', { timeZone: 'Mars/Base' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });
});
