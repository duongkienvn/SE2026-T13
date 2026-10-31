import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { phase2Catalog } from './phase2-catalog.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const snapshot = async (source, tables) => {
  const result = {};
  for (const table of tables)
    result[table] =
      await source.query(`SELECT to_jsonb(t) - 'activity_move_version' - 'declined_at'
      - 'board_creation_admin_only' - 'board_invites_enabled' - 'board_membership_changes_enabled'
      - 'board_visibility_changes_enabled' AS row FROM ${table} t`);
  // Sort by the complete JSON value in JS; no reliance on table heap order.
  for (const rows of Object.values(result))
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
};

export async function verifyPhase2Upgrade(admin, freshCatalog) {
  await admin.query('CREATE DATABASE integrity_upgrade');
  const source = await new DataSource({
    ...admin.options,
    database: 'integrity_upgrade',
  }).initialize();
  try {
    const all = [...source.migrations];
    const through = async (timestamp) => {
      source.migrations = all.filter(
        (migration) => Number(migration.name.slice(-13)) <= timestamp,
      );
      return source.runMigrations();
    };
    await through(1793232000000); // Populated Phase 2 foundation/lifecycle.
    const [owner, guest] =
      await source.query(`INSERT INTO users(email,display_name,email_verified_at)
      VALUES ('upgrade-owner@example.test','Upgrade owner',now()),('upgrade-guest@example.test','Upgrade Guest',now()) RETURNING id`);
    const [{ id: personal }] = await source.query(
      'SELECT ensure_personal_workspace($1) AS id',
      [owner.id],
    );
    const [team] = await source.query(
      `INSERT INTO workspaces(type,name,created_by_id,icon) VALUES ('TEAM','Upgrade Team',$1,'users') RETURNING id`,
      [owner.id],
    );
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [team.id, owner.id],
    );
    const [board] = await source.query(
      `INSERT INTO boards(name,created_by_id,workspace_id,visibility)
      VALUES ('Upgrade Board',$1,$2,'WORKSPACE_VISIBLE') RETURNING id`,
      [owner.id, team.id],
    );
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER'),($1,$3,'MEMBER')`,
      [board.id, owner.id, guest.id],
    );
    const [column] = await source.query(
      `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Preserved',123.1234567890) RETURNING id`,
      [board.id],
    );
    const [card] = await source.query(
      `INSERT INTO cards(board_id,column_id,created_by_id,title,position,is_archived,archived_at)
      VALUES ($1,$2,$3,'Archived upgrade card',111.1234567890,true,now()) RETURNING id`,
      [board.id, column.id, owner.id],
    );
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id,assigned_by_id) VALUES ($1,$2,$3)',
      [card.id, guest.id, owner.id],
    );
    await source.query(
      `INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,'Preserved comment')`,
      [card.id, guest.id],
    );
    await source.query(
      `INSERT INTO activities(board_id,actor_id,action_type,entity_type,entity_id) VALUES ($1,$2,'BOARD_UPDATED','BOARD',$1)`,
      [board.id, owner.id],
    );
    for (const state of ['pending', 'accepted', 'revoked', 'expired'])
      await source.query(
        `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,send_state,created_at,expires_at,consumed_at,revoked_at)
        VALUES ($1,$2,'MEMBER',$3,$4,'SENT',now()-interval '1 day',CASE WHEN $5='expired' THEN now()-interval '1 hour' ELSE now()+interval '1 day' END,
        CASE WHEN $5='accepted' THEN now()-interval '1 minute' END, CASE WHEN $5='revoked' THEN now()-interval '1 minute' END)`,
        [
          team.id,
          `upgrade-${state}@example.test`,
          randomBytes(32).toString('hex'),
          owner.id,
          state,
        ],
      );
    const tables = [
      'users',
      'workspaces',
      'workspace_members',
      'boards',
      'board_members',
      'board_columns',
      'cards',
      'card_assignees',
      'comments',
      'activities',
      'workspace_invitations',
    ];
    const before = await snapshot(source, tables);
    assert.equal((await through(1793318400000)).length, 1);
    assert.deepEqual(await snapshot(source, tables), before);
    await source.query(
      `INSERT INTO board_workspace_moves(board_id,actor_id,source_workspace_id,destination_workspace_id,old_visibility,new_visibility)
      VALUES ($1,$2,$3,$4,'PRIVATE','WORKSPACE_VISIBLE')`,
      [board.id, owner.id, personal, team.id],
    );
    await source.query(
      `INSERT INTO deleted_workspace_invitation_quota(invitation_id,actor_id,recipient_hash,created_at) VALUES ($1,$2,repeat('a',64),now())`,
      [randomUUID(), owner.id],
    );
    const withLedgers = [
      ...tables,
      'board_workspace_moves',
      'deleted_workspace_invitation_quota',
    ];
    const policyState = await snapshot(source, withLedgers);
    assert.equal((await through(1793404800000)).length, 1);
    assert.deepEqual(await snapshot(source, withLedgers), policyState);
    await source.query(
      `UPDATE workspace_invitations SET declined_at=now()-interval '1 minute' WHERE email='upgrade-pending@example.test'`,
    );
    const declined = await source.query(
      'SELECT to_jsonb(t) AS row FROM workspace_invitations t ORDER BY id',
    );
    assert.equal((await through(1793491200000)).length, 1);
    assert.deepEqual(
      await source.query(
        'SELECT to_jsonb(t) AS row FROM workspace_invitations t ORDER BY id',
      ),
      declined,
    );
    // Only the intentionally declined invitation changed across the stages.
    assert.deepEqual(await snapshot(source, withLedgers), policyState);
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM workspace_activities',
        )
      )[0].n,
      0,
      'No invented historical activity',
    );
    const [{ activity_move_version: initial }] = await source.query(
      'SELECT activity_move_version FROM boards WHERE id=$1',
      [board.id],
    );
    assert.equal(initial, 0);
    assert.deepEqual(await phase2Catalog(source), freshCatalog);
    assert.deepEqual(
      (await source.driver.createSchemaBuilder().log()).upQueries,
      [],
    );

    // Current Phase 2 populated database: rediscovery is a no-op, never a replay
    // of legacy backfill against Teams/WORKSPACE_VISIBLE Boards.
    const after = await snapshot(source, withLedgers);
    source.migrations = all;
    assert.deepEqual(await source.runMigrations(), []);
    assert.deepEqual(await snapshot(source, withLedgers), after);
    for (const [name, type] of [
      ['bad-visibility', 'INVALID'],
      ['valid-private', 'PRIVATE'],
    ]) {
      const insert = source.query(
        'INSERT INTO boards(name,created_by_id,workspace_id,visibility) VALUES ($1,$2,$3,$4)',
        [name, owner.id, team.id, type],
      );
      if (type === 'INVALID')
        await assert.rejects(insert, (error) => error.code === '23514');
      else await insert;
    }
    console.log(
      'PASS: populated foundation → policies → decline → activity upgrade; exact User/Workspace/Board/Card/member/comment/invitation/ledger preservation; fresh/upgrade catalogs equal; current populated migration no-op',
    );
  } finally {
    await source.destroy();
    await admin.query('DROP DATABASE integrity_upgrade');
  }
}
