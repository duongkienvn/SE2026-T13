import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, httpError } from '../../src/infrastructure/api/errors.ts';
import {
  deletionBody,
  createDeletionApi,
} from '../../src/features/account-deletion/api.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { USER_A } from '../auth/support.ts';
const blocked = (blockers: unknown) => ({
  success: false,
  statusCode: 409,
  code: 'ACCOUNT_DELETION_BLOCKED',
  message: 'Resolve ownership',
  blockers,
});
const types = [
  'PERSONAL_WORKSPACE_HAS_BOARDS',
  'BOARD_REQUIRES_ANOTHER_OWNER',
  'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
];
test('DELETE is exact, untrimmed and contains precisely one bounded proof', () => {
  assert.deepEqual(
    deletionBody({ confirmation: 'DELETE', currentPassword: ' pass ' }),
    { confirmation: 'DELETE', currentPassword: ' pass ' },
  );
  assert.deepEqual(
    deletionBody({ confirmation: 'DELETE', googleCredential: 'proof' }),
    { confirmation: 'DELETE', googleCredential: 'proof' },
  );
  for (const body of [
    { confirmation: 'delete', currentPassword: 'p' },
    { confirmation: ' DELETE', currentPassword: 'p' },
    { confirmation: 'DELETE' },
    { confirmation: 'DELETE', currentPassword: '' },
    { confirmation: 'DELETE', currentPassword: 'p', googleCredential: 'g' },
    { confirmation: 'DELETE', googleCredential: 'x'.repeat(8193) },
    { confirmation: 'DELETE', currentPassword: 'p', userId: USER_A },
  ])
    assert.throws(() => deletionBody(body));
});
test('only a complete validated ACCOUNT_DELETION_BLOCKED envelope carries resource names', () => {
  const blockers = types.map((type) => ({
    type,
    totalCount: 25,
    resources: [{ id: USER_A, name: 'Team work', secret: 'discard' }],
  }));
  const result = httpError(409, blocked(blockers));
  assert.equal(result.blockers.length, 3);
  assert.deepEqual(result.blockers[0]?.resources, [
    { id: USER_A, name: 'Team work' },
  ]);
  assert.equal(result.blockers[0]?.totalCount, 25);
  for (const value of [
    null,
    [],
    [{ type: 'UNKNOWN', totalCount: 1, resources: [] }],
    [
      {
        type: types[0],
        totalCount: 1,
        resources: [{ id: '../evil', name: 'bad' }],
      },
    ],
    [
      {
        type: types[0],
        totalCount: 1,
        resources: Array.from({ length: 21 }, () => ({
          id: USER_A,
          name: 'x',
        })),
      },
    ],
    [{ type: types[0], totalCount: 0, resources: [] }],
  ])
    assert.deepEqual(httpError(409, blocked(value)).blockers, []);
  assert.deepEqual(
    httpError(409, { ...blocked(blockers), code: 'CONFLICT' }).blockers,
    [],
  );
  assert.deepEqual(
    httpError(403, { ...blocked(blockers), statusCode: 403 }).blockers,
    [],
  );
});
test('authenticated DELETE accepts only 204, never retries, and Google proof 401 is narrowly exempt', async () => {
  const env = await integration();
  const api = createDeletionApi(env.data.api, env.identity),
    signal = () => new AbortController().signal;
  try {
    env.respond(() => Promise.resolve(new Response(null, { status: 204 })));
    await api.delete(
      { confirmation: 'DELETE', currentPassword: 'proof' },
      signal(),
    );
    assert.equal(env.requests[0]!.init.method, 'DELETE');
    assert.deepEqual(JSON.parse(env.requests[0]!.init.body as string), {
      confirmation: 'DELETE',
      currentPassword: 'proof',
    });
    for (const status of [200, 202]) {
      env.respond(() =>
        Promise.resolve(
          json({ success: true, statusCode: status, data: null }, status),
        ),
      );
      await assert.rejects(
        api.delete(
          { confirmation: 'DELETE', currentPassword: 'proof' },
          signal(),
        ),
      );
    }
    env.respond(() =>
      Promise.resolve(
        json(
          {
            success: false,
            statusCode: 401,
            code: 'INVALID_GOOGLE_CREDENTIAL',
            message: 'Invalid proof',
          },
          401,
        ),
      ),
    );
    await assert.rejects(
      api.delete(
        { confirmation: 'DELETE', googleCredential: 'proof' },
        signal(),
      ),
    );
    assert.ok(env.data.getIdentity());
    env.respond(() => Promise.resolve(json({}, 401)));
    await assert.rejects(
      api.delete(
        { confirmation: 'DELETE', currentPassword: 'proof' },
        signal(),
      ),
    );
    assert.equal(env.data.getIdentity(), null);
  } finally {
    env.dispose();
  }
});
test('blocked and ordinary conflict stay distinct; invalid blockers cannot become authoritative data', async () => {
  const env = await integration();
  const api = createDeletionApi(env.data.api, env.identity),
    signal = () => new AbortController().signal;
  try {
    env.respond(() =>
      Promise.resolve(
        json(
          blocked([
            {
              type: types[0],
              totalCount: 1,
              resources: [{ id: USER_A, name: 'Board' }],
            },
          ]),
          409,
        ),
      ),
    );
    await assert.rejects(
      api.delete(
        { confirmation: 'DELETE', currentPassword: 'proof' },
        signal(),
      ),
      (e) => e instanceof ApiError && e.blockers.length === 1,
    );
    env.respond(() =>
      Promise.resolve(
        json(blocked([{ type: 'UNKNOWN', resources: [], totalCount: 1 }]), 409),
      ),
    );
    await assert.rejects(
      api.delete(
        { confirmation: 'DELETE', currentPassword: 'proof' },
        signal(),
      ),
      (e) => e instanceof ApiError && e.kind === 'invalid-response',
    );
    env.respond(() =>
      Promise.resolve(ok({ hasPassword: true, googleLinked: false })),
    );
    assert.deepEqual(await api.providers(new AbortController().signal), {
      hasPassword: true,
      googleLinked: false,
    });
  } finally {
    env.dispose();
  }
});
