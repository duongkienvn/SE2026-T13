import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { isPublicNavigationPreview } from '../src/navigation/preview.ts';

test('retired preview flag never bypasses real authentication', () => {
  const previous = process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW;
  try {
    delete process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW;
    assert.equal(isPublicNavigationPreview('/home'), false);
    process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW = '1';
    for (const path of [
      '/home',
      '/tasks',
      '/boards',
      '/inbox',
      '/search',
      '/settings',
      '/invitation',
    ]) {
      assert.equal(isPublicNavigationPreview(path), false, path);
    }
    for (const path of [
      '/boards/01234567-89ab-cdef-0123-456789abcdef',
      '/workspaces/01234567-89ab-cdef-0123-456789abcdef',
      '/boards/01234567-89ab-cdef-0123-456789abcdef/cards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '/unknown',
      '/%2e%2e/settings',
    ]) {
      assert.equal(isPublicNavigationPreview(path), false, path);
    }
  } finally {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW;
    else process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW = previous;
  }
});
