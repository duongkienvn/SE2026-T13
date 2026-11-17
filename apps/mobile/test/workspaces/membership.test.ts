import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceRole } from '@kanban/shared';
import {
  createWorkspaceMembershipApi,
  normalizeRosterFilter,
} from '../../src/features/workspaces/membership/api.ts';
import {
  decodeGuest,
  decodeMember,
  decodePolicies,
} from '../../src/features/workspaces/membership/decoder.ts';
import { parseResourceId } from '../../src/navigation/routes.ts';
import { integration, json } from '../realtime/integration-support.ts';
import { uuid } from './fixtures.ts';

const id = parseResourceId(uuid(111))!;
const userId = parseResourceId(uuid(222))!;
const member = {
  userId,
  displayName: 'Member',
  avatarUrl: null,
  avatarRevision: 0,
  role: 'MEMBER',
  joinedAt: '2026-01-01T00:00:00.000Z',
};
const guest = {
  user: {
    id: userId,
    displayName: 'Guest',
    avatarUrl: null,
    email: 'hidden@example.test',
  },
  boards: [
    { boardId: uuid(333), name: 'Accessible', role: 'OWNER', isArchived: true },
  ],
  visibleBoardCount: 1,
};
const policies = {
  boardCreationAdminOnly: false,
  boardInvitesEnabled: true,
  boardMembershipChangesEnabled: true,
  boardVisibilityChangesEnabled: true,
  canManagePolicies: false,
  canCreateBoards: true,
};
const signal = new AbortController().signal;
const ok = (data: unknown, meta?: object) =>
  json({ success: true, statusCode: 200, message: 'OK', data, meta });

test('Workspace collaboration decoders allowlist member, Board association and policy fields', () => {
  assert.deepEqual(
    decodeMember({ ...member, email: 'hidden@example.test' }),
    member,
  );
  assert.throws(() => decodeMember({ ...member, role: 'OWNER' }));
  assert.throws(() => decodeMember({ ...member, joinedAt: 'invalid' }));
  const decoded = decodeGuest(guest);
  assert.equal(decoded.visibleBoardCount, 1);
  assert.equal(decoded.boards[0]?.role, 'OWNER');
  assert.equal('email' in decoded.user, false);
  assert.throws(() => decodeGuest({ ...guest, visibleBoardCount: 2 }));
  assert.throws(() =>
    decodeGuest({
      ...guest,
      boards: [...guest.boards, ...guest.boards],
      visibleBoardCount: 2,
    }),
  );
  assert.deepEqual(decodePolicies({ ...policies, unrelated: true }), policies);
  assert.throws(() =>
    decodePolicies({ ...policies, boardInvitesEnabled: 'false' }),
  );
  assert.throws(() => normalizeRosterFilter({ search: 'x'.repeat(121) }));
});

test('Workspace collaboration adapter uses scoped paths, paginated search and exact mutation bodies', async () => {
  const env = await integration();
  const api = createWorkspaceMembershipApi(env.data.api, env.identity, id);
  const root = `/api/workspaces/${id}`;
  const meta = { page: 251, limit: 1, total: 251, totalPages: 251 };
  const calls = [
    ['GET', `${root}/members`, undefined, ok([member], meta)],
    [
      'GET',
      `${root}/guests`,
      undefined,
      ok([guest], { ...meta, page: 1, total: 1, totalPages: 1 }),
    ],
    [
      'PATCH',
      `${root}/members/${userId}`,
      { role: 'ADMIN' },
      ok({ ...member, role: 'ADMIN' }),
    ],
    [
      'DELETE',
      `${root}/members/${userId}`,
      undefined,
      new Response(null, { status: 204 }),
    ],
    ['GET', `${root}/policies`, undefined, ok(policies)],
    [
      'PATCH',
      `${root}/policies`,
      { boardInvitesEnabled: false },
      ok({ ...policies, boardInvitesEnabled: false }),
    ],
  ] as const;
  let count = 0;
  env.respond((url, options) => {
    const request = new URL(url);
    const [method, path, body, response] = calls[count++]!;
    assert.equal(request.pathname, path);
    assert.equal(options.method, method);
    assert.deepEqual(
      options.body ? JSON.parse(String(options.body)) : undefined,
      body,
    );
    if (count <= 2) {
      assert.equal(request.searchParams.get('search'), 'Name');
      assert.equal(request.searchParams.get('limit'), '1');
      assert.equal(
        request.searchParams.get('role'),
        count === 1 ? 'MEMBER' : null,
      );
    }
    return Promise.resolve(response);
  });
  try {
    assert.equal(
      (
        await api.members(
          251,
          { search: ' Name ', role: WorkspaceRole.MEMBER },
          signal,
          1,
        )
      ).meta.total,
      251,
    );
    assert.equal(
      (await api.guests(1, ' Name ', signal, 1)).data[0]?.visibleBoardCount,
      1,
    );
    await api.changeRole(userId, WorkspaceRole.ADMIN, signal);
    assert.equal(await api.remove(userId, signal), undefined);
    assert.deepEqual(await api.policies(signal), policies);
    assert.equal(
      (await api.updatePolicies({ boardInvitesEnabled: false }, signal))
        .boardInvitesEnabled,
      false,
    );
    assert.throws(() => api.updatePolicies({}, signal));
    await assert.rejects(api.members(0, {}, signal));
    await assert.rejects(api.guests(1, undefined, signal, 101));
    assert.equal(count, calls.length);
  } finally {
    env.dispose();
  }
});
