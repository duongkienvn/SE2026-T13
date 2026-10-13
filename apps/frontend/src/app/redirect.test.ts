import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTHENTICATED_PATH, safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('keeps internal paths with query and hash', () => {
    expect(safeRedirectPath('/profile?tab=1#top')).toBe('/profile?tab=1#top');
  });

  it.each([
    undefined,
    42,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'profile',
    '/login',
    '/register?x=1',
  ])('falls back to the default for %s', (value) => {
    expect(safeRedirectPath(value)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });
});
