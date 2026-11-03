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
    load,
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
  await send('owner', 'post', '/api/notifications')
    .send({ kind: 'CARD_ASSIGNED', recipientUserId: actors.outsider })
    .expect(404);
  assert.equal(
    await source.getRepository('UserNotification').count(),
    total,
    'no real domain producers or debug endpoint belong to P4-03',
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
  assert.equal(
    (await list('outsider')).data.find(
      (row) => row.id === invitation.notificationId,
    ).isUnavailable,
    true,
    'no origin resolver => safe fallback, even for a valid pending invitation',
  );
  const { notificationOccurrence } = load(
    'api/notifications/notification-record',
  );
  const unregister = resolvers.register(
    'WORKSPACE_INVITED',
    async (manager, recipient, rows) => {
      const ids = rows
        .map(notificationOccurrence)
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      if (!ids.length) return new Map();
      const pending = await manager.query(
        `SELECT invitation.id,invitation.workspace_id,workspace.name
      FROM workspace_invitations invitation JOIN workspaces workspace ON workspace.id=invitation.workspace_id
      JOIN users recipient ON recipient.id=$1 AND recipient.email_verified_at IS NOT NULL AND lower(btrim(recipient.email))=invitation.email
      WHERE invitation.id=ANY($2::uuid[]) AND invitation.token_hash=$3 AND invitation.send_state='SENT'
        AND invitation.consumed_at IS NULL AND invitation.revoked_at IS NULL AND invitation.declined_at IS NULL AND invitation.expires_at>clock_timestamp()`,
        [recipient, ids, hash],
      );
      const byId = new Map(pending.map((row) => [row.id, row]));
      return new Map(
        rows.flatMap((row) => {
          const verified = byId.get(notificationOccurrence(row));
          return verified
            ? [
                [
                  row.id,
                  {
                    name: verified.name,
                    workspaceId: verified.workspace_id,
                    boardId: null,
                    actorVisible: true,
                    destination: { kind: 'workspaceInvitation', proof },
                    path: 'https://must-not-be-used.test',
                  },
                ],
              ]
            : [];
        }),
      );
    },
  );
  try {
    const resolved = (await list('outsider')).data.find(
      (row) => row.id === invitation.notificationId,
    );
    assert.equal(resolved.isUnavailable, false);
    assert.equal(resolved.target.path, `/invitations/workspace#proof=${proof}`);
    assert.equal(resolved.actor.id, actors.owner);
    assert.ok(!JSON.stringify(resolved).includes('must-not-be-used'));
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
      ).target,
      null,
    );
    await source.query(
      'UPDATE workspace_invitations SET revoked_at=NULL,consumed_at=now() WHERE id=$1',
      [invite.id],
    );
    assert.equal(
      (await list('outsider')).data.find(
        (row) => row.id === invitation.notificationId,
      ).context,
      null,
    );
  } finally {
    unregister();
  }
  const broken = resolvers.register('WORKSPACE_INVITED', async () => {
    throw new Error('private proof and SQL');
  });
  try {
    assert.equal(
      (await list('outsider')).data.find(
        (row) => row.id === invitation.notificationId,
      ).summary,
      'This notification is no longer available',
    );
  } finally {
    broken();
  }
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
    'origin-module invitation resolver hooks, pending/verified-recipient binding, fixed proof-fragment route, expiry/revoke/consume and fail-closed fallback',
  );
}
