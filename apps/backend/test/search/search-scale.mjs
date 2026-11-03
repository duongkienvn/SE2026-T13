import assert from 'node:assert/strict';
import console from 'node:console';

export async function verifySearchScaleAndSnapshots(ctx) {
  const { source, direct, search, workspace, board, card, actors, pass } = ctx;
  const original = source.createQueryRunner.bind(source);
  const capture = async (callback) => {
    const queries = [];
    source.createQueryRunner = (...args) => {
      const runner = original(...args),
        query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        queries.push({ sql: queryArgs[0], params: queryArgs[1] });
        return query(...queryArgs);
      };
      return runner;
    };
    try {
      return { result: await callback(), queries };
    } finally {
      source.createQueryRunner = original;
    }
  };
  const empty = await capture(() => direct('owner', { q: '   ' }));
  assert.equal(empty.queries.length, 0);
  assert.equal(empty.result.query, '');
  const emptyHttp = await capture(() => search('owner', { q: '  ' }));
  assert.ok(
    !emptyHttp.queries.some((item) =>
      /FROM "(cards|boards|workspaces)"/.test(item.sql),
    ),
  );
  const raceWs = await workspace('Snapshot parent'),
    parent = await board('snapshot188', raceWs);
  await card(parent, 'snapshot188', 'snapshot188 description');
  for (const actor of ['guest', 'member'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [parent.id, actors[actor]],
    );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [raceWs, actors.member],
  );
  for (const change of ['guest', 'member', 'archive']) {
    const actor = change === 'archive' ? 'owner' : change;
    let committed = false;
    source.createQueryRunner = (...args) => {
      const runner = original(...args),
        query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        const result = await query(...queryArgs);
        // The Workspace count acquires the shared RR snapshot before the
        // Board/Card query or its directory-name projection is read.
        if (!committed && String(queryArgs[0]).includes('COUNT(*)')) {
          committed = true;
          const writer = original();
          try {
            await writer.connect();
            if (change === 'guest')
              await writer.query(
                'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
                [parent.id, actors.guest],
              );
            if (change === 'member')
              await writer.query(
                'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
                [raceWs, actors.member],
              );
            if (change === 'archive')
              await writer.query(
                'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
                [parent.id],
              );
          } finally {
            await writer.release();
          }
        }
        return result;
      };
      return runner;
    };
    let response;
    try {
      response = await direct(actor, { q: 'snapshot188' });
    } finally {
      source.createQueryRunner = original;
    }
    assert.equal(committed, true);
    assert.equal(response.groups.boards.total, 1);
    assert.equal(response.groups.cards.items.length, 1);
    const next = await direct(actor, { q: 'snapshot188' });
    if (change === 'member') {
      assert.equal(
        response.groups.boards.items[0].workspaceName,
        'Snapshot parent',
      );
      assert.equal(next.groups.boards.items[0].workspaceName, null);
      assert.equal(next.groups.cards.items[0].workspaceName, null);
    } else {
      assert.equal(next.groups.boards.total, 0);
      assert.equal(next.groups.cards.total, 0);
    }
  }
  pass(
    'zero business queries for empty search and consistent snapshot during committed revocation, directory loss and archive',
  );

  const ws = await workspace('Bulk188 workspace'),
    boardIds = [],
    columnIds = [];
  for (let i = 0; i < 40; i++) {
    const row = await board(`Bulk188 board ${i}`, ws);
    boardIds.push(row.id);
    columnIds.push(row.columnId);
  }
  await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,description,position)
    SELECT b,c,$3,'Bulk188 card '||n,CASE WHEN n%2=0 THEN repeat('content ',100)||'Bulk188 description' ELSE NULL END,n*100
    FROM unnest($1::uuid[],$2::uuid[]) AS parents(b,c) CROSS JOIN generate_series(1,100) AS n`,
    [boardIds, columnIds, actors.owner],
  );
  // Unreadable Cards have the same match and even newer timestamps. They must
  // never influence count, page membership or rank for the outsider.
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) SELECT id,$1 FROM cards WHERE board_id=ANY($2::uuid[])',
    [actors.outsider, boardIds],
  );
  await source.query('ANALYZE');
  const one = await capture(() =>
    direct('owner', { q: 'Bulk188', type: 'cards', limit: 1 }),
  );
  const many = await capture(() =>
    direct('owner', { q: 'Bulk188', type: 'cards', limit: 50, page: 80 }),
  );
  assert.equal(one.result.groups.cards.total, 4000);
  assert.equal(many.result.groups.cards.total, 4000);
  assert.equal(many.result.groups.cards.items.length, 50);
  assert.equal(many.result.groups.cards.hasMore, false);
  assert.equal(
    new Set(many.result.groups.cards.items.map((item) => item.id)).size,
    50,
  );
  assert.equal(one.queries.length, many.queries.length);
  assert.equal(
    many.queries.filter((item) => /^\s*SELECT\b/.test(item.sql)).length,
    2,
  );
  const grouped = await capture(() =>
    direct('owner', { q: 'Bulk188', limit: 10 }),
  );
  assert.equal(
    grouped.queries.filter((item) => /^\s*SELECT\b/.test(item.sql)).length,
    6,
  );
  assert.equal(grouped.result.groups.workspaces.total, 1);
  assert.equal(grouped.result.groups.boards.total, 40);
  assert.equal(grouped.result.groups.cards.total, 4000);
  assert.equal(grouped.result.groups.cards.items.length, 10);
  assert.equal(grouped.result.groups.boards.items.length, 10);
  assert.equal(grouped.result.groups.cards.hasMore, true);
  assert.equal(grouped.result.groups.boards.hasMore, true);
  const denied = await direct('outsider', { q: 'Bulk188' });
  assert.ok(Object.values(denied.groups).every((group) => group.total === 0));
  for (const type of ['workspaces', 'boards', 'cards']) {
    const group = await search('owner', { q: 'Bulk188', type });
    assert.equal(
      group.groups[type].items.length,
      type === 'workspaces' ? 1 : 20,
    );
  }
  // Walk every page with the immutable fixture and verify ID tie-breaking does
  // not skip/repeat matches despite many Boards and retained assignments.
  const expected = (
    await source.query(
      'SELECT id FROM cards WHERE board_id=ANY($1::uuid[]) ORDER BY updated_at DESC,id ASC',
      [boardIds],
    )
  ).map((row) => row.id);
  const seen = [];
  for (let page = 1; page <= 80; page++)
    seen.push(
      ...(
        await direct('owner', { q: 'Bulk188', type: 'cards', limit: 50, page })
      ).groups.cards.items.map((item) => item.id),
    );
  assert.deepEqual(seen, expected);
  const plans = [];
  for (const type of ['workspaces', 'boards', 'cards']) {
    const captured = await capture(() =>
      direct('owner', { q: 'Bulk188', type }),
    );
    for (const query of captured.queries.filter((item) =>
      /^\s*SELECT\b/.test(item.sql),
    )) {
      const [row] = await source.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
        query.params,
      );
      const plan = row['QUERY PLAN'][0];
      assert.ok(plan['Execution Time'] < 10000);
      plans.push(
        `${type} ${query.sql.includes('COUNT(*)') ? 'count' : 'page'}=${plan['Execution Time']}ms`,
      );
    }
  }
  console.log(
    `Search query sanity: 4,000 Cards / 40 Boards; grouped 6 SELECTs, single type 2 SELECTs; ${plans.join(', ')}`,
  );
  pass(
    '4,000-row stable page traversal, grouped caps/defaults, constant query count, unauthorized assignments and actual EXPLAIN plans',
  );
}
