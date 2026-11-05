import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
const require = createRequire(import.meta.url);
const load = (file) => require(`../../dist/${file}.js`);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { BoardRoomCoordinator } = load(
  'realtime/board-room-coordinator.service',
);
const { BoardRoomService } = load('realtime/board-room.service');
const { RealtimeBroadcastService } = load(
  'realtime/realtime-broadcast.service',
);
const { PasswordSecurityService } = load('api/auth/password-security.service');
const { EmailChangeService } = load('api/auth/email-change.service');
const { EmailChangeMailer } = load('mail/email-change-mailer');
const { AccountDeletionService } = load(
  'api/users/account-deletion/account-deletion.service',
);

/** Pause one real transaction at a deterministic database barrier, no production sleeps/hooks. */
function barrier(source, fragment) {
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    reached = new Promise((resolve) => {
      entered = resolve;
    });
  const original = source.transaction;
  source.transaction = function (work) {
    source.transaction = original;
    return original.call(this, async (manager) => {
      const query = manager.query.bind(manager);
      let used = false;
      manager.query = async (sql, ...args) => {
        const result = await query(sql, ...args);
        if (!used && sql.includes(fragment)) {
          used = true;
          entered();
          await gate;
        }
        return result;
      };
      return work(manager);
    });
  };
  return {
    reached,
    release,
    restore: () => {
      source.transaction = original;
      release();
    },
  };
}
export async function verifyDeletionRaces(ctx) {
  const {
    source,
    app,
    auth,
    factory,
    session,
    proof,
    close,
    remove,
    team,
    board,
    deletion,
    pass,
    eventually,
    User,
  } = ctx;
  // Independent service boundary deliberately has no shared in-process queue.
  // Each transaction uses a separate PostgreSQL connection from the pool.
  const independentDeletion = new AccountDeletionService(
    source,
    {
      withReadGrantChanges: (operation) => operation(),
      revokeUserSessions: () => undefined,
    },
    { publish: async () => undefined },
  );
  const u = await factory(),
    p = await proof(u);
  const simultaneous = await Promise.allSettled([
    deletion.delete(p),
    independentDeletion.delete(p),
  ]);
  assert.equal(simultaneous.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    simultaneous.find((r) => r.status === 'rejected').reason.getStatus(),
    401,
  );
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: u.id }))
      .authVersion,
    1,
  );
  pass('simultaneous deletion commits exactly once, stale attempt returns 401');

  for (const kind of ['password', 'google']) {
    const actor = await factory(kind),
      snapshot = await proof(actor, kind);
    if (kind === 'password')
      await source.query(
        "UPDATE users SET password_hash='changed-without-version' WHERE id=$1",
        [actor.id],
      );
    else
      await source.query(
        "UPDATE google_identities SET google_sub=google_sub||'-changed' WHERE user_id=$1",
        [actor.id],
      );
    await assert.rejects(
      deletion.delete(snapshot),
      (e) => e.getStatus() === 403,
    );
    assert.equal(
      (await source.getRepository(User).findOneByOrFail({ id: actor.id }))
        .deletedAt,
      null,
    );
  }
  const passwordActor = await factory(),
    oldProof = await proof(passwordActor);
  await app
    .get(PasswordSecurityService)
    .change(passwordActor.id, 0, ctx.password, 'NewStrong2!');
  await assert.rejects(deletion.delete(oldProof), (e) => e.getStatus() === 401);
  const emailActor = await factory(),
    emailProof = await proof(emailActor),
    changes = app.get(EmailChangeService);
  await changes.request(emailProof, 'race-change@deletion.test');
  const mail = app
    .get(EmailChangeMailer)
    .proofs.findLast((d) => d.email === 'race-change@deletion.test');
  await changes.confirm(
    (await session(emailActor)).identity,
    new URL(mail.url).searchParams.get('token'),
  );
  await assert.rejects(
    deletion.delete(emailProof),
    (e) => e.getStatus() === 401,
  );
  pass(
    'locked password hash, Google subject, authVersion and email snapshots reject changed reauthentication',
  );

  // Two deletions contend on the same OWNER/ADMIN row boundary in separate connections.
  const one = await factory(),
    two = await factory(),
    w = await team(one, two),
    b = await board(one, w, two);
  const pp = await Promise.all([proof(one), proof(two)]);
  const results = await Promise.allSettled([
    deletion.delete(pp[0]),
    independentDeletion.delete(pp[1]),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const blocked = results.find((r) => r.status === 'rejected').reason;
  assert.equal(blocked.getResponse().code, 'ACCOUNT_DELETION_BLOCKED');
  assert.deepEqual(
    blocked.blockers.map((b) => b.type),
    ['BOARD_REQUIRES_ANOTHER_OWNER', 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN'],
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int n FROM board_members WHERE board_id=$1 AND role='OWNER'",
        [b.id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int n FROM workspace_members WHERE workspace_id=$1 AND role='ADMIN'",
        [w.id],
      )
    )[0].n,
    1,
  );
  pass('competing OWNER/ADMIN deletions retain a live OWNER and ADMIN');

  for (const target of ['owner', 'admin', 'move']) {
    const actor = await factory(),
      other = await factory(),
      workspace = await team(actor, other),
      resource = await board(actor, workspace, other);
    const [personal] = await source.query(
      "SELECT id FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL'",
      [actor.id],
    );
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
        resource.id,
      ]);
      await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
        workspace.id,
      ]);
      if (target === 'owner')
        await runner.query(
          "UPDATE board_members SET role='MEMBER' WHERE board_id=$1 AND user_id=$2",
          [resource.id, other.id],
        );
      if (target === 'admin')
        await runner.query(
          "UPDATE workspace_members SET role='MEMBER' WHERE workspace_id=$1 AND user_id=$2",
          [workspace.id, other.id],
        );
      if (target === 'move')
        await runner.query('UPDATE boards SET workspace_id=$2 WHERE id=$1', [
          resource.id,
          personal.id,
        ]);
      const pending = close(actor).then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
      await eventually(
        async () =>
          (
            await source.query(
              "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM boards%FOR UPDATE%'",
            )
          ).length > 0,
        'deletion waits behind resource mutation',
      );
      await runner.commitTransaction();
      const result = await pending;
      assert.equal(
        result.error?.getResponse().code,
        'ACCOUNT_DELETION_BLOCKED',
      );
      assert.equal(
        (await source.getRepository(User).findOneByOrFail({ id: actor.id }))
          .deletedAt,
        null,
      );
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  }
  pass(
    'concurrent last OWNER/ADMIN demotion and Board move to Personal Workspace block with zero partial cleanup',
  );

  const actor = await factory(),
    other = await factory(),
    workspace = await team(other),
    resource = await board(other, workspace);
  const snapshot = await proof(actor),
    pause = barrier(source, 'SELECT id FROM boards WHERE id=ANY');
  const pending = deletion.delete(snapshot);
  try {
    await pause.reached;
    // New grant commits after dependency enumeration, before the User fence.
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
      [resource.id, actor.id],
    );
    pause.release();
    await pending;
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int n FROM board_members WHERE user_id=$1',
          [actor.id],
        )
      )[0].n,
      0,
    );
  } finally {
    pause.restore();
  }
  pass(
    'grant committed during enumeration is re-enumerated and safely removed under resource locks',
  );

  const creator = await factory(),
    creatorProof = await proof(creator),
    creationPause = barrier(source, 'SELECT id FROM boards WHERE id=ANY');
  const creating = deletion.delete(creatorProof).then(
    () => ({ ok: true }),
    (error) => ({ error }),
  );
  try {
    await creationPause.reached;
    const newWorkspace = await team(creator);
    await board(creator, newWorkspace);
    creationPause.release();
    const result = await creating;
    assert.equal(result.error?.getResponse().code, 'ACCOUNT_DELETION_BLOCKED');
    assert.deepEqual(
      result.error.blockers.map((b) => b.type),
      ['BOARD_REQUIRES_ANOTHER_OWNER', 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN'],
    );
    assert.equal(
      (await source.getRepository(User).findOneByOrFail({ id: creator.id }))
        .deletedAt,
      null,
    );
  } finally {
    creationPause.restore();
  }
  pass(
    'new Board/Team Workspace committed during enumeration becomes a blocker on the locked retry',
  );

  const deleted = await factory(),
    lockedProof = await proof(deleted),
    lockPause = barrier(source, 'SELECT clock_timestamp() AS now');
  const closing = deletion.delete(lockedProof);
  try {
    await lockPause.reached; // All private cleanup performed, User UPDATE lock remains held.
    const inserting = source
      .query(
        "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
        [resource.id, deleted.id],
      )
      .then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
    await eventually(
      async () =>
        (
          await source.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO board_members%'",
          )
        ).length > 0,
      'live-reference insert waits for deletion',
    );
    lockPause.release();
    await closing;
    assert.equal((await inserting).error?.code, '23503');
    for (const sql of [
      "INSERT INTO google_identities(user_id,google_sub) VALUES ($1,'forbidden-relink')",
      'INSERT INTO user_preferences(user_id) VALUES($1)',
      `INSERT INTO card_assignees(card_id,user_id) VALUES('${ctx.history.card.id}'::uuid,$1)`,
      "INSERT INTO workspaces(type,name,created_by_id) VALUES('TEAM','Forbidden',$1)",
      'SELECT ensure_personal_workspace($1)',
    ])
      await assert.rejects(
        source.query(sql, [deleted.id]),
        (e) => e.code === '23503',
      );
  } finally {
    lockPause.restore();
  }
  pass(
    'database live-reference fence rejects late membership, credential, preferences and Workspace recreation',
  );

  const rollback = await factory('dual'),
    rw = await team(rollback, other);
  await board(rollback, rw, other);
  await source.query('INSERT INTO user_preferences(user_id) VALUES ($1)', [
    rollback.id,
  ]);
  const before = await source.query('SELECT * FROM users WHERE id=$1', [
    rollback.id,
  ]);
  await source.query(`CREATE FUNCTION deletion_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.user_id='${rollback.id}'::uuid THEN RAISE EXCEPTION 'synthetic private database failure'; END IF; RETURN OLD; END $$`);
  await source.query(
    'CREATE TRIGGER deletion_injected_failure BEFORE DELETE ON workspace_members FOR EACH ROW EXECUTE FUNCTION deletion_injected_failure()',
  );
  try {
    const response = await remove(rollback);
    assert.equal(response.status, 500);
    assert.equal(response.body.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(response.body).includes('synthetic private'));
    assert.deepEqual(
      await source.query('SELECT * FROM users WHERE id=$1', [rollback.id]),
      before,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int n FROM google_identities WHERE user_id=$1',
          [rollback.id],
        )
      )[0].n,
      1,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int n FROM user_preferences WHERE user_id=$1',
          [rollback.id],
        )
      )[0].n,
      1,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int n FROM board_members WHERE user_id=$1',
          [rollback.id],
        )
      )[0].n,
      1,
    );
  } finally {
    await source.query(
      'DROP TRIGGER deletion_injected_failure ON workspace_members',
    );
    await source.query('DROP FUNCTION deletion_injected_failure()');
  }
  pass(
    'injected mid-cleanup database failure rolls credentials, identity and grants back; HTTP hides SQL/private details',
  );

  const coordinator = app.get(BoardRoomCoordinator),
    rooms = app.get(BoardRoomService),
    broadcast = app.get(RealtimeBroadcastService);
  for (const phase of ['lookup', 'authenticated']) {
    const actor = await factory(),
      w = await team(actor, other),
      b = await board(actor, w, other),
      old = await session(actor),
      verified = await proof(actor);
    let release,
      reached = false,
      captured,
      outcome,
      connected = false;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = auth.authenticateAccessToken;
    auth.authenticateAccessToken = async function (token, ...args) {
      const identity = await original.call(this, token, ...args);
      if (token === old.jwt && phase === 'lookup') {
        reached = true;
        await gate;
      }
      return identity;
    };
    coordinator.server.use((socket, next) => {
      if (
        phase === 'authenticated' &&
        socket.data.identity?.userId === actor.id
      ) {
        captured = socket;
        reached = true;
        void gate.then(() => next());
      } else next();
    });
    const stale = io(await app.getUrl(), {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        auth: { accessToken: old.jwt },
      }),
      received = [];
    stale.on('connect', () => {
      connected = true;
      stale.emit('board:join', { boardId: b.id }, () => undefined);
    });
    stale.on('connect_error', () => {
      outcome = 'error';
    });
    stale.on('disconnect', () => {
      outcome = 'disconnect';
    });
    stale.on('board:archived', (value) => received.push(value));
    stale.on('presence:sync', (value) => received.push(value));
    try {
      stale.connect();
      await eventually(() => reached, `reach ${phase} handshake barrier`);
      assert.equal(
        [...coordinator.server.sockets.sockets.values()].some(
          (s) => s.data.identity?.userId === actor.id,
        ),
        false,
      );
      await deletion.delete(verified);
      release();
      await eventually(() => outcome, `reject ${phase} stale handshake`);
      if (phase === 'lookup') {
        assert.equal(connected, false);
        assert.equal(outcome, 'error');
      } else {
        assert.equal(outcome, 'disconnect');
        assert.equal(
          (await rooms.join(captured, { boardId: b.id })).code,
          'UNAUTHORIZED',
        );
        assert.equal(captured.data.authorizedBoardIds?.size ?? 0, 0);
      }
      await broadcast.emitToBoard(b.id, 'board:archived', { boardId: b.id });
      assert.deepEqual(received, []);
    } finally {
      release();
      auth.authenticateAccessToken = original;
      stale.disconnect();
    }
    pass(
      `in-flight ${phase} Socket.IO handshake cannot regain receive grants after deletion`,
    );
  }
}
