import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseApiBaseUrl,
  requestUrl,
} from '../../src/infrastructure/api/config.ts';

test('configuration has no implicit server and permits HTTP only on explicit development local hosts', () => {
  for (const value of [
    undefined,
    '',
    'nope',
    'http://example.test/api',
    'https://u:p@example.test/api',
    'https://example.test/api?secret=x',
    'https://example.test/api#x',
  ])
    assert.equal(parseApiBaseUrl(value, true), null);
  for (const host of [
    '10.0.2.2',
    '192.168.1.5',
    '172.20.0.2',
    'localhost',
    '[::1]',
  ]) {
    assert.ok(parseApiBaseUrl(`http://${host}:3000/api`, true));
    assert.equal(parseApiBaseUrl(`http://${host}:3000/api`, false), null);
  }
  assert.ok(parseApiBaseUrl('https://example.test/api', false));
});

test('URL encoding preserves the API prefix, repeated parameters and falsy values', () => {
  const base = parseApiBaseUrl('https://example.test/api', false)!;
  assert.equal(
    requestUrl(base, '/boards/a%2Fb', {
      q: 'a & é?',
      label: ['two words', 'x/y'],
      page: 0,
      active: false,
      absent: null,
    }),
    'https://example.test/api/boards/a%2Fb?active=false&label=two+words&label=x%2Fy&page=0&q=a+%26+%C3%A9%3F',
  );
  for (const path of [
    'https://evil.test/',
    '//evil.test/',
    '/../outside',
    '/x?token=y',
    '/x#y',
    '/x\\y',
  ])
    assert.throws(() => requestUrl(base, path));
});
