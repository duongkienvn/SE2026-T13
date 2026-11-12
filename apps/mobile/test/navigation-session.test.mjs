import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultSessionAdapter,
  resumeTarget,
  safeReturnTarget,
  reconcileSession,
  emptyGuardMemory,
  guardDecision,
} from '../src/navigation/session.ts';

test('protected return targets require an authenticated external session', () => {
  const target = safeReturnTarget('/search');
  for (const status of [
    'restoring',
    'verifying',
    'unauthenticated',
    'expired',
    'offline-uncertain',
  ]) {
    assert.equal(resumeTarget({ status }, target), null);
  }
  assert.equal(
    resumeTarget({ status: 'authenticated', sessionKey: 'test-only' }, target),
    '/search',
  );
  assert.equal(defaultSessionAdapter.getSnapshot().status, 'unauthenticated');
});

test('session and server access both fail closed', () => {
  const authenticated = { status: 'authenticated', sessionKey: 'test-only' };
  const path = '/boards/01234567-89ab-cdef-0123-456789abcdef';
  const allowed = {
    status: 'allowed',
    sessionKey: 'test-only',
    resourcePath: path,
  };
  for (const status of [
    'restoring',
    'verifying',
    'unauthenticated',
    'expired',
    'offline-uncertain',
  ]) {
    assert.notEqual(guardDecision({ status }, allowed, path), 'render');
  }
  assert.equal(
    guardDecision({ status: 'authenticated', sessionKey: '' }, allowed, path),
    'sign-in',
  );
  assert.equal(guardDecision(authenticated, 'checking', path), 'wait');
  assert.equal(
    guardDecision(authenticated, 'unavailable', path),
    'unavailable',
  );
  assert.equal(guardDecision(authenticated, allowed, path), 'render');
  assert.equal(
    guardDecision({ ...authenticated, sessionKey: 'other' }, allowed, path),
    'wait',
  );
  assert.equal(
    guardDecision(
      authenticated,
      allowed,
      '/boards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ),
    'wait',
  );
  assert.equal(guardDecision(authenticated, allowed, '/search'), 'unavailable');
});

test('only a validated internal destination can be retained', () => {
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/boards/%2e%2e/home',
    '/unknown',
  ]) {
    assert.equal(safeReturnTarget(value), null);
  }
});

test('logout and account switch clear pending targets', () => {
  const pending = safeReturnTarget('/search');
  const authenticated = reconcileSession(
    { ...emptyGuardMemory, pending },
    { status: 'authenticated', sessionKey: 'one' },
  );
  assert.deepEqual(authenticated.pending, pending);
  assert.deepEqual(
    reconcileSession(authenticated, { status: 'unauthenticated' }),
    emptyGuardMemory,
  );
  assert.equal(
    reconcileSession(authenticated, {
      status: 'authenticated',
      sessionKey: 'two',
    }).pending,
    null,
  );
});

test('a transient verification preserves the target only for the same session', () => {
  const pending = safeReturnTarget('/search');
  const memory = { pending, sessionKey: 'one' };
  for (const status of ['verifying', 'restoring', 'offline-uncertain']) {
    const unresolved = reconcileSession(memory, { status });
    assert.deepEqual(
      reconcileSession(unresolved, {
        status: 'authenticated',
        sessionKey: 'one',
      }).pending,
      pending,
    );
    assert.equal(
      reconcileSession(unresolved, {
        status: 'authenticated',
        sessionKey: 'two',
      }).pending,
      null,
    );
  }
});
