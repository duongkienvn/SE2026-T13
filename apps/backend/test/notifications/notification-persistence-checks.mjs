import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyNotificationPersistence(ctx) {
  const {
    source,
    actors,
    user,
    send,
    list,
    count,
    workspace,
    board,
    card,
    record,
    producer,
    preferences,
    pass,
  } = ctx;
  const ws = await workspace('Persistence');
  ctx.persistenceWorkspace = ws;
  const defaults = (
    await send('pager', 'get', '/api/users/me/notification-preferences').expect(
      200,
    )
  ).body.data;
  assert.deepEqual(defaults, {
    inApp: {
      cardAssigned: true,
      commentMentioned: true,
      workspaceInvited: true,
      boardInvited: true,
      membershipChanged: true,
      dueReminder: true,
    },
    email: { cardAssigned: false, commentMentioned: false, dueReminder: false },
  });
  assert.equal(await source.getRepository('NotificationPreference').count(), 0);
  await assert.rejects(
    producer.record(source.manager, {
      recipientUserId: actors.pager,
      kind: 'MEMBERSHIP_CHANGED',
      occurrenceKey: 'outside',
      workspaceId: ws,
    }),
    /Invalid notification/,
  );
  const occurrenceKey = randomUUID();
  const first = await record(
    'pager',
    'MEMBERSHIP_CHANGED',
    { workspaceId: ws },
    occurrenceKey,
  );
  assert.equal(first.status, 'created');
  assert.equal(
    (
      await record(
        'pager',
        'MEMBERSHIP_CHANGED',
        { workspaceId: ws },
        occurrenceKey,
      )
    ).status,
    'duplicate',
  );
  const row = await source
    .getRepository('UserNotification')
    .findOneByOrFail({ id: first.notificationId });
  assert.equal(row.dedupeKey, `MEMBERSHIP_CHANGED:workspace:${occurrenceKey}`);
  assert.equal(await count('pager'), 1);
  const rollbackKey = randomUUID();
  await assert.rejects(
    source.transaction(async (manager) => {
      await producer.record(manager, {
        recipientUserId: actors.pager,
        kind: 'MEMBERSHIP_CHANGED',
        occurrenceKey: rollbackKey,
        workspaceId: ws,
      });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(
    await source
      .getRepository('UserNotification')
      .countBy({ dedupeKey: `MEMBERSHIP_CHANGED:workspace:${rollbackKey}` }),
    0,
  );
  const retry = await record(
    'pager',
    'MEMBERSHIP_CHANGED',
    { workspaceId: ws },
    rollbackKey,
  );
  assert.equal(retry.status, 'created');
  const another = await record('pager', 'MEMBERSHIP_CHANGED', {
    workspaceId: ws,
  });
  assert.notEqual(another.notificationId, first.notificationId);
  await assert.rejects(
    source.transaction((manager) =>
      producer.record(manager, {
        recipientUserId: actors.pager,
        kind: 'BAD',
        occurrenceKey: 'invalid',
        workspaceId: ws,
      }),
    ),
    /Invalid notification/,
  );
  await assert.rejects(
    source.transaction((manager) =>
      producer.record(manager, {
        recipientUserId: actors.pager,
        kind: 'MEMBERSHIP_CHANGED',
        occurrenceKey: 'https://private.test/title',
        workspaceId: ws,
      }),
    ),
    /Invalid notification/,
  );
  const codes = async (sql, parameters, code) =>
    assert.rejects(
      source.query(sql, parameters),
      (error) => (error.code ?? error.driverError?.code) === code,
    );
  await codes(
    'INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key) VALUES ($1,$2,$3)',
    [actors.pager, row.kind, row.dedupeKey],
    '23505',
  );
  await codes(
    "INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key) VALUES ($1,'BAD','BAD:workspace:test')",
    [actors.pager],
    '23514',
  );
  await codes(
    "INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key) VALUES ($1,'DUE_REMINDER','contains spaces')",
    [actors.pager],
    '23514',
  );
  await codes(
    "UPDATE user_notifications SET read_at='infinity' WHERE id=$1",
    [row.id],
    '23514',
  );
  await codes(
    "UPDATE user_notifications SET read_at=created_at-interval '1 second' WHERE id=$1",
    [row.id],
    '23514',
  );
  await codes(
    "INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key) VALUES ($1,'MEMBERSHIP_CHANGED','MEMBERSHIP_CHANGED:workspace:foreign')",
    [randomUUID()],
    '23503',
  );
  const indexes = await source.query(
    "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='user_notifications'",
  );
  assert.ok(
    indexes.some(
      (index) =>
        index.indexname === 'IDX_user_notifications_inbox' &&
        /created_at DESC, id DESC/.test(index.indexdef),
    ),
  );
  assert.ok(
    indexes.some(
      (index) =>
        index.indexname === 'IDX_user_notifications_unread' &&
        /WHERE \(read_at IS NULL\)/.test(index.indexdef),
    ),
  );
  const fk = await source.query(
    "SELECT conname,confdeltype FROM pg_constraint WHERE conrelid='user_notifications'::regclass AND contype='f'",
  );
  assert.equal(
    fk.find((row) => row.conname === 'FK_user_notifications_recipient')
      .confdeltype,
    'a',
  );
  for (const name of ['actor', 'workspace', 'board', 'card'])
    assert.equal(
      fk.find((row) => row.conname === `FK_user_notifications_${name}`)
        .confdeltype,
      'n',
    );
  pass(
    'caller-owned atomic persistence, rollback/retry, dedupe, context validation, CHECK/FK/unique constraints and indexed inbox/unread ordering',
  );

  const security = await source.query(
    'SELECT id,auth_version,email_verified_at FROM users ORDER BY id',
  );
  await send('pager', 'patch', '/api/users/me/notification-preferences')
    .send({ inApp: { membershipChanged: false }, email: { dueReminder: true } })
    .expect(200);
  assert.equal(
    (await record('pager', 'MEMBERSHIP_CHANGED', { workspaceId: ws })).status,
    'disabled',
  );
  assert.equal(
    await source
      .getRepository('UserNotification')
      .countBy({ recipientUserId: actors.pager }),
    3,
  );
  assert.equal(
    (
      await record(
        'pager',
        'MEMBERSHIP_CHANGED',
        { workspaceId: ws },
        occurrenceKey,
      )
    ).status,
    'duplicate',
  );
  const saved = await preferences.get(actors.pager);
  assert.equal(saved.inApp.cardAssigned, true);
  assert.equal(saved.inApp.membershipChanged, false);
  assert.equal(saved.email.dueReminder, true);
  assert.deepEqual(
    await source.query(
      'SELECT id,auth_version,email_verified_at FROM users ORDER BY id',
    ),
    security,
  );
  const isolated = await user('all-kind-preferences');
  const empty = await list('all-kind-preferences');
  assert.deepEqual(empty.data, []);
  assert.deepEqual(empty.meta, { page: 1, limit: 20, total: 0, totalPages: 0 });
  assert.equal(await count('all-kind-preferences'), 0);
  await send(
    'all-kind-preferences',
    'post',
    '/api/notifications/read-all',
  ).expect(200, {
    success: true,
    statusCode: 200,
    message: 'OK',
    data: { updatedCount: 0 },
  });
  await preferences.update(isolated, {
    inApp: Object.fromEntries(
      Object.keys(defaults.inApp).map((key) => [key, false]),
    ),
    email: Object.fromEntries(
      Object.keys(defaults.email).map((key) => [key, true]),
    ),
  });
  const preferenceBoard = await board(ws, 'Preference coverage');
  const preferenceCard = await card(preferenceBoard, 'Preference coverage');
  for (const [kind, context] of [
    ['CARD_ASSIGNED', { cardId: preferenceCard }],
    ['COMMENT_MENTIONED', { cardId: preferenceCard }],
    ['DUE_REMINDER', { cardId: preferenceCard }],
    ['WORKSPACE_INVITED', { workspaceId: ws }],
    ['BOARD_INVITED', { boardId: preferenceBoard.id }],
    ['MEMBERSHIP_CHANGED', { workspaceId: ws }],
  ]) {
    assert.equal(
      (await record('all-kind-preferences', kind, context)).status,
      'disabled',
    );
  }
  assert.equal(
    await source
      .getRepository('UserNotification')
      .countBy({ recipientUserId: isolated }),
    0,
  );
  const isolatedResponse = await send(
    'all-kind-preferences',
    'get',
    '/api/users/me/notification-preferences',
  ).expect(200);
  assert.deepEqual(isolatedResponse.body.data.email, {
    cardAssigned: true,
    commentMentioned: true,
    dueReminder: true,
  });
  for (const body of [
    {},
    { inApp: {} },
    { inApp: null },
    { email: { cardAssigned: 'true' } },
    { email: { workspaceInvited: true } },
    { email: { security: false } },
    { inApp: { cardAssigned: null } },
  ])
    await send('pager', 'patch', '/api/users/me/notification-preferences')
      .send(body)
      .expect(400);
  await preferences.update(actors.pager, {
    inApp: { membershipChanged: true },
  });
  for (let i = 0; i < 12; i++)
    await record(
      'pager',
      'MEMBERSHIP_CHANGED',
      { workspaceId: ws },
      `page-${i}`,
    );
  await source.query(
    "UPDATE user_notifications SET created_at='2026-01-01T00:00:00Z' WHERE recipient_user_id=$1",
    [actors.pager],
  );
  const expected = (
    await source.query(
      'SELECT id FROM user_notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC,id DESC',
      [actors.pager],
    )
  ).map((row) => row.id);
  const actual = [];
  for (let page = 1; page <= 3; page++) {
    const response = await list('pager', { page: String(page), limit: '5' });
    assert.equal(response.meta.total, 15);
    assert.equal(response.meta.totalPages, 3);
    actual.push(...response.data.map((row) => row.id));
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 15);
  assert.deepEqual((await list('pager', { page: '1000000' })).data, []);
  const unavailable = (await list('pager')).data[0];
  assert.equal(unavailable.isUnavailable, true);
  assert.equal(unavailable.summary, 'This notification is no longer available');
  for (const key of ['actor', 'context', 'target'])
    assert.equal(unavailable[key], null);
  assert.equal(await count('pager'), 15, 'unavailable rows are still unread');
  for (const actor of ['other', 'outsider']) {
    assert.equal((await list(actor)).meta.total, 0);
    await send(
      actor,
      'patch',
      `/api/notifications/${first.notificationId}/read`,
    ).expect(404);
  }
  await send(
    'pager',
    'patch',
    `/api/notifications/${randomUUID()}/read`,
  ).expect(404);
  const read = (
    await send(
      'pager',
      'patch',
      `/api/notifications/${first.notificationId}/read`,
    ).expect(200)
  ).body.data;
  const timestamp = (
    await source.query(
      'SELECT read_at::text AS value FROM user_notifications WHERE id=$1',
      [first.notificationId],
    )
  )[0].value;
  assert.equal(
    (
      await send(
        'pager',
        'patch',
        `/api/notifications/${first.notificationId}/read`,
      ).expect(200)
    ).body.data.readAt,
    read.readAt,
  );
  assert.equal(
    (
      await source.query(
        'SELECT read_at::text AS value FROM user_notifications WHERE id=$1',
        [first.notificationId],
      )
    )[0].value,
    timestamp,
  );
  assert.equal((await list('pager', { filter: 'unread' })).meta.total, 14);
  assert.equal(await count('pager'), 14);
  assert.equal(
    (await send('pager', 'post', '/api/notifications/read-all').expect(200))
      .body.data.updatedCount,
    14,
  );
  assert.equal(
    (await send('pager', 'post', '/api/notifications/read-all').expect(200))
      .body.data.updatedCount,
    0,
  );
  assert.equal(await count('pager'), 0);
  assert.equal((await list('pager')).meta.total, 15);
  pass(
    'read-only defaults, independent channels, mandatory-auth state preservation, strict partial updates, tied pagination, unavailable unread history and idempotent read/read-all',
  );

  const retained = await user('retained-recipient');
  await record('retained-recipient', 'MEMBERSHIP_CHANGED', { workspaceId: ws });
  await codes('DELETE FROM users WHERE id=$1', [retained], '23503');
  await source.query(
    'DELETE FROM user_notifications WHERE recipient_user_id=$1',
    [retained],
  );
  await source.query('DELETE FROM users WHERE id=$1', [retained]);
  const prefUser = await user('preference-owner');
  await preferences.update(prefUser, { email: { dueReminder: true } });
  await codes('DELETE FROM users WHERE id=$1', [prefUser], '23503');
  await source.query('DELETE FROM notification_preferences WHERE user_id=$1', [
    prefUser,
  ]);
  await source.query('DELETE FROM users WHERE id=$1', [prefUser]);
  const actor = await user('deleted-actor'),
    actorNote = await record(
      'owner',
      'MEMBERSHIP_CHANGED',
      { workspaceId: ws },
      randomUUID(),
      'deleted-actor',
    );
  await source.query('DELETE FROM users WHERE id=$1', [actor]);
  assert.equal(
    (
      await source
        .getRepository('UserNotification')
        .findOneByOrFail({ id: actorNote.notificationId })
    ).actorUserId,
    null,
  );
  pass(
    'explicit account cleanup policy, no recipient or preference orphans, actor nullification and history retention',
  );
}
