import assert from 'node:assert/strict';
import console from 'node:console';
import { URLSearchParams } from 'node:url';
import { randomUUID } from 'node:crypto';

// Runs only inside the disposable migrated database created by cards.integration.mjs.
export async function checkFiltering({
  source,
  service,
  owner,
  member,
  outsider,
  board,
  foreign,
  column,
  foreignColumn,
  foreignCard,
  api,
  request,
  server,
  jwt,
  user,
}) {
  const path = `/api/boards/${board.id}/cards`;
  const previewPath = `/api/boards/${board.id}/card-preview-summaries`;
  const a = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Filter 100%_\\literal',
    description: 'Needle in haystack',
    dueDate: '2026-03-08T07:00:00Z',
  });
  const b = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Filter second',
    dueDate: '2026-03-08T08:00:00Z',
  });
  const c = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Filter third',
  });
  const [l1, l2] = await source.query(
    "INSERT INTO board_labels(board_id,name,color) VALUES ($1,'Filter One','#112233'),($1,'Filter Two','#223344') RETURNING id",
    [board.id],
  );
  const [foreignLabel] = await source.query(
    "INSERT INTO board_labels(board_id,name,color) VALUES ($1,'Foreign','#112233') RETURNING id",
    [foreign.id],
  );
  await source.query(
    'INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$4,$6),($1,$5,$6),($2,$5,$6),($3,$4,$6)',
    [a.id, b.id, c.id, l1.id, l2.id, board.id],
  );
  await service.assign(owner.id, board.id, a.id, { userId: owner.id });
  await service.assign(owner.id, board.id, a.id, { userId: member.id });
  await service.assign(owner.id, board.id, b.id, { userId: member.id });
  const [checklist] = await source.query(
    "INSERT INTO card_checklists(card_id,title,position) VALUES ($1,'Checklist',100) RETURNING id",
    [a.id],
  );
  await source.query(
    "INSERT INTO card_checklist_items(checklist_id,text,position,is_checked) VALUES ($1,'Yes',100,true),($1,'No',200,false)",
    [checklist.id],
  );
  await source.query(
    "INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url) VALUES ($1,$2,$3,'URL','ACTIVE','Link','https://example.com/'),($1,$2,$3,'URL','REMOVED','Old','https://example.com/old')",
    [a.id, board.id, owner.id],
  );
  await source.query(
    "INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,intent_auth_version,expires_at) VALUES ($1::uuid,$2,$3,$4,'FILE','PENDING','Pending','pending.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',4096,4096,0,now()+interval '15 minutes')",
    [randomUUID(), a.id, board.id, owner.id],
  );
  await source.query(
    `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,intent_auth_version,expires_at,mime_type,byte_size,verified_at)
    VALUES ($1::uuid,$2,$3,$4,'FILE','ACTIVE','Verified','verified.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',4096,4096,0,now()+interval '15 minutes','text/plain',4096,now())`,
    [randomUUID(), a.id, board.id, owner.id],
  );
  await source.query(
    "INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,'Visible')",
    [a.id, owner.id],
  );
  await source.query(
    "INSERT INTO comments(card_id,author_id,content,deleted_at) VALUES ($1,$2,'Deleted',now())",
    [a.id, owner.id],
  );
  const query = async (params) =>
    (
      await api(
        'get',
        `${path}?${new URLSearchParams({ columnId: column.id, ...params })}`,
      ).expect(200)
    ).body;
  const ids = (result) => result.data.map((row) => row.id);
  assert.deepEqual(ids(await query({ q: '100%_\\literal' })), [a.id]);
  assert.deepEqual(ids(await query({ q: 'NEEDLE' })), [a.id]);
  assert.deepEqual(
    ids(
      await query({
        q: 'Filter',
        labelIds: `${l1.id},${l2.id}`,
        assigneeIds: `${owner.id},${member.id}`,
      }),
    ),
    [a.id, b.id],
  );
  const firstPage = await query({
    q: 'Filter',
    labelIds: `${l1.id},${l2.id}`,
    assigneeIds: `${owner.id},${member.id}`,
    limit: '1',
  });
  const secondPage = await query({
    q: 'Filter',
    labelIds: `${l1.id},${l2.id}`,
    assigneeIds: `${owner.id},${member.id}`,
    limit: '1',
    page: '2',
  });
  assert.equal(firstPage.meta.total, 2);
  assert.deepEqual(ids(firstPage), [a.id]);
  assert.deepEqual(ids(secondPage), [b.id]);
  const sortedDue = {
    q: 'Filter',
    sortBy: 'dueDate',
    sortDirection: 'desc',
    limit: '1',
  };
  assert.deepEqual(ids(await query(sortedDue)), [b.id]);
  assert.deepEqual(ids(await query({ ...sortedDue, page: '2' })), [a.id]);
  assert.deepEqual(ids(await query({ ...sortedDue, page: '3' })), [c.id]);
  const sortedTitle = {
    q: 'Filter',
    sortBy: 'title',
    sortDirection: 'desc',
    limit: '1',
  };
  assert.deepEqual(ids(await query(sortedTitle)), [c.id]);
  await api('get', `${path}?sortBy=position`).expect(400);
  assert.deepEqual(
    ids(
      await query({
        q: 'Filter',
        dueFrom: '2026-03-08T07:00:00Z',
        dueTo: '2026-03-08T08:00:00Z',
      }),
    ),
    [a.id],
  );
  assert.deepEqual(
    ids(await query({ q: 'Filter', dueStatus: 'NO_DUE_DATE' })),
    [c.id],
  );
  assert.deepEqual(ids(await query({ q: 'Filter', dueStatus: 'OVERDUE' })), [
    a.id,
    b.id,
  ]);
  // Explicit offsets distinguish the two occurrences of the fall-back hour.
  const foldEarly = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'DST fold early',
    dueDate: '2026-11-01T01:30:00-04:00',
  });
  const foldLate = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'DST fold late',
    dueDate: '2026-11-01T01:30:00-05:00',
  });
  assert.deepEqual(
    ids(
      await query({
        q: 'DST fold',
        dueFrom: '2026-11-01T01:00:00-04:00',
        dueTo: '2026-11-01T01:00:00-05:00',
      }),
    ),
    [foldEarly.id],
  );
  assert.deepEqual(
    ids(
      await query({
        q: 'DST fold',
        dueFrom: '2026-11-01T01:00:00-05:00',
        dueTo: '2026-11-01T02:00:00-05:00',
      }),
    ),
    [foldLate.id],
  );
  const upcoming = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Future status',
    dueDate: '2099-01-01T00:00:00Z',
  });
  assert.deepEqual(
    ids(await query({ q: 'Future status', dueStatus: 'UPCOMING' })),
    [upcoming.id],
  );
  const zone = new Date().getUTCHours() >= 23 ? 'Pacific/Honolulu' : 'UTC';
  await source.query(
    'INSERT INTO user_preferences(user_id,time_zone) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET time_zone=EXCLUDED.time_zone',
    [owner.id, zone],
  );
  const today = await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Today status',
    dueDate: new Date(Date.now() + 600000).toISOString(),
  });
  assert.deepEqual(
    ids(await query({ q: 'Today status', dueStatus: 'DUE_TODAY' })),
    [today.id],
  );
  await source.query('DELETE FROM user_preferences WHERE user_id=$1', [
    owner.id,
  ]);
  await api('get', `${path}?labelIds=${foreignLabel.id}`).expect(404);
  await api('get', `${path}?columnId=${foreignColumn.id}`).expect(404);
  await api(
    'get',
    `${path}?dueFrom=2026-03-08T08:00:00Z&dueTo=2026-03-08T07:00:00Z`,
  ).expect(400);
  const summary = (
    await api(
      'get',
      `${previewPath}?cardIds=${a.id},${c.id},${foreignCard.id}`,
    ).expect(200)
  ).body.data.summaries;
  assert.deepEqual(
    summary.find((x) => x.cardId === a.id),
    {
      cardId: a.id,
      labelIds: [l1.id, l2.id].sort(),
      checklist: { checkedItems: 1, totalItems: 2 },
      attachmentCount: 2,
      commentCount: 1,
    },
  );
  assert.deepEqual(
    summary.find((x) => x.cardId === c.id),
    {
      cardId: c.id,
      labelIds: [l1.id],
      checklist: { checkedItems: 0, totalItems: 0 },
      attachmentCount: 0,
      commentCount: 0,
    },
  );
  assert.equal(summary.length, 2);
  const hundred = [a.id, ...Array.from({ length: 99 }, randomUUID)].join(',');
  assert.equal(
    (await api('get', `${previewPath}?cardIds=${hundred}`).expect(200)).body
      .data.summaries.length,
    1,
  );
  await api('get', `${previewPath}?cardIds=${hundred},${randomUUID()}`).expect(
    400,
  );
  const outsiderToken = await jwt.signAsync({
    sub: outsider.id,
    authVersion: 0,
  });
  for (const url of [path, `${previewPath}?cardIds=${a.id}`])
    await request(server)
      .get(url)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(404);
  const expired = await jwt.signAsync(
    { sub: owner.id, authVersion: 0 },
    { expiresIn: -1 },
  );
  await request(server)
    .get(`${previewPath}?cardIds=${a.id}`)
    .set('Authorization', `Bearer ${expired}`)
    .expect(401);
  const [during] = await Promise.all([
    api('get', `${previewPath}?cardIds=${a.id}`).expect(200),
    source.query(
      'UPDATE card_checklist_items SET is_checked=true WHERE checklist_id=$1',
      [checklist.id],
    ),
  ]);
  assert([1, 2].includes(during.body.data.summaries[0].checklist.checkedItems));
  assert.equal(
    (await api('get', `${previewPath}?cardIds=${a.id}`).expect(200)).body.data
      .summaries[0].checklist.checkedItems,
    2,
  );
  const bulk = await source.query(
    "INSERT INTO cards(board_id,column_id,created_by_id,title,position,is_archived) SELECT $1,$2,$3,'Preview bulk '||i,100000+i*100,false FROM generate_series(1,1000) i RETURNING id",
    [board.id, column.id, owner.id],
  );
  const bulkIds = bulk
    .slice(0, 100)
    .map((row) => row.id)
    .join(',');
  assert.equal(
    (await api('get', `${previewPath}?cardIds=${bulkIds}`).expect(200)).body
      .data.summaries.length,
    100,
  );
  const visited = new Set();
  for (let page = 1; page <= 10; page++) {
    const result = await query({
      q: 'Preview bulk',
      page: String(page),
      limit: '100',
    });
    assert.equal(result.meta.total, 1000);
    for (const id of ids(result)) {
      assert(!visited.has(id));
      visited.add(id);
    }
  }
  assert.equal(visited.size, 1000);
  const plan = await source.query(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM cards WHERE board_id=$1 AND NOT is_archived AND title ILIKE $2 ORDER BY column_id,position,id LIMIT 20',
    [board.id, '%Preview bulk%'],
  );
  assert(plan[0]['QUERY PLAN'][0]['Execution Time'] >= 0);
  await source.query('DELETE FROM cards WHERE id = ANY($1::uuid[])', [
    bulk.map((row) => row.id),
  ]);
  const viewer = await user('filter-viewer');
  const guest = await user('filter-guest');
  const [{ workspace_id: workspaceId }] = await source.query(
    'SELECT workspace_id FROM boards WHERE id=$1',
    [board.id],
  );
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
    [workspaceId, viewer.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [board.id, guest.id],
  );
  const viewerToken = await jwt.signAsync({ sub: viewer.id, authVersion: 0 });
  const guestToken = await jwt.signAsync({ sub: guest.id, authVersion: 0 });
  const getAs = (url, token) =>
    request(server).get(url).set('Authorization', `Bearer ${token}`);
  await getAs(path, viewerToken).expect(404);
  await getAs(`${previewPath}?cardIds=${a.id}`, viewerToken).expect(404);
  await getAs(`${previewPath}?cardIds=${a.id}`, guestToken).expect(200);
  await getAs(
    `/api/boards/${foreign.id}/card-preview-summaries?cardIds=${foreignCard.id}`,
    guestToken,
  ).expect(404);
  await source.query(
    "UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1",
    [board.id],
  );
  await getAs(`${path}?q=Filter`, viewerToken).expect(200);
  await getAs(`${previewPath}?cardIds=${a.id}`, viewerToken).expect(200);
  await request(server)
    .post(path)
    .set('Authorization', `Bearer ${viewerToken}`)
    .send({ columnId: column.id, title: 'forbidden' })
    .expect(404);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, guest.id],
  );
  await getAs(`${previewPath}?cardIds=${a.id}`, guestToken).expect(404);
  await source.query("UPDATE boards SET visibility='PRIVATE' WHERE id=$1", [
    board.id,
  ]);
  await getAs(`${previewPath}?cardIds=${a.id}`, viewerToken).expect(404);
  await service.archive(owner.id, board.id, a.id);
  assert.equal(
    (await api('get', `${previewPath}?cardIds=${a.id}`).expect(200)).body.data
      .summaries.length,
    0,
  );
  assert.deepEqual(
    ids(await query({ q: '100%_\\literal', status: 'archived' })),
    [a.id],
  );
  await service.restore(owner.id, board.id, a.id);
  assert.deepEqual(ids(await query({ q: '100%_\\literal' })), [a.id]);
  console.log(
    'PASS: P3-07 literal/combined filters, bounds, paging, metadata, ACL and archive',
  );
}
