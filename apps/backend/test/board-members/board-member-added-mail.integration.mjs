import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const { DataSource } = require('typeorm');
const request = require('supertest');
const {
  BoardMemberAddedMailer,
  FakeBoardMemberAddedMailer,
} = require('../../dist/mail/board-member-added-mailer.js');
const {
  ResendBoardMemberAddedMailer,
} = require('../../dist/mail/resend-board-member-added-mailer.js');
const {
  BoardMembersService,
} = require('../../dist/api/board-members/board-members.service.js');
const {
  ActivityWriterService,
} = require('../../dist/api/activities/activity-writer.service.js');
const {
  BoardEventPublisher,
} = require('../../dist/realtime/board-event-publisher.service.js');

/** Called only by the disposable Docker-backed Board Membership runner. */
export async function verifyBoardMemberAddedMail(source) {
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  try {
    configureHttpApplication(app);
    await app.init();
    assert.equal(app.get(DataSource).options.database, 'member_test');
    const fake = app.get(BoardMemberAddedMailer);
    assert(fake instanceof FakeBoardMemberAddedMailer);
    const normalSend = fake.send.bind(fake);
    const http = request(app.getHttpServer());
    const jwt = app.get(JwtService);
    const actors = {},
      tokens = {};
    for (const name of [
      'owner',
      'admin',
      'member',
      'outsider',
      'guest',
      'failed',
      'timeout',
      'rollback',
      'concurrent',
      'revoked',
    ]) {
      const [row] = await source.query(
        `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,now()) RETURNING id,email`,
        [
          `notice-${name}@example.test`,
          name === 'owner' ? 'Owner <script> & 東京' : name,
        ],
      );
      actors[name] = row;
      tokens[name] = await jwt.signAsync({ sub: row.id });
    }
    const send = (actor, method, path) =>
      http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
    const team = (
      await send('owner', 'post', '/api/workspaces')
        .send({ name: 'Private Workspace' })
        .expect(201)
    ).body.data;
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN'),($1,$3,'MEMBER')`,
      [team.id, actors.admin.id, actors.member.id],
    );
    const board = (
      await send('owner', 'post', '/api/boards')
        .send({ name: 'Dự án & <Board>', workspaceId: team.id })
        .expect(201)
    ).body.data;
    const root = `/api/boards/${board.id}`;
    const add = (actor, target) =>
      send(actor, 'post', `${root}/members`).send({
        email: actors[target].email,
      });
    const membershipCount = async (target) =>
      (
        await source.query(
          'SELECT count(*)::int AS count FROM board_members WHERE board_id=$1 AND user_id=$2',
          [board.id, actors[target].id],
        )
      )[0].count;

    // Existing authorization: neither Workspace role nor visibility grants OWNER.
    for (const actor of ['admin', 'member', 'outsider']) {
      await add(actor, 'guest').expect(404);
      assert.equal(await membershipCount('guest'), 0);
    }
    await add('owner', 'owner').expect(409);
    await send('owner', 'post', `${root}/members`)
      .send({ email: 'absent@example.test' })
      .expect(404);
    await send('owner', 'post', `${root}/members`)
      .send({ email: 'invalid' })
      .expect(400);
    assert.equal(fake.deliveries.length, 0);

    // A separate PostgreSQL connection must see the membership and activity
    // inside the adapter. This proves the transaction has actually committed.
    const service = app.get(BoardMembersService);
    const publisher = app.get(BoardEventPublisher);
    const normalPublish = publisher.publish.bind(publisher);
    const published = [];
    publisher.publish = async (...args) => {
      published.push(args);
      await normalPublish(...args);
    };
    let attempts = 0;
    fake.send = async (payload, signal) => {
      attempts++;
      const rows = await source.query(
        'SELECT id FROM board_members WHERE id=$1',
        [payload.membershipId],
      );
      assert.equal(rows.length, 1);
      const activity = await source.query(
        `SELECT id FROM activities WHERE entity_id=$1 AND action_type='MEMBER_ADDED'`,
        [payload.membershipId],
      );
      assert.equal(activity.length, 1);
      return normalSend(payload, signal);
    };
    const added = (await add('owner', 'guest').expect(201)).body;
    assert.equal(added.success, true);
    assert.equal(added.data.role, 'MEMBER');
    assert.equal(attempts, 1);
    assert.equal(fake.deliveries.length, 1);
    assert.equal(await membershipCount('guest'), 1);
    assert.equal(
      published.filter(([event]) => event === 'member:added').length,
      1,
    );
    const { message, idempotencyKey } = fake.deliveries[0];
    assert.equal(message.to, actors.guest.email);
    assert.equal(idempotencyKey, `board-member-added/${added.data.id}`);
    assert(message.html.includes('Owner &lt;script&gt; &amp; 東京'));
    assert(message.html.includes('Dự án &amp; &lt;Board&gt;'));
    assert(message.html.includes('kanvexa-logo-v1.png'));
    assert(
      message.text.includes(`https://boards.example.test/boards/${board.id}`),
    );
    assert(!message.text.includes(team.name));
    assert(!message.text.includes(actors.admin.email));
    assert(!JSON.stringify(added).includes('notification'));
    await add('owner', 'guest').expect(409);
    assert.equal(attempts, 1);
    await service.updateRole(actors.owner.id, board.id, actors.guest.id, {
      role: 'MEMBER',
    });
    await service.updateRole(actors.owner.id, board.id, actors.guest.id, {
      role: 'OWNER',
    });
    await service.updateRole(actors.owner.id, board.id, actors.guest.id, {
      role: 'MEMBER',
    });
    assert.equal(attempts, 1);
    await add('guest', 'failed').expect(403);
    assert.equal(attempts, 1);

    // Board Guests can open only their Board; Workspace APIs stay protected.
    await send('guest', 'get', root).expect(200);
    for (const suffix of ['', '/members', '/guests', '/activity'])
      await send('guest', 'get', `/api/workspaces/${team.id}${suffix}`).expect(
        404,
      );
    assert.equal(
      (
        await source.query(
          'SELECT id FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
          [team.id, actors.guest.id],
        )
      ).length,
      0,
    );
    await send('member', 'get', root).expect(404);
    await send('owner', 'patch', `${root}/visibility`)
      .send({ visibility: 'WORKSPACE_VISIBLE' })
      .expect(200);
    await send('member', 'get', root).expect(200);
    await add('member', 'failed').expect(404);
    await add('admin', 'failed').expect(404);
    await send('outsider', 'get', root).expect(404);
    await send('owner', 'patch', `${root}/visibility`)
      .send({ visibility: 'PRIVATE' })
      .expect(200);

    // A real DB error after insertion rolls back membership AND activity.
    const writer = app.get(ActivityWriterService);
    const record = writer.record.bind(writer);
    writer.record = async (manager, input) => {
      await record(manager, input);
      await manager.query('SELECT 1/0');
    };
    await add('owner', 'rollback').expect(500);
    writer.record = record;
    assert.equal(await membershipCount('rollback'), 0);
    assert.equal(attempts, 1);
    assert.equal(
      (
        await source.query(
          `SELECT id FROM activities WHERE board_id=$1 AND action_type='MEMBER_ADDED'`,
          [board.id],
        )
      ).length,
      1,
    );

    // Provider/network exceptions cannot change HTTP 201 or committed data.
    fake.send = async () => {
      attempts++;
      throw new Error('private recipient/provider detail');
    };
    await add('owner', 'failed').expect(201);
    assert.equal(await membershipCount('failed'), 1);
    assert.equal(attempts, 2);
    await add('owner', 'failed').expect(409);
    assert.equal(attempts, 2);

    // Mock SDK rejects only on abort. The real service deadline must abort it,
    // finish HTTP successfully and leave the committed row, with no second send.
    let providerAttempts = 0;
    const stalled = new ResendBoardMemberAddedMailer(
      {
        emails: {
          send: async (_message, { signal }) => {
            providerAttempts++;
            return new Promise((_resolve, reject) => {
              if (signal.aborted) reject(signal.reason);
              else
                signal.addEventListener('abort', () => reject(signal.reason), {
                  once: true,
                });
            });
          },
        },
      },
      'Kanvexa <no-reply@example.test>',
      'https://boards.example.test',
    );
    fake.send = (payload, signal) => stalled.send(payload, signal);
    const start = Date.now();
    await add('owner', 'timeout').timeout(15000).expect(201);
    assert(Date.now() - start < 14000);
    assert.equal(providerAttempts, 1);
    assert.equal(await membershipCount('timeout'), 1);
    await add('owner', 'timeout').expect(409);
    assert.equal(providerAttempts, 1);

    fake.send = async (payload, signal) => {
      attempts++;
      return normalSend(payload, signal);
    };
    const beforeConcurrent = attempts;
    const concurrent = await Promise.all([
      add('owner', 'concurrent'),
      add('owner', 'concurrent'),
    ]);
    assert.deepEqual(
      concurrent.map((response) => response.status).sort(),
      [201, 409],
    );
    assert.equal(await membershipCount('concurrent'), 1);
    assert.equal(attempts, beforeConcurrent + 1);

    // Remove/re-add creates a new event/key, while an observed revocation before
    // dispatch is suppressed. Every old Board link still checks current access.
    await send('owner', 'delete', `${root}/members/${actors.guest.id}`).expect(
      204,
    );
    await send('guest', 'get', root).expect(404);
    await add('owner', 'guest').expect(201);
    assert.notEqual(fake.deliveries.at(-1).idempotencyKey, idempotencyKey);
    publisher.publish = async (event, data) => {
      await normalPublish(event, data);
      if (event === 'member:added' && data.userId === actors.revoked.id)
        await service.remove(actors.owner.id, board.id, actors.revoked.id);
    };
    const beforeRevoked = attempts;
    await add('owner', 'revoked').expect(201);
    assert.equal(attempts, beforeRevoked);
    await send('revoked', 'get', root).expect(404);
    publisher.publish = normalPublish;

    await send('owner', 'post', `${root}/archive`).expect(200);
    await send('guest', 'get', root).expect(200);
    const beforeArchived = attempts;
    await add('owner', 'outsider').expect(409);
    assert.equal(attempts, beforeArchived);
    await send('owner', 'post', `${root}/restore`).expect(200);
    const destination = (
      await send('owner', 'post', '/api/workspaces')
        .send({ name: 'Destination' })
        .expect(201)
    ).body.data;
    await send('owner', 'post', `${root}/move-workspace`)
      .send({ destinationWorkspaceId: destination.id })
      .expect(200);
    await send('guest', 'get', root).expect(200);
    await send('guest', 'get', `/api/workspaces/${destination.id}`).expect(404);
    assert.equal(attempts, beforeArchived);
    await send('owner', 'delete', `${root}/members/${actors.guest.id}`).expect(
      204,
    );
    await send('guest', 'get', root).expect(404);
    console.log(
      'PASS: Board member email post-commit visibility, rollback, provider failure/timeout, concurrency, re-add/revocation, Guest/visibility/archive/move HTTP ACLs',
    );
  } finally {
    await app.close();
  }
}
