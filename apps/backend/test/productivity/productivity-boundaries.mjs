import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';

export async function verifyBoundaries(ctx) {
  const { source, tasks, home, workspace, board, card, actors, pass, send } =
    ctx;
  const zone = async (value) => {
    await send('owner', 'patch', '/api/users/me/preferences')
      .send({ timeZone: value })
      .expect(200);
  };
  const parent = await board('Boundary', await workspace('Calendar'));
  const ids = [];
  for (let i = 0; i < 5; i++)
    ids.push(await card(parent, null, `Boundary ${i}`, [actors.owner]));
  for (const [timeZone, clock, today, nextWeek] of [
    [
      'UTC',
      '2026-03-08T12:00:00Z',
      '2026-03-08T00:00:00Z',
      '2026-03-15T00:00:00Z',
    ],
    [
      'Asia/Bangkok',
      '2026-03-08T01:00:00Z',
      '2026-03-07T17:00:00Z',
      '2026-03-14T17:00:00Z',
    ],
    // Spring/fall weeks have 167/169 hours. Both transition-day starts and
    // windows containing the transition are checked with hard-coded UTC oracles.
    [
      'America/New_York',
      '2026-03-07T12:00:00Z',
      '2026-03-07T05:00:00Z',
      '2026-03-14T04:00:00Z',
    ],
    [
      'America/New_York',
      '2026-03-08T12:00:00Z',
      '2026-03-08T05:00:00Z',
      '2026-03-15T04:00:00Z',
    ],
    [
      'America/New_York',
      '2026-10-31T12:00:00Z',
      '2026-10-31T04:00:00Z',
      '2026-11-07T05:00:00Z',
    ],
    [
      'America/New_York',
      '2026-11-01T12:00:00Z',
      '2026-11-01T04:00:00Z',
      '2026-11-08T05:00:00Z',
    ],
    [
      'UTC',
      '2026-12-29T12:00:00Z',
      '2026-12-29T00:00:00Z',
      '2027-01-05T00:00:00Z',
    ],
    // Midnight offset changes, non-hour offsets and a skipped civil date.
    [
      'America/Santiago',
      '2026-09-06T12:00:00Z',
      '2026-09-06T04:00:00Z',
      '2026-09-13T03:00:00Z',
    ],
    [
      'Asia/Kathmandu',
      '2026-03-08T12:00:00Z',
      '2026-03-07T18:15:00Z',
      '2026-03-14T18:15:00Z',
    ],
    [
      'America/Havana',
      '2026-11-01T12:00:00Z',
      '2026-11-01T04:00:00Z',
      '2026-11-08T05:00:00Z',
    ],
    [
      'Pacific/Apia',
      '2011-12-29T12:00:00Z',
      '2011-12-29T10:00:00Z',
      '2012-01-04T10:00:00Z',
    ],
  ]) {
    await zone(timeZone);
    const dueDates = [
      new Date(Date.parse(today) - 1),
      new Date(today),
      new Date(Date.parse(nextWeek) - 1),
      new Date(nextWeek),
      null,
    ];
    for (let i = 0; i < ids.length; i++)
      await source.query('UPDATE cards SET due_date=$1 WHERE id=$2', [
        dueDates[i],
        ids[i],
      ]);
    const result = await tasks(
      'owner',
      { boardId: parent.id },
      new Date(clock),
    );
    assert.deepEqual(
      result.groupCounts,
      { OVERDUE: 1, NEXT_7_DAYS: 2, LATER: 1, NO_DUE_DATE: 1 },
      `${timeZone} ${clock}`,
    );
    assert.deepEqual(
      result.data.map((row) => row.id),
      ids,
    );
    assert.deepEqual(
      result.data.map((row) => row.group),
      ['OVERDUE', 'NEXT_7_DAYS', 'NEXT_7_DAYS', 'LATER', 'NO_DUE_DATE'],
    );
  }
  // Persisted timezone changes projection, never the stored UTC instants.
  await source.query(
    "UPDATE cards SET due_date='2026-03-07T20:00:00Z' WHERE id=$1",
    [ids[0]],
  );
  const before = await source.query(
    'SELECT id,due_date,start_date FROM cards WHERE board_id=$1 ORDER BY id',
    [parent.id],
  );
  await zone('UTC');
  assert.equal(
    (
      await tasks(
        'owner',
        { boardId: parent.id },
        new Date('2026-03-08T01:00:00Z'),
      )
    ).data.find((row) => row.id === ids[0]).group,
    'OVERDUE',
  );
  await zone('Asia/Bangkok');
  assert.equal(
    (
      await tasks(
        'owner',
        { boardId: parent.id },
        new Date('2026-03-08T01:00:00Z'),
      )
    ).data.find((row) => row.id === ids[0]).group,
    'NEXT_7_DAYS',
  );
  assert.deepEqual(
    await source.query(
      'SELECT id,due_date,start_date FROM cards WHERE board_id=$1 ORDER BY id',
      [parent.id],
    ),
    before,
  );
  // SQL grouping and instant filters retain native PostgreSQL microsecond precision.
  await zone('UTC');
  await source.query(
    "UPDATE cards SET due_date='2026-03-07T23:59:59.999999Z' WHERE id=$1",
    [ids[0]],
  );
  await source.query(
    "UPDATE cards SET due_date='2026-03-08T00:00:00.000001Z' WHERE id=$1",
    [ids[1]],
  );
  const fractional = await tasks('owner', {
    boardId: parent.id,
    dueFrom: '2026-03-08T00:00:00.000001Z',
    dueTo: '2026-03-08T00:00:00.000002Z',
  });
  assert.deepEqual(
    fractional.data.map((row) => row.id),
    [ids[1]],
  );
  assert.equal(
    (await tasks('owner', { boardId: parent.id })).data.find(
      (row) => row.id === ids[0],
    ).group,
    'OVERDUE',
  );
  pass(
    'UTC/Bangkok/New York spring/fall, midnight DST, year rollover, skipped day, timezone changes and microsecond boundaries',
  );

  const ws = await workspace('Ordering');
  const lower = await board('alpha', ws),
    upper = await board('ALPHA', ws),
    last = await board('Zulu', ws);
  for (const parent of [last, upper, lower]) {
    for (const due of ['2026-03-07T00:00:00Z', '2026-03-09T00:00:00Z', null])
      await card(parent, due, 'Tied title', [actors.owner]);
  }
  const rank = { OVERDUE: 0, NEXT_7_DAYS: 1, LATER: 2, NO_DUE_DATE: 3 };
  const lexical = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const dueCompare = (a, b) =>
    a.dueDate === null
      ? b.dueDate === null
        ? 0
        : 1
      : b.dueDate === null
        ? -1
        : lexical(a.dueDate, b.dueDate);
  const baseline = (await tasks('owner', { workspaceId: ws, limit: 100 })).data;
  for (const sort of ['dueDate', 'updatedAt', 'board']) {
    const expected = baseline
      .slice()
      .sort(
        (a, b) =>
          rank[a.group] - rank[b.group] ||
          (sort === 'updatedAt'
            ? lexical(b.updatedAt, a.updatedAt)
            : (sort === 'board'
                ? lexical(a.boardName.toLowerCase(), b.boardName.toLowerCase())
                : 0) || dueCompare(a, b)) ||
          lexical(a.id, b.id),
      )
      .map((row) => row.id);
    const actual = [];
    for (let page = 1; page <= 5; page++) {
      const result = await tasks('owner', {
        workspaceId: ws,
        sort,
        page,
        limit: 2,
      });
      assert.equal(result.meta.total, 9);
      assert.equal(result.meta.totalPages, 5);
      actual.push(...result.data.map((row) => row.id));
    }
    assert.deepEqual(actual, expected, sort);
    assert.equal(new Set(actual).size, actual.length);
  }
  // A genuinely newer update wins within its group, but never jumps group priority.
  const newer = baseline.find((row) => row.group === 'NEXT_7_DAYS');
  await source.query(
    "UPDATE cards SET updated_at='2026-03-08T12:00:00Z' WHERE id=$1",
    [newer.id],
  );
  assert.equal(
    (
      await tasks('owner', {
        workspaceId: ws,
        group: 'NEXT_7_DAYS',
        sort: 'updatedAt',
      })
    ).data[0].id,
    newer.id,
  );
  const dated = (await tasks('owner', { limit: 100 })).data
    .filter((row) => row.dueDate !== null)
    .slice(0, 6);
  assert.deepEqual(
    (await home('owner')).upNext.map((row) => row.id),
    dated.map((row) => row.id),
  );
  const peers = [];
  for (let i = 0; i < 8; i++) {
    const parent = await board(`Star ${i}`, ws);
    peers.push(parent.id);
    await source.query(
      `INSERT INTO board_user_states(user_id,board_id,is_starred,last_viewed_at) VALUES ($1,$2,true,'2030-01-01T00:00:00Z')`,
      [actors.owner, parent.id],
    );
  }
  const dashboard = await home('owner');
  const firstSix = peers.sort().reverse().slice(0, 6);
  assert.deepEqual(
    dashboard.starredBoards.map((row) => row.id),
    firstSix,
  );
  assert.deepEqual(
    dashboard.recentBoards.map((row) => row.id),
    firstSix,
  );
  assert.equal(dashboard.upNext.length, 6);
  pass(
    'all sorting modes, case-insensitive Board ties, stable pages, updatedAt ordering and deterministic Home limits',
  );
}

