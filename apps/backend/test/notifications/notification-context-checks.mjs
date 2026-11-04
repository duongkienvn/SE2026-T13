import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export async function verifyNotificationContexts(ctx) {
  const {
    source,
    actors,
    send,
    list,
    count,
    workspace,
    board,
    card,
    record,
    resolvers,
    pass,
  } = ctx;
  const first = await workspace('Confidential Workspace A'),
    second = await workspace('Confidential Workspace B');
  for (const actor of ['member', 'viewer', 'admin'])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)`,
      [first, actors[actor], actor === 'admin' ? 'ADMIN' : 'MEMBER'],
    );
  const privateBoard = await board(first, 'Private Board'),
    visibleBoard = await board(first, 'Visible Board', 'WORKSPACE_VISIBLE'),
    foreignBoard = await board(second, 'Foreign Board');
  const secret = await card(privateBoard, 'Confidential Card'),
    visible = await card(visibleBoard, 'Visible Card'),
    foreign = await card(foreignBoard, 'Foreign Card');
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [privateBoard.id, actors[actor]],
    );
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [foreignBoard.id, actors.member],
  );
  const visibleComment = (
    await send(
      'owner',
      'post',
      `/api/boards/${visibleBoard.id}/cards/${visible}/comments`,
    )
      .send({
        content: '@owner',
        mentions: [{ userId: actors.owner, start: 0, end: 6 }],
      })
      .expect(201)
  ).body.data;
  assert.equal(visibleComment.mentions.length, 1);
  const viewerComments = (
    await send(
      'viewer',
      'get',
      `/api/boards/${visibleBoard.id}/cards/${visible}/comments`,
    ).expect(200)
  ).body.data;
  assert.deepEqual(viewerComments[0].mentions, []);
  assert.equal(viewerComments[0].content, '@owner');
  const notes = {};
  for (const actor of [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
  ]) {
    const result = await record(actor, 'CARD_ASSIGNED', {
      cardId: secret,
      boardId: privateBoard.id,
      workspaceId: first,
    });
    notes[actor] = result.notificationId;
    const row = (await list(actor)).data.find(
      (row) => row.id === result.notificationId,
    );
    const available = ['owner', 'member', 'guest'].includes(actor);
    assert.equal(row.isUnavailable, !available, actor);
    if (available) {
      assert.equal(row.summary, 'You were assigned to "Confidential Card"');
      assert.equal(row.actor.id, actors.owner);
      assert.deepEqual(row.context, {
        workspaceId: first,
        boardId: privateBoard.id,
        cardId: secret,
      });
      assert.equal(
        row.target.path,
        `/boards/${privateBoard.id}/cards/${secret}`,
      );
      await send(actor, 'get', `/api${row.target.path}`).expect(200);
    } else {
      assert.equal(row.summary, 'This notification is no longer available');
      assert.equal(row.actor, null);
      assert.equal(row.context, null);
      assert.equal(row.target, null);
      for (const value of [
        secret,
        privateBoard.id,
        first,
        actors.owner,
        'Confidential',
      ])
        assert.ok(!JSON.stringify(row).includes(value));
    }
    assert.equal(
      await count(actor),
      (await list(actor, { filter: 'unread' })).meta.total,
    );
  }
  for (const actor of ['viewer', 'admin']) {
    const result = await record(actor, 'COMMENT_MENTIONED', {
      cardId: visible,
    });
    const row = (await list(actor)).data.find(
      (row) => row.id === result.notificationId,
    );
    assert.equal(row.isUnavailable, false);
    assert.equal(
      row.target.path,
      `/boards/${visibleBoard.id}/cards/${visible}`,
    );
    await send(
      actor,
      'patch',
      `/api/boards/${visibleBoard.id}/cards/${visible}`,
    )
      .send({ title: 'Forbidden' })
      .expect(404);
  }
  const foreignResult = await record('member', 'DUE_REMINDER', {
    cardId: foreign,
  });
  const foreignRow = (await list('member')).data.find(
    (row) => row.id === foreignResult.notificationId,
  );
  assert.equal(foreignRow.isUnavailable, false);
  assert.ok(!foreignRow.summary.includes('Confidential Workspace B'));
  await send('member', 'get', `/api/workspaces/${second}`).expect(404);
  const raw = await source.query(
    'SELECT to_jsonb(n) AS value FROM user_notifications n WHERE id=$1',
    [notes.owner],
  );
  assert.ok(!JSON.stringify(raw).includes('Confidential'));
  await source.query(
    "UPDATE cards SET title='Current renamed Card' WHERE id=$1",
    [secret],
  );
  assert.equal(
    (await list('owner')).data.find((row) => row.id === notes.owner).summary,
    'You were assigned to "Current renamed Card"',
  );
  // Actor identities are scoped to the notification, not any other readable row.
  const actorYes = await record(
    'owner',
    'MEMBERSHIP_CHANGED',
    { boardId: privateBoard.id },
    randomUUID(),
    'member',
  );
  const actorNo = await record(
    'owner',
    'MEMBERSHIP_CHANGED',
    { boardId: visibleBoard.id },
    randomUUID(),
    'member',
  );
  const actorPage = (await list('owner')).data;
  assert.equal(
    actorPage.find((row) => row.id === actorYes.notificationId).actor.id,
    actors.member,
  );
  assert.equal(
    actorPage.find((row) => row.id === actorNo.notificationId).actor,
    null,
  );
  pass(
    'PRIVATE/WORKSPACE_VISIBLE/Guest/ADMIN/outsider matrix, safe unavailable stubs, live names, per-context actor privacy and cross-Workspace isolation',
  );

  const before = await count('guest');
  await source.query(
    'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
    [privateBoard.id],
  );
  await source.query(
    'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
    [secret],
  );
  assert.equal(
    (await list('guest')).data.find((row) => row.id === notes.guest)
      .isUnavailable,
    false,
    'archive retains an existing read grant',
  );
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [privateBoard.id, actors.guest],
  );
  const revoked = (await list('guest')).data.find(
    (row) => row.id === notes.guest,
  );
  assert.equal(revoked.isUnavailable, true);
  assert.equal(revoked.context, null);
  assert.equal(await count('guest'), before);
  await source.query(
    'UPDATE boards SET is_archived=false,archived_at=NULL WHERE id=$1',
    [privateBoard.id],
  );
  await source.query(
    'UPDATE cards SET is_archived=false,archived_at=NULL WHERE id=$1',
    [secret],
  );
  await send('owner', 'patch', `/api/boards/${visibleBoard.id}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(200);
  assert.ok((await list('viewer')).data.every((row) => row.isUnavailable));
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [first, actors.member],
  );
  assert.equal(
    (await list('member')).data.find((row) => row.id === notes.member)
      .isUnavailable,
    false,
    'explicit Guest grant survives Workspace exit',
  );
  const deleteBoard = await board(first, 'Deleted Board'),
    deleteCard = await card(deleteBoard, 'Deleted Card');
  const cardOccurrence = randomUUID();
  const cardNote = await record(
      'owner',
      'CARD_ASSIGNED',
      { cardId: deleteCard },
      cardOccurrence,
    ),
    boardNote = await record('owner', 'MEMBERSHIP_CHANGED', {
      boardId: deleteBoard.id,
    });
  const priorCount = await count('owner');
  await source.query('DELETE FROM boards WHERE id=$1', [deleteBoard.id]);
  assert.equal(await count('owner'), priorCount);
  for (const id of [cardNote.notificationId, boardNote.notificationId]) {
    const historical = (await list('owner')).data.find((row) => row.id === id);
    assert.equal(historical.isUnavailable, true);
    assert.equal(historical.context, null);
    assert.equal(historical.target, null);
    assert.equal(historical.actor, null);
    const [stored] = await source.query(
      'SELECT board_id,card_id,workspace_id FROM user_notifications WHERE id=$1',
      [id],
    );
    assert.deepEqual(stored, {
      board_id: null,
      card_id: null,
      workspace_id: null,
    });
  }
  assert.equal(
    (
      await record(
        'owner',
        'CARD_ASSIGNED',
        { cardId: deleteCard },
        cardOccurrence,
      )
    ).status,
    'duplicate',
    'a replay after deletion remains a no-op',
  );
  await assert.rejects(
    record('owner', 'CARD_ASSIGNED', { cardId: deleteCard }, 'new-gone'),
    /Invalid notification/,
  );
  await assert.rejects(
    record('owner', 'CARD_ASSIGNED', {
      cardId: secret,
      boardId: foreignBoard.id,
    }),
    /Invalid notification/,
  );
  await assert.rejects(
    record('owner', 'CARD_ASSIGNED', { cardId: secret, workspaceId: second }),
    /Invalid notification/,
  );
  const deletedWorkspace = await workspace('Deleted Workspace'),
    workspaceNote = await record('owner', 'MEMBERSHIP_CHANGED', {
      workspaceId: deletedWorkspace,
    });
  await source.query('DELETE FROM workspace_members WHERE workspace_id=$1', [
    deletedWorkspace,
  ]);
  await source.query('DELETE FROM workspaces WHERE id=$1', [deletedWorkspace]);
  const deletedWorkspaceRow = (await list('owner')).data.find(
    (row) => row.id === workspaceNote.notificationId,
  );
  assert.equal(deletedWorkspaceRow.isUnavailable, true);
  assert.equal(deletedWorkspaceRow.context, null);
  const total = await source.getRepository('UserNotification').count();
  await send(
    'owner',
    'post',
    `/api/boards/${privateBoard.id}/cards/${secret}/assignees`,
  )
    .send({ userId: actors.member })
    .expect(201);
  await send(
    'owner',
    'post',
    `/api/boards/${privateBoard.id}/cards/${secret}/comments`,
  )
    .send({ content: '@member plain existing comment' })
    .expect(201);
  const mentioned = (
    await send(
      'owner',
      'post',
      `/api/boards/${privateBoard.id}/cards/${secret}/comments`,
    )
      .send({
        content: '😀 @member',
        mentions: [{ userId: actors.member, start: 3, end: 10 }],
      })
      .expect(201)
  ).body.data;
  assert.deepEqual(mentioned.mentions, [
    { userId: actors.member, start: 3, end: 10 },
  ]);
  for (const invalid of [
    [{ userId: actors.member, start: 1, end: 10 }],
    [{ userId: actors.member, start: 3, end: 11 }],
    [{ userId: actors.outsider, start: 3, end: 10 }],
    [
      { userId: actors.member, start: 3, end: 10 },
      { userId: actors.member, start: 3, end: 10 },
    ],
    [{ userId: 'not-a-uuid', start: 3, end: 10 }],
  ])
    await send(
      'owner',
      'post',
      `/api/boards/${privateBoard.id}/cards/${secret}/comments`,
    )
      .send({ content: '😀 @member', mentions: invalid })
      .expect(400);
  const commentPath = `/api/boards/${privateBoard.id}/cards/${secret}/comments/${mentioned.id}`;
  await send('owner', 'patch', commentPath)
    .send({ content: 'plain' })
    .expect(200);
  await send('owner', 'patch', commentPath)
    .send({
      content: '😀 @member',
      mentions: [{ userId: actors.member, start: 3, end: 10 }],
    })
    .expect(200);
  await send('owner', 'post', '/api/notifications')
    .send({ kind: 'CARD_ASSIGNED', recipientUserId: actors.outsider })
    .expect(404);
  assert.equal(
    await source.getRepository('UserNotification').count(),
    total + 2,
    'assignment and explicit mention each create one notification; plain text, re-mention and debug endpoint create none',
  );
  pass(
    'archive read entitlement, revocation without history loss, context mismatch, Card/Board/Workspace deletion and unchanged domain-event behavior',
  );

  const proof = randomBytes(32).toString('base64url'),
    hash = createHash('sha256').update(proof).digest('hex');
  const [invite] = await source.query(
    `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,expires_at,invited_by_id,send_state)
    VALUES ($1,'outsider@notifications.test','MEMBER',$2,now()+interval '1 day',$3,'SENT') RETURNING id`,
    [first, hash, actors.owner],
  );
  const invitation = await record(
    'outsider',
    'WORKSPACE_INVITED',
    { workspaceId: first },
    invite.id,
  );
  const wrong = await record(
    'other',
    'WORKSPACE_INVITED',
    { workspaceId: first },
    invite.id,
  );
  const resolved = (await list('outsider')).data.find(
    (row) => row.id === invitation.notificationId,
  );
  assert.equal(resolved.isUnavailable, false);
  assert.equal(resolved.target, null);
  const invitationRow = await source
    .getRepository('UserNotification')
    .findOneByOrFail({ id: invitation.notificationId });
  const resolveInvitation = () =>
    source.transaction((manager) =>
      resolvers.resolve(manager, actors.outsider, [invitationRow]),
    );
  await source.query('UPDATE users SET email_verified_at=NULL WHERE id=$1', [
    actors.outsider,
  ]);
  assert.equal((await resolveInvitation()).size, 0);
  await source.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [
    actors.outsider,
  ]);
  await source.query(
    "UPDATE workspace_invitations SET send_state='UNKNOWN' WHERE id=$1",
    [invite.id],
  );
  assert.equal((await resolveInvitation()).size, 0);
  await source.query(
    "UPDATE workspace_invitations SET send_state='SENT',declined_at=now() WHERE id=$1",
    [invite.id],
  );
  assert.equal((await resolveInvitation()).size, 0);
  await source.query(
    'UPDATE workspace_invitations SET declined_at=NULL WHERE id=$1',
    [invite.id],
  );
  assert.equal(
    (await list('other')).data.find((row) => row.id === wrong.notificationId)
      .isUnavailable,
    true,
  );
  await source.query(
    "UPDATE workspace_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
    [invite.id],
  );
  assert.equal(
    (await list('outsider')).data.find(
      (row) => row.id === invitation.notificationId,
    ).isUnavailable,
    true,
  );
  await source.query(
    "UPDATE workspace_invitations SET created_at=now()-interval '1 hour',expires_at=now()+interval '1 day',revoked_at=now() WHERE id=$1",
    [invite.id],
  );
  assert.equal(
    (await list('outsider')).data.find(
      (row) => row.id === invitation.notificationId,
    ).isUnavailable,
    true,
  );
  await source.query(
    'UPDATE workspace_invitations SET revoked_at=NULL,consumed_at=now() WHERE id=$1',
    [invite.id],
  );
  assert.equal(
    (await list('outsider')).data.find(
      (row) => row.id === invitation.notificationId,
    ).isUnavailable,
    true,
  );
  const boardInvite = await record('owner', 'BOARD_INVITED', {
    boardId: privateBoard.id,
  });
  assert.equal(
    (await list('owner')).data.find(
      (row) => row.id === boardInvite.notificationId,
    ).isUnavailable,
    true,
  );
  pass(
    'production invitation resolver, verified-recipient binding, null target, expiry/revoke/consume and fail-closed fallback',
  );
}
