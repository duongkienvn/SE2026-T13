import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { waitForBlocked } from './workspace-invitations.concurrency.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const {
  WorkspaceInvitationIssuanceService,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');

export async function verifyQuotaContention({ source }) {
  for (const mode of ['actor', 'recipient']) {
    const users = [];
    const workspaces = [];
    for (let index = 0; index < 2; index++) {
      const [user] = await source.query(
        `INSERT INTO users(email,display_name,email_verified_at)
        VALUES ($1,'Quota ADMIN',clock_timestamp()) RETURNING id`,
        [`${mode}-${index}@quota-race.example.test`],
      );
      users.push(user);
      const actor = mode === 'actor' ? users[0] : user;
      const [workspace] = await source.query(
        `INSERT INTO workspaces(type,name,created_by_id)
        VALUES ('TEAM','Quota race',$1) RETURNING id`,
        [actor.id],
      );
      workspaces.push(workspace);
      await source.query(
        `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
        [workspace.id, actor.id],
      );
    }
    const recipient = `${mode}@quota-boundary.example.test`;
    const allowance = mode === 'actor' ? 30 : 5;
    for (let index = 0; index < allowance - 1; index++) {
      await source.query(
        `INSERT INTO workspace_invitations
        (workspace_id,email,role,token_hash,invited_by_id,created_at,expires_at,revoked_at)
        VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 day',clock_timestamp())`,
        [
          workspaces[0].id,
          mode === 'recipient'
            ? recipient
            : `seed-${index}@actor-quota.example.test`,
          randomBytes(32).toString('hex'),
          users[0].id,
        ],
      );
    }

    // Two independent pools model separate application instances sharing only PostgreSQL.
    const instances = [
      new DataSource({ ...source.options, poolSize: 1 }),
      new DataSource({ ...source.options, poolSize: 1 }),
    ];
    const runner = source.createQueryRunner();
    const pending = [];
    try {
      await Promise.all(instances.map((instance) => instance.initialize()));
      const services = instances.map((instance) => {
        const repository = instance.getRepository('Workspace');
        return new WorkspaceInvitationIssuanceService(
          repository,
          new WorkspacesService(repository),
          { send: async () => 'SENT' },
        );
      });
      await runner.startTransaction();
      const [{ pid: blocker }] = await runner.query(
        'SELECT pg_backend_pid() AS pid',
      );
      await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
        workspaces[0].id,
      ]);
      const start = (index) =>
        services[index]
          .create(
            mode === 'actor' ? users[0].id : users[index].id,
            workspaces[index].id,
            {
              email:
                mode === 'recipient'
                  ? recipient
                  : `request-${index}@actor-quota.example.test`,
            },
          )
          .then(
            (value) => ({ status: 202, value }),
            (error) => ({
              status: error.getStatus?.() ?? 500,
              code: error.getResponse?.()?.code ?? 'UNEXPECTED_ERROR',
            }),
          );
      pending.push(start(0));
      const firstPid = await waitForBlocked(source, blocker);
      pending.push(start(1));
      const secondPid = await waitForBlocked(source, firstPid);
      const [waiting] = await source.query(
        'SELECT query FROM pg_stat_activity WHERE pid=$1',
        [secondPid],
      );
      assert.match(waiting.query, /pg_advisory_xact_lock/);
      await runner.commitTransaction();
      const outcomes = await Promise.all(pending);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status),
        [202, 429],
      );
      assert.equal(outcomes[1].code, 'TOO_MANY_REQUESTS');
      const [count] = await source.query(
        `SELECT count(*)::int AS n FROM workspace_invitations
        WHERE ${mode === 'actor' ? 'invited_by_id = $1' : 'email = $1'} AND created_at > clock_timestamp()-interval '1 hour'`,
        [mode === 'actor' ? users[0].id : recipient],
      );
      assert.equal(count.n, allowance);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(pending);
      await Promise.all(
        instances
          .filter((instance) => instance.isInitialized)
          .map((instance) => instance.destroy()),
      );
    }
  }
}