export async function verifyConcurrencyAndScale(ctx) {
  const { source, tasks, home, workspace, board, card, actors, pass } = ctx;
  const ws = await workspace('Race');
  const parent = await board('Race', ws);
  const id = await card(parent, '2026-03-09T00:00:00Z', 'Race', [actors.owner]);
  // Pause after aggregates but before page reads on this transaction's runner.
  // A separate connection commits assignment removal/ACL revocation meanwhile.
  const original = source.createQueryRunner.bind(source);
  for (const change of ['assignment', 'membership', 'archive', 'timezone']) {
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING",
      [parent.id, actors.owner],
    );
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id, actors.owner],
    );
    await source.query(
      'UPDATE boards SET is_archived=false,archived_at=NULL WHERE id=$1',
      [parent.id],
    );
    await source.query(
      `INSERT INTO user_preferences(user_id,time_zone) VALUES ($1,'UTC') ON CONFLICT(user_id) DO UPDATE SET time_zone='UTC'`,
      [actors.owner],
    );
    await source.query('UPDATE cards SET due_date=$1 WHERE id=$2', [
      change === 'timezone' ? '2026-03-07T20:00:00Z' : '2026-03-09T00:00:00Z',
      id,
    ]);
    let committed = false;
    source.createQueryRunner = (...args) => {
      const runner = original(...args),
        query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        const result = await query(...queryArgs);
        if (!committed && String(queryArgs[0]).includes('COUNT(*) FILTER')) {
          committed = true;
          const other = original();
          try {
            await other.connect();
            if (change === 'assignment')
              await other.query(
                'DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',
                [id, actors.owner],
              );
            if (change === 'membership')
              await other.query(
                'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
                [parent.id, actors.owner],
              );
            if (change === 'archive')
              await other.query(
                'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
                [parent.id],
              );
            if (change === 'timezone')
              await other.query(
                "UPDATE user_preferences SET time_zone='Asia/Bangkok' WHERE user_id=$1",
                [actors.owner],
              );
          } finally {
            await other.release();
          }
        }
        return result;
      };
      return runner;
    };
    let response;
    try {
      response = await tasks('owner', { boardId: parent.id });
    } finally {
      source.createQueryRunner = original;
    }
    assert.equal(committed, true);
    assert.equal(response.meta.total, 1, change);
    assert.equal(response.data.length, 1, change);
    assert.equal(
      Object.values(response.groupCounts).reduce((a, b) => a + b, 0),
      1,
    );
    assert.equal(
      (await tasks('owner', { boardId: parent.id })).meta.total,
      change === 'timezone' ? 1 : 0,
      change,
    );
    if (change === 'timezone') {
      assert.equal(response.data[0].group, 'OVERDUE');
      assert.equal(
        (await tasks('owner', { boardId: parent.id })).data[0].group,
        'NEXT_7_DAYS',
      );
    }
  }
  // Home also keeps totals and Up Next coherent during a committed unassignment.
  await source.query(
    "UPDATE user_preferences SET time_zone='UTC' WHERE user_id=$1",
    [actors.owner],
  );
  let changed = false;
  source.createQueryRunner = (...args) => {
    const runner = original(...args),
      query = runner.query.bind(runner);
    runner.query = async (...queryArgs) => {
      const result = await query(...queryArgs);
      if (!changed && String(queryArgs[0]).includes('COUNT(*) FILTER')) {
        changed = true;
        const other = original();
        try {
          await other.connect();
          await other.query('DELETE FROM card_assignees WHERE user_id=$1', [
            actors.owner,
          ]);
        } finally {
          await other.release();
        }
      }
      return result;
    };
    return runner;
  };
  try {
    const response = await home('owner');
    assert.ok(response.summary.assignedActiveCount > 0);
    assert.equal(response.upNext.length, 6);
  } finally {
    source.createQueryRunner = original;
  }
  assert.equal((await home('owner')).summary.assignedActiveCount, 0);
  pass(
    'repeatable-read coherence under committed unassignment, ACL revocation, archive and preference changes; next request sees changes',
  );

  const bulk = await workspace('Scale');
  const boardIds = [],
    columnIds = [];
  for (let i = 0; i < 40; i++) {
    const row = await board(`Bulk ${i}`, bulk);
    boardIds.push(row.id);
    columnIds.push(row.columnId);
  }
  await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    SELECT b,c,$3,'Bulk '||n,n*100,'2026-03-09T00:00:00Z'::timestamptz
    FROM unnest($1::uuid[],$2::uuid[]) AS parents(b,c) CROSS JOIN generate_series(1,100) AS n`,
    [boardIds, columnIds, actors.owner],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) SELECT id,$1 FROM cards WHERE board_id=ANY($2::uuid[])',
    [actors.owner, boardIds],
  );
  // Dense unrelated assignments verify the planner can start from user eligibility.
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) SELECT id,$1 FROM cards WHERE board_id=ANY($2::uuid[])',
    [actors.outsider, boardIds],
  );
  const labelIds = [];
  for (let i = 0; i < 200; i++) labelIds.push(randomUUID());
  await source.query(
    `INSERT INTO board_labels(id,board_id,name,color) SELECT id,$2,'Label '||ordinal,'#123456' FROM unnest($1::uuid[]) WITH ORDINALITY AS l(id,ordinal)`,
    [labelIds, boardIds[0]],
  );
  await source.query(
    `INSERT INTO card_labels(card_id,board_id,label_id) SELECT c.id,c.board_id,l.id FROM cards c CROSS JOIN unnest($1::uuid[]) AS l(id) WHERE c.board_id=$2`,
    [labelIds, boardIds[0]],
  );
  await source.query('ANALYZE');
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
  const small = await capture(() =>
    tasks('owner', { workspaceId: bulk, limit: 1 }),
  );
  const large = await capture(() =>
    tasks('owner', { workspaceId: bulk, limit: 100, page: 40 }),
  );
  assert.equal(small.result.meta.total, 4000);
  assert.equal(large.result.meta.total, 4000);
  assert.equal(large.result.data.length, 100);
  assert.equal(large.result.meta.totalPages, 40);
  assert.equal(small.queries.length, large.queries.length);
  assert.equal(
    large.queries.filter((q) => /^\s*(SELECT|WITH)\b/.test(q.sql)).length,
    4,
  );
  const crowded = await tasks('owner', { boardId: boardIds[0], limit: 100 });
  assert.ok(crowded.data.every((row) => row.labels.length === 200));
  const homeQueries = await capture(() => home('owner'));
  assert.equal(homeQueries.result.upNext.length, 6);
  assert.equal(
    homeQueries.queries.filter((q) => /^\s*(SELECT|WITH)\b/.test(q.sql)).length,
    7,
  );
  assert.equal((await tasks('outsider', { workspaceId: bulk })).meta.total, 0);
  const statement = large.queries.find((q) =>
    q.sql.includes('COUNT(*) FILTER'),
  );
  const [explain] = await source.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
    statement.params,
  );
  const plan = explain['QUERY PLAN'][0];
  assert.equal(plan.Plan['Actual Rows'], 1);
  assert.ok(plan['Execution Time'] < 10000);
  console.log(
    `Query sanity: 4,000 assigned Cards / 40 Boards; Tasks 4 SELECTs, Home 7 SELECTs; count EXPLAIN ${plan['Execution Time']} ms`,
  );
  pass(
    'large dataset stable pagination, bounded 200-label batches, constant query count and real PostgreSQL EXPLAIN',
  );
}
