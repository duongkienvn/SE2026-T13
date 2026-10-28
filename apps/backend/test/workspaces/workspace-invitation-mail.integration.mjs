import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';

const require = createRequire(import.meta.url);
const { Test } = require('@nestjs/testing');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { validateEnvironment } = require('../../dist/config/environment.js');
const {
  WorkspaceInvitationMailer,
} = require('../../dist/api/workspaces/workspace-invitation-mailer.js');
const {
  FakeWorkspaceInvitationMailer,
} = require('../../dist/mail/fake-workspace-invitation-mailer.js');
const {
  ResendWorkspaceInvitationMailer,
} = require('../../dist/mail/resend-workspace-invitation-mailer.js');

/** Runs only inside the domain runner's disposable PostgreSQL container. */
export async function verifyInvitationMailDelivery({
  source,
  AppModule,
  configureHttpApplication,
}) {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService(
        validateEnvironment({
          ...process.env,
          // Explicit synthetic QA route, never a claim that a frontend route exists.
          WORKSPACE_INVITATION_ACCEPT_PATH: '/qa/invitation',
          PUBLIC_APP_URL: 'https://example.test',
          NODE_ENV: 'test',
          MAIL_TRANSPORT: 'resend',
        }),
      ),
    )
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    configureHttpApplication(app);
    await app.init();
    // No Issuance override: prove the actual WorkspaceApiModule → MailModule seam.
    const fake = app.get(WorkspaceInvitationMailer);
    assert(fake instanceof FakeWorkspaceInvitationMailer);
    const http = request(app.getHttpServer());
    const jwt = app.get(JwtService);
    const tokens = {};
    for (const key of ['admin', 'recipient', 'outsider']) {
      const [user] = await source.query(
        `INSERT INTO users(email,display_name,email_verified_at)
        VALUES ($1,$2,now()) RETURNING id`,
        [`mail-${key}@example.test`, key],
      );
      tokens[key] = await jwt.signAsync({ sub: user.id });
    }
    const send = (actor, method, path) =>
      http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
    const team = (
      await send('admin', 'post', '/api/workspaces')
        .send({ name: 'Dự án 東京 & <Team>' })
        .expect(201)
    ).body.data;
    const root = `/api/workspaces/${team.id}/invitations`;
    const invite = (email) =>
      send('admin', 'post', root).send({ email }).expect(202);
    await send('outsider', 'post', root)
      .send({ email: 'mail-recipient@example.test' })
      .expect(404);
    assert.equal(fake.deliveries.length, 0);
    const first = (await invite(' MAIL-recipient@example.test ')).body.data;
    assert.equal(first.sendState, 'SENT');
    assert.equal(first.status, 'PENDING');
    assert.equal(fake.deliveries.length, 1);
    const { message, idempotencyKey } = fake.deliveries[0];
    assert.equal(message.to, 'mail-recipient@example.test');
    assert.equal(idempotencyKey, `workspace-invitation/${first.id}`);
    assert(message.html.includes('Dự án 東京 &amp; &lt;Team&gt;'));
    const link = new URL(message.text.match(/Join Workspace: (\S+)/)[1]);
    assert.equal(link.origin, 'https://example.test');
    assert.equal(link.pathname, '/qa/invitation');
    assert.equal(link.search, '');
    const proof = new URLSearchParams(link.hash.slice(1)).get('proof');
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    const [stored] = await source.query(
      'SELECT * FROM workspace_invitations WHERE id=$1',
      [first.id],
    );
    assert.equal(
      stored.token_hash,
      createHash('sha256').update(proof).digest('hex'),
    );
    assert(!JSON.stringify(stored).includes(proof));
    assert(!JSON.stringify(first).includes(proof));
    await send('admin', 'post', root).send({ email: message.to }).expect(429);
    assert.equal(fake.deliveries.length, 1);
    await send('outsider', 'post', '/api/workspace-invitations/accept')
      .send({ proof })
      .expect(410);
    await send('recipient', 'post', '/api/workspace-invitations/accept')
      .send({ proof })
      .expect(200);
    await send('recipient', 'post', '/api/workspace-invitations/accept')
      .send({ proof })
      .expect(410);

    // Exercise actual provider outcome mapping through the committed domain handoff,
    // with a mock SDK client only. No network/credentials are used.
    const normal = fake.send.bind(fake);
    for (const [statusCode, expected] of [
      [429, 'FAILED'],
      [503, 'UNKNOWN'],
    ]) {
      let requests = 0;
      const adapter = new ResendWorkspaceInvitationMailer(
        {
          emails: {
            send: async () => {
              requests++;
              return {
                data: null,
                error: { statusCode, message: 'synthetic failure' },
              };
            },
          },
        },
        'Kanvexa <no-reply@example.test>',
        'https://example.test',
        '/qa/invitation',
      );
      fake.send = (payload) => adapter.send(payload);
      const failed = (await invite(`mail-failure-${statusCode}@example.test`))
        .body.data;
      assert.equal(failed.sendState, expected);
      assert.equal(requests, 1);
      assert.equal(fake.deliveries.length, 1);
    }
    fake.send = normal;

    // Rotation and revoke invalidate even a correctly rendered outgoing email.
    const rotating = (await invite('mail-rotate@example.test')).body.data;
    const oldLink = fake.deliveries
      .at(-1)
      .message.text.match(/Join Workspace: (\S+)/)[1];
    await source.query(
      `UPDATE workspace_invitations SET created_at=created_at-interval '10 minutes' WHERE id=$1`,
      [rotating.id],
    );
    const replacement = (await invite('mail-rotate@example.test')).body.data;
    const newLink = fake.deliveries
      .at(-1)
      .message.text.match(/Join Workspace: (\S+)/)[1];
    assert.notEqual(oldLink, newLink);
    assert.equal(
      (
        await source.query(
          'SELECT revoked_at FROM workspace_invitations WHERE id=$1',
          [rotating.id],
        )
      )[0].revoked_at instanceof Date,
      true,
    );
    await send('admin', 'delete', `${root}/${replacement.id}`).expect(204);
    const [recipient] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ('mail-rotate@example.test','Rotate',now()) RETURNING id`,
    );
    tokens.rotate = await jwt.signAsync({ sub: recipient.id });
    for (const url of [oldLink, newLink]) {
      const stale = new URLSearchParams(new URL(url).hash.slice(1)).get(
        'proof',
      );
      await send('rotate', 'post', '/api/workspace-invitations/accept')
        .send({ proof: stale })
        .expect(410);
    }
  } finally {
    await app.close();
  }
}
