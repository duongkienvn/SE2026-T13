import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const load = (file) => require(`../../dist/${file}.js`);
const { GoogleAuthService } = load('api/auth/google-auth.service');
const { PasswordSecurityService } = load('api/auth/password-security.service');
const { PasswordRecoveryMailer } = load('mail/password-recovery-mailer');
const { EmailChangeService } = load('api/auth/email-change.service');
const { AvatarService } = load('api/users/avatars/avatar.service');
const { AvatarStorage } = load('api/users/avatars/avatar-storage');
const { TaskEmailDispatcher } = load(
  'api/notifications/task-email-dispatcher.service',
);
const { NotificationService } = load('api/notifications/notification.service');
const { WorkspaceInvitationIssuanceService } = load(
  'api/workspaces/workspace-invitation-issuance.service',
);
const { toUserResponseDto } = load('api/users/dto/user-response.dto');
const code = (promise, expected) =>
  assert.rejects(promise, (error) => error.getResponse?.().code === expected);

export async function verifyDeletionAcceptance(ctx) {
  const {
    source,
    app,
    http,
    auth,
    password,
    profiles,
    factory,
    session,
    proof,
    close,
    remove,
    team,
    board,
    connect,
    eventually,
    pass,
    User,
  } = ctx;
  const body = { confirmation: 'DELETE', currentPassword: password };
  for (const [kind, method] of [
    ['password', 'password'],
    ['google', 'google'],
    ['dual', 'password'],
    ['dual', 'google'],
  ]) {
    const u = await factory(kind),
      old = await session(u);
    const response = await remove(u, {
      confirmation: 'DELETE',
      ...(method === 'google'
        ? { googleCredential: `google/${u.id}` }
        : { currentPassword: password }),
    });
    assert.equal(response.status, 204, JSON.stringify(response.body));
    assert.equal(response.text, '');
    const row = await source.getRepository(User).findOneByOrFail({ id: u.id });
    assert.ok(row.deletedAt);
    assert.equal(row.displayName, 'Deleted user');
    assert.equal(row.email, `deleted+${u.id}@users.invalid`);
    assert.equal(row.authVersion, 1);
    for (const field of [
      'passwordHash',
      'emailVerifiedAt',
      'avatarUrl',
      'avatarObjectKey',
    ])
      assert.equal(row[field], null);
    assert.equal((await remove(u, body, old.jwt)).status, 401);
    await code(auth.login({ email: u.email, password }), 'INVALID_CREDENTIALS');
    await code(auth.authenticateAccessToken(old.jwt), 'UNAUTHORIZED');
    await code(auth.issueLoginResponse(row), 'UNAUTHORIZED');
    assert.equal(await auth.currentSocketAuthVersion(u.id), null);
    assert.equal((await connect(old.jwt, true)).data.code, 'UNAUTHORIZED');
    assert.equal(
      (
        await source.query(
          "SELECT count(*)::int n FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL'",
          [u.id],
        )
      )[0].n,
      0,
    );
    await assert.rejects(
      source.query('UPDATE users SET deleted_at=NULL WHERE id=$1', [u.id]),
      (e) => e.code === '23514',
    );
    await assert.rejects(
      source.query("UPDATE users SET display_name='Restored' WHERE id=$1", [
        u.id,
      ]),
      (e) => e.code === '23514',
    );
    const serialized = toUserResponseDto(row);
    assert.equal(serialized.email, '');
    assert.equal(serialized.isDeleted, true);
    assert.ok(!JSON.stringify(serialized).includes(u.email));
    pass(
      `${kind}/${method}: 204 tombstone, old password/JWT/socket denial, no reactivation`,
    );
  }
  const unknown = await factory('dual');
  for (const input of [
    { confirmation: 'delete', currentPassword: password },
    { confirmation: 'DELETE ', currentPassword: password },
    { currentPassword: password },
    {
      confirmation: 'DELETE',
      currentPassword: password,
      googleCredential: `google/${unknown.id}`,
    },
  ]) {
    const u = await factory('dual'),
      response = await remove(u, input);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
  }
  for (const input of [
    { confirmation: 'DELETE' },
    { confirmation: 'DELETE', currentPassword: 'wrong' },
    { confirmation: 'DELETE', googleCredential: 'unknown' },
  ]) {
    const u = await factory('dual'),
      response = await remove(u, input);
    assert.ok([401, 403].includes(response.status));
    assert.ok(
      !(await source.getRepository(User).findOneByOrFail({ id: u.id }))
        .deletedAt,
    );
  }
  profiles.set('email-only-impersonation', {
    ...profiles.get(`google/${unknown.id}`),
    sub: 'different-sub',
  });
  assert.equal(
    (
      await remove(unknown, {
        confirmation: 'DELETE',
        googleCredential: 'email-only-impersonation',
      })
    ).status,
    403,
  );
  const unverified = await factory('password', false);
  assert.equal((await remove(unverified)).status, 401);
  const expired = await app
    .get(require('@nestjs/jwt').JwtService)
    .signAsync({ sub: unknown.id, authVersion: 0 }, { expiresIn: -1 });
  assert.equal((await remove(unknown, body, expired)).status, 401);
  pass(
    'literal/body validation, missing/wrong proof, unknown or email-only Google subject, unverified and expired sessions',
  );

  const rate = await factory();
  for (let n = 0; n < 5; n++)
    assert.equal(
      (await remove(rate, { confirmation: 'DELETE', currentPassword: 'wrong' }))
        .status,
      403,
    );
  assert.equal((await remove(rate)).status, 429);
  // A shared IP bucket must also limit different accounts, independently of their account buckets.
  for (let n = 0; n < 6; n++) {
    const u = await factory();
    const response = await http
      .delete('/api/users/me')
      .set('X-Forwarded-For', '198.51.100.1')
      .set('Authorization', `Bearer ${(await session(u)).jwt}`)
      .send({ confirmation: 'DELETE', currentPassword: 'wrong' });
    assert.equal(response.status, n === 5 ? 429 : 403);
  }
  pass('independent account and IP throttles include incorrect proofs');

  for (const archived of [false, true]) {
    const u = await factory(),
      other = await factory();
    const [personal] = await source.query(
      "SELECT id FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL'",
      [u.id],
    );
    await board(u, personal, other, archived);
    const before = await source.query('SELECT * FROM users WHERE id=$1', [
      u.id,
    ]);
    const response = await remove(u);
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ACCOUNT_DELETION_BLOCKED');
    assert.equal(
      response.body.blockers[0].type,
      'PERSONAL_WORKSPACE_HAS_BOARDS',
    );
    assert.deepEqual(
      await source.query('SELECT * FROM users WHERE id=$1', [u.id]),
      before,
    );
  }
  for (const archived of [false, true]) {
    const u = await factory(),
      other = await factory(),
      w = await team(u, other),
      b = await board(u, w, null, archived);
    const response = await remove(u);
    assert.equal(response.status, 409);
    assert.deepEqual(response.body.blockers, [
      {
        type: 'BOARD_REQUIRES_ANOTHER_OWNER',
        totalCount: 1,
        resources: [{ id: b.id, name: 'Shared Board' }],
      },
    ]);
  }
  const admin = await factory(),
    wAdmin = await team(admin);
  assert.deepEqual((await remove(admin)).body.blockers, [
    {
      type: 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
      totalCount: 1,
      resources: [{ id: wAdmin.id, name: 'Shared Team' }],
    },
  ]);
  const many = await factory(),
    [p] = await source.query(
      "SELECT id FROM workspaces WHERE type='PERSONAL' AND created_by_id=$1",
      [many.id],
    );
  for (let n = 0; n < 21; n++) await board(many, p);
  const limited = (await remove(many)).body.blockers;
  assert.equal(limited.length, 2);
  for (const block of limited) {
    assert.equal(block.totalCount, 21);
    assert.equal(block.resources.length, 20);
    assert.deepEqual(Object.keys(block).sort(), [
      'resources',
      'totalCount',
      'type',
    ]);
  }
  pass(
    'active/archived Personal Boards and sole OWNER/ADMIN blockers are atomic, structured and capped at 20',
  );

  const u = await factory('dual'),
    other = await factory(),
    w = await team(u, other),
    b = await board(u, w, other, true);
  const [personal] = await source.query(
    "SELECT id FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL'",
    [u.id],
  );
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'MEMBER')",
    [personal.id, other.id],
  );
  await source.query(
    "INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,expires_at,invited_by_id) VALUES($1,'personal-private@deletion.test','MEMBER',repeat('c',64),now()+interval '1 day',$2)",
    [personal.id, u.id],
  );
  await source.query(
    'INSERT INTO welcome_email_deliveries(user_id) VALUES($1)',
    [u.id],
  );
  await source.query(
    "INSERT INTO email_verification_tokens(user_id,token_hash,created_at,expires_at,window_started_at,attempts) VALUES($1,repeat('d',64),now(),now()+interval '1 day',now(),1)",
    [u.id],
  );
  const old = await session(u),
    otherSession = await session(other);
  const [column] = await source.query(
    "INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Keep column',1000) RETURNING id",
    [b.id],
  );
  const [card] = await source.query(
    "INSERT INTO cards(board_id,column_id,title,position,created_by_id) VALUES ($1,$2,'Keep shared text',1000,$3) RETURNING id",
    [b.id, column.id, u.id],
  );
  const [comment] = await source.query(
    "INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,'Retain this authored free text') RETURNING id",
    [card.id, u.id],
  );
  await source.query(
    "INSERT INTO activities(board_id,actor_id,action_type,entity_type,entity_id) VALUES ($1,$2,'CARD_CREATED','CARD',$3)",
    [b.id, u.id, card.id],
  );
  await source.query(
    "INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'WORKSPACE_CREATED')",
    [w.id, u.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id,assigned_by_id) VALUES ($1,$2,$2),($1,$3,$2)',
    [card.id, u.id, other.id],
  );
  const asset = randomUUID();
  await source.query(
    `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,
    pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,mime_type,byte_size,expires_at,verified_at)
    VALUES($1::uuid,$2,$3,$4,'FILE','ACTIVE','Retained file','file.txt','attachments/v1/pending/'||$1::uuid::text,'attachments/v1/active/'||$1::uuid::text,'text/plain',10,10,'text/plain',10,now()+interval '1 hour',now())`,
    [asset, card.id, b.id, u.id],
  );
  const attachmentsBefore = await source.query(
    'SELECT * FROM card_attachments WHERE id=$1',
    [asset],
  );
  for (const table of ['user_preferences', 'notification_preferences'])
    await source.query(`INSERT INTO ${table}(user_id) VALUES ($1)`, [u.id]);
  await source.query(
    'INSERT INTO board_user_states(user_id,board_id,is_starred) VALUES ($1,$2,true)',
    [u.id, b.id],
  );
  await source.query(
    "INSERT INTO user_notifications(recipient_user_id,actor_user_id,kind,dedupe_key,board_id,card_id) VALUES($1,$2,'CARD_ASSIGNED','CARD_ASSIGNED:card:cleanup',$3,$4),($2,$1,'CARD_ASSIGNED','CARD_ASSIGNED:card:history',$3,$4)",
    [u.id, other.id, b.id, card.id],
  );
  await source.query(
    "INSERT INTO task_notification_email_outbox(recipient_user_id,kind,occurrence_key,board_id,card_id) VALUES($1,'CARD_ASSIGNED','cleanup',$2,$3)",
    [u.id, b.id, card.id],
  );
  await source.query(
    'INSERT INTO comment_mentions(comment_id,user_id,start_offset,end_offset) VALUES($1,$2,0,5)',
    [comment.id, u.id],
  );
  const incoming = await source.query(
    "INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,expires_at,invited_by_id,send_state) VALUES($1,$2,'MEMBER',repeat('a',64),now()+interval '1 day',$3,'SENT'),($1,'outgoing@deletion.test','MEMBER',repeat('b',64),now()+interval '1 day',$4,'SENT') RETURNING id",
    [w.id, u.email, other.id, u.id],
  );
  const security = app.get(PasswordSecurityService);
  await security.send(u.email);
  const resetToken = new URL(
    app.get(PasswordRecoveryMailer).deliveries.at(-1).url,
  ).searchParams.get('token');
  const changes = app.get(EmailChangeService);
  await changes.request(await proof(u), 'pending-target@deletion.test');
  const [emailProof] = await source.query(
    'SELECT token_hash FROM pending_email_changes WHERE user_id=$1',
    [u.id],
  );
  assert.ok(emailProof);
  const elsewhere = await factory();
  await changes.request(await proof(elsewhere), u.email);
  const quotaBefore = (
    await source.query(
      'SELECT issuance_attempts FROM pending_email_changes WHERE user_id=$1',
      [elsewhere.id],
    )
  )[0];
  const id = randomUUID(),
    pending = `avatars/v1/pending/${u.id}/${id}`,
    active = `avatars/v1/active/${u.id}/${id}.webp`;
  await source.query(
    "INSERT INTO avatar_uploads(id,user_id,pending_key,active_key,content_type,file_size,base_revision,state,created_at,expires_at,next_cleanup_at) VALUES($1,$2,$3,$4,'image/webp',1,0,'completed',now()-interval '1 day',now()-interval '1 hour',now())",
    [id, u.id, pending, active],
  );
  await source.query('UPDATE users SET avatar_object_key=$2 WHERE id=$1', [
    u.id,
    active,
  ]);
  const storage = app.get(AvatarStorage);
  await storage.put(active, Buffer.from('x'), 'image/webp');
  const socket = await connect(old.jwt),
    observer = await connect(otherSession.jwt);
  assert.equal(
    (await socket.timeout(5000).emitWithAck('board:join', { boardId: b.id }))
      .success,
    true,
  );
  assert.equal(
    (await observer.timeout(5000).emitWithAck('board:join', { boardId: b.id }))
      .success,
    true,
  );
  await close(u);
  await eventually(() => !socket.connected, 'revoke established socket');
  assert.equal(observer.connected, true);
  assert.deepEqual(
    await source.query('SELECT * FROM card_attachments WHERE id=$1', [asset]),
    attachmentsBefore,
  );
  for (const [table, field] of [
    ['boards', 'created_by_id'],
    ['cards', 'created_by_id'],
    ['comments', 'author_id'],
    ['activities', 'actor_id'],
  ])
    assert.ok(
      (
        await source.query(
          `SELECT count(*)::int n FROM ${table} WHERE ${field}=$1`,
          [u.id],
        )
      )[0].n > 0,
    );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM card_assignees WHERE card_id=$1 AND user_id=$2',
        [card.id, other.id],
      )
    )[0].n,
    1,
  );
  for (const table of [
    'google_identities',
    'password_reset_tokens',
    'email_verification_tokens',
    'pending_email_changes',
    'welcome_email_deliveries',
    'user_preferences',
    'notification_preferences',
    'board_user_states',
    'card_assignees',
    'board_members',
    'workspace_members',
  ])
    assert.equal(
      (
        await source.query(
          `SELECT count(*)::int n FROM ${table} WHERE user_id=$1`,
          [u.id],
        )
      )[0].n,
      0,
      table,
    );
  for (const table of ['user_notifications', 'task_notification_email_outbox'])
    assert.equal(
      (
        await source.query(
          `SELECT count(*)::int n FROM ${table} WHERE recipient_user_id=$1`,
          [u.id],
        )
      )[0].n,
      0,
      table,
    );
  for (const invitation of await source.query(
    'SELECT * FROM workspace_invitations WHERE id=ANY($1::uuid[])',
    [incoming.map((i) => i.id)],
  )) {
    assert.ok(invitation.revoked_at);
    assert.ok(invitation.erased_recipient_hash);
    assert.ok(!JSON.stringify(invitation).includes(u.email));
  }
  await assert.rejects(
    app
      .get(WorkspaceInvitationIssuanceService)
      .create(other.id, w.id, { email: u.email }),
    (e) => e.getStatus() === 429,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM workspace_members WHERE workspace_id=$1',
        [personal.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM deleted_workspace_invitation_quota WHERE actor_id=$1',
        [u.id],
      )
    )[0].n,
    1,
  );
  const retainedProof = (
    await source.query('SELECT * FROM pending_email_changes WHERE user_id=$1', [
      elsewhere.id,
    ])
  )[0];
  assert.ok(retainedProof.consumed_at);
  assert.deepEqual(
    retainedProof.issuance_attempts,
    quotaBefore.issuance_attempts,
  );
  assert.ok(!JSON.stringify(retainedProof).includes(u.email));
  const comments = await http
    .get(`/api/boards/${b.id}/cards/${card.id}/comments`)
    .set('Authorization', `Bearer ${otherSession.jwt}`);
  assert.equal(comments.status, 200);
  assert.deepEqual(comments.body.data[0].author, {
    displayName: 'Deleted user',
    isDeleted: true,
  });
  const activities = await http
    .get(`/api/boards/${b.id}/activities`)
    .set('Authorization', `Bearer ${otherSession.jwt}`);
  assert.deepEqual(activities.body.data[0].actor, {
    displayName: 'Deleted user',
    isDeleted: true,
  });
  const wa = await http
    .get(`/api/workspaces/${w.id}/activity`)
    .set('Authorization', `Bearer ${otherSession.jwt}`);
  assert.equal(wa.status, 200, JSON.stringify(wa.body));
  assert.equal(wa.body.data[0].actor.displayName, 'Deleted user');
  assert.equal(wa.body.data[0].actor.isDeleted, true);
  const notes = await http
    .get('/api/notifications')
    .set('Authorization', `Bearer ${otherSession.jwt}`);
  assert.equal(notes.status, 200);
  assert.equal(
    notes.body.data.find((n) => n.actor?.id === u.id)?.actor.isDeleted,
    true,
  );
  await code(
    security.reset(resetToken, 'DifferentPass2!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  await source.transaction(async (manager) =>
    assert.equal(
      (
        await app.get(NotificationService).record(manager, {
          kind: 'CARD_ASSIGNED',
          recipientUserId: u.id,
          actorUserId: other.id,
          cardId: card.id,
          occurrenceKey: 'after-deletion',
        })
      ).status,
      'recipient-missing',
    ),
  );
  await app.get(TaskEmailDispatcher).drain(20);
  const avatars = app.get(AvatarService),
    originalDelete = storage.delete.bind(storage);
  storage.delete = async () => {
    throw new Error('synthetic S3 outage');
  };
  await avatars.cleanup();
  assert.ok(await source.getRepository(User).findOneBy({ id: u.id }));
  assert.equal(
    (
      await source.query('SELECT state FROM avatar_uploads WHERE id=$1', [id])
    )[0].state,
    'rejected',
  );
  storage.delete = originalDelete;
  await avatars.cleanup(new Date(Date.now() + 6 * 60000));
  await assert.rejects(storage.get(active, 100));
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM card_attachments WHERE id=$1',
        [asset],
      )
    )[0].n,
    1,
  );
  pass(
    'shared history/files/other memberships survive; credentials/private state/invitations scrubbed; tombstone API attribution; avatar outage/retry isolation',
  );

  const registered = await auth.register({
    email: u.email,
    password,
    displayName: 'New identity',
  });
  assert.notEqual(registered.id, u.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM board_members WHERE user_id=$1',
        [registered.id],
      )
    )[0].n,
    0,
  );
  const g = await factory('google'),
    oldG = await session(g);
  await close(g, 'google');
  const newGoogle = await app.get(GoogleAuthService).signIn(`google/${g.id}`);
  assert.notEqual(newGoogle.user.id, g.id);
  await code(auth.authenticateAccessToken(oldG.jwt), 'UNAUTHORIZED');
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM workspace_members WHERE user_id=$1',
        [newGoogle.user.id],
      )
    )[0].n,
    1,
  );
  pass(
    'original email and former Google subject register genuinely new UUIDs and Personal Workspaces with no historical grants',
  );
  ctx.history = { u, other, w, b, card };
}
