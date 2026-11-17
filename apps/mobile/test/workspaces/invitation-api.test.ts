import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceRole } from '@kanban/shared';
import {
  createInvitationAdminApi,
  createInvitationRecipientApi,
} from '../../src/features/workspaces/invitations/api.ts';
import {
  decodeInvitation,
  invitationEmail,
} from '../../src/features/workspaces/invitations/decoder.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { parseResourceId } from '../../src/navigation/routes.ts';
import {
  WORKSPACE,
  integration,
  json,
} from '../realtime/integration-support.ts';
import { page, uuid } from './fixtures.ts';

const id = parseResourceId(WORKSPACE)!;
const inviteId = parseResourceId(uuid(42))!;
const date = '2026-11-17T12:00:00.000Z';
const expiresAt = '2026-11-24T12:00:00.000Z';
const proof = 'b'.repeat(43);
const signal = new AbortController().signal;
const row = {
  id: inviteId,
  workspaceId: id,
  invitedById: uuid(23),
  email: 'member@example.test',
  role: 'MEMBER',
  status: 'PENDING',
  sendState: 'UNAVAILABLE',
  createdAt: date,
  updatedAt: date,
  expiresAt,
  consumedAt: null,
  revokedAt: null,
  declinedAt: null,
};

test('invitation decoding accepts all documented statuses and delivery states without retaining secrets', () => {
  for (const status of [
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'REVOKED',
    'DECLINED',
  ])
    for (const sendState of [
      'UNAVAILABLE',
      'DISPATCHING',
      'SENT',
      'FAILED',
      'UNKNOWN',
    ])
      assert.deepEqual(
        decodeInvitation({
          ...row,
          status,
          sendState,
          proof,
          tokenHash: proof,
        }),
        { ...row, status, sendState },
      );
  assert.throws(() => decodeInvitation({ ...row, role: 'ADMIN' }));
  assert.throws(() => decodeInvitation({ ...row, declinedAt: undefined }));
  assert.throws(() => decodeInvitation({ ...row, sendState: 'DELIVERED' }));
  assert.throws(() => decodeInvitation({ ...row, expiresAt: 'yesterday' }));
  assert.equal(invitationEmail(' Member@Example.Test '), row.email);
  assert.equal(invitationEmail('two@@example.test'), undefined);
});

test('invitation API uses exact routes, 202/200/204 and MEMBER role', async () => {
  const env = await integration();
  const admin = createInvitationAdminApi(env.data.api, env.identity, id);
  const recipient = createInvitationRecipientApi(env.data.api, env.identity);
  const prefix = '/api/workspaces/' + id + '/invitations';
  const member = {
    userId: env.identity.userId,
    displayName: 'Member',
    avatarUrl: null,
    avatarRevision: 0,
    joinedAt: date,
    role: WorkspaceRole.MEMBER,
  };
  const bodies = [
    [
      'POST',
      prefix,
      { email: row.email, role: 'MEMBER' },
      json(
        { success: true, statusCode: 202, message: 'Accepted', data: row },
        202,
      ),
    ],
    ['GET', prefix, undefined, json(page([row], 1, 20))],
    [
      'DELETE',
      prefix + '/' + inviteId,
      undefined,
      new Response(null, { status: 204 }),
    ],
    [
      'POST',
      '/api/workspace-invitations/accept',
      { proof },
      json({ success: true, statusCode: 200, message: 'OK', data: member }),
    ],
    [
      'POST',
      '/api/workspace-invitations/decline',
      { proof },
      new Response(null, { status: 204 }),
    ],
  ] as const;
  let request = 0;
  env.respond((url, init) => {
    const expected = bodies[request++]!;
    assert.equal(init.method, expected[0]);
    assert.equal(new URL(url).pathname, expected[1]);
    assert.deepEqual(
      init.body ? JSON.parse(String(init.body)) : undefined,
      expected[2],
    );
    if (init.method === 'GET')
      assert.deepEqual(Object.fromEntries(new URL(url).searchParams), {
        page: '1',
        limit: '20',
        status: 'PENDING',
      });
    return Promise.resolve(expected[3]);
  });
  try {
    assert.equal(
      (await admin.issue(' Member@Example.Test ', signal)).sendState,
      'UNAVAILABLE',
    );
    assert.equal((await admin.history(1, 'PENDING', signal)).meta.total, 1);
    assert.equal(await admin.revoke(inviteId, signal), undefined);
    assert.deepEqual(await recipient.accept(proof, signal), member);
    assert.equal(await recipient.decline(proof, signal), undefined);
    assert.throws(() => admin.issue('invalid', signal));
    assert.throws(() => recipient.accept(proof.slice(1), signal));
    assert.equal(request, 5);
  } finally {
    env.dispose();
  }
});

test('an invitation POST is never replayed on an unexpected status or a 429', async () => {
  const env = await integration();
  const api = createInvitationAdminApi(env.data.api, env.identity, id);
  try {
    env.respond(async () =>
      json(
        { success: true, statusCode: 201, message: 'Created', data: row },
        201,
      ),
    );
    await assert.rejects(api.issue(row.email, signal));
    const before = env.requests.length;
    env.respond(
      async () =>
        new Response(JSON.stringify({}), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '300' },
        }),
    );
    await assert.rejects(
      api.issue(row.email, signal),
      (error) =>
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfterMs === 300_000,
    );
    assert.equal(env.requests.length, before + 1);
  } finally {
    env.dispose();
  }
});
