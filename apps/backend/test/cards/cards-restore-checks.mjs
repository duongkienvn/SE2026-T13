import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function checkCardRestore({
  source,
  service,
  owner,
  member,
  outsider,
  board,
  foreign,
  column,
  api,
  request,
  server,
}) {
  const cards = source.getRepository('Card');
  const activities = source.getRepository('Activity');
  const path = `/api/boards/${board.id}/cards`;
  const seed = (overrides = {}) =>
    cards.save(
      cards.create({
        boardId: board.id,
        columnId: column.id,
        createdById: owner.id,
        title: 'Archive preservation',
        description: 'Keep this description',
        dueDate: new Date('2026-12-01T09:00:00Z'),
        position: '10.0000000000',
        isArchived: true,
        archivedAt: new Date('2026-10-01T09:00:00Z'),
        ...overrides,
      }),
    );
  const card = await seed();
  const tied = await seed({ title: 'Equal archive timestamp' });
  const newest = await seed({
    archivedAt: new Date('2026-10-02T09:00:00Z'),
    position: '-999.0000000000',
  });
  const assignment = await source
    .getRepository('CardAssignee')
    .save({ cardId: card.id, userId: member.id, assignedById: owner.id });
  const comment = await source
    .getRepository('Comment')
    .save({ cardId: card.id, authorId: member.id, content: 'Keep comment' });
  const scoped = `${path}?status=archived&columnId=${column.id}&limit=1`;
  const expected = [newest.id, ...[card.id, tied.id].sort().reverse()];
  for (const [index, id] of expected.entries()) {
    const response = await api('get', `${scoped}&page=${index + 1}`).expect(
      200,
    );
    assert.equal(response.body.data[0].id, id);
    assert.deepEqual(response.body.meta, {
      page: index + 1,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
  }
  await request(server).get(`${path}?status=archived`).expect(401);
  for (const query of [
    'status=all',
    'status=ARCHIVED',
    'status=',
    'page=0',
    'limit=101',
    'columnId=bad',
  ])
    await api('get', `${path}?${query}`).expect(400);
  await api('get', `/api/boards/${randomUUID()}/cards?status=archived`).expect(
    404,
  );
  const foreignColumn = await source.getRepository('BoardColumn').save({
    boardId: foreign.id,
    name: 'Foreign restore column',
    position: '0.0000000000',
  });
  await api(
    'get',
    `${path}?status=archived&columnId=${foreignColumn.id}`,
  ).expect(404);
  for (const userId of [outsider.id, randomUUID()]) {
    await assert.rejects(
      service.list(userId, board.id, {
        status: 'archived',
        page: 1,
        limit: 20,
      }),
      (error) => error.getStatus() === 404,
    );
    await assert.rejects(
      service.restore(userId, board.id, card.id),
      (error) => error.getStatus() === 404,
    );
  }
  await request(server).post(`${path}/${card.id}/restore`).expect(401);
  await api('post', `${path}/bad/restore`).expect(400);
  await api('post', `${path}/${randomUUID()}/restore`).expect(404);
  await api(
    'post',
    `/api/boards/${foreign.id}/cards/${card.id}/restore`,
  ).expect(404);

  const original = await cards.findOneByOrFail({ id: card.id });
  const last = await cards.findOne({
    where: { boardId: board.id, columnId: column.id, isArchived: false },
    order: { position: 'DESC' },
  });
  const results = await Promise.all(
    [
      service.restore(owner.id, board.id, card.id),
      service.restore(member.id, board.id, card.id),
    ].map((operation) =>
      operation.then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
    ),
  );
  assert.equal(results.filter((result) => result.value).length, 1);
  const failure = results.find((result) => result.error).error;
  assert.equal(failure.getStatus(), 409);
  assert.equal(failure.getResponse().code, 'CARD_NOT_ARCHIVED');
  const restored = await cards.findOneByOrFail({ id: card.id });
  for (const key of [
    'id',
    'boardId',
    'columnId',
    'createdById',
    'title',
    'description',
    'dueDate',
    'createdAt',
  ])
    assert.deepEqual(restored[key], original[key]);
  assert.equal(restored.isArchived, false);
  assert.equal(restored.archivedAt, null);
  if (last) assert.ok(Number(restored.position) > Number(last.position));
  assert.ok(
    await source.getRepository('CardAssignee').findOneBy({ id: assignment.id }),
  );
  const persistedComment = await source
    .getRepository('Comment')
    .findOneByOrFail({ id: comment.id });
  for (const key of Object.keys(comment))
    assert.deepEqual(persistedComment[key], comment[key]);
  assert.equal(
    await activities.countBy({
      entityId: card.id,
      actionType: 'CARD_RESTORED',
    }),
    1,
  );
  const replay = await api('post', `${path}/${card.id}/restore`).expect(409);
  assert.equal(replay.body.code, 'CARD_NOT_ARCHIVED');

  const dense = await seed({
    isArchived: false,
    archivedAt: null,
    position: '9999999999.9999999999',
  });
  const beforeOrder = (
    await cards.find({
      where: { boardId: board.id, columnId: column.id, isArchived: false },
      order: { position: 'ASC', id: 'ASC' },
    })
  ).map((row) => row.id);
  await api('post', `${path}/${tied.id}/restore`).expect(200);
  const afterOrder = await cards.find({
    where: { boardId: board.id, columnId: column.id, isArchived: false },
    order: { position: 'ASC', id: 'ASC' },
  });
  assert.deepEqual(
    afterOrder.map((row) => row.id),
    [...beforeOrder, tied.id],
  );
  assert.equal(
    new Set(afterOrder.map((row) => row.position)).size,
    afterOrder.length,
  );
  assert.ok(afterOrder.find((row) => row.id === dense.id));

  // A cross-board column is FK-valid but inconsistent domain data: never relocate it.
  const inconsistent = await seed({ columnId: foreignColumn.id });
  const unavailable = await api(
    'post',
    `${path}/${inconsistent.id}/restore`,
  ).expect(409);
  assert.equal(unavailable.body.code, 'CARD_COLUMN_UNAVAILABLE');
  assert.equal(
    (await cards.findOneByOrFail({ id: inconsistent.id })).isArchived,
    true,
  );
  assert.equal(await activities.countBy({ entityId: inconsistent.id }), 0);
  await source
    .getRepository('Board')
    .update(board.id, { isArchived: true, archivedAt: new Date() });
  await api('get', `${path}?status=archived`).expect(200);
  const archivedBoard = await api(
    'post',
    `${path}/${newest.id}/restore`,
  ).expect(409);
  assert.equal(archivedBoard.body.code, 'BOARD_ARCHIVED');
  await source
    .getRepository('Board')
    .update(board.id, { isArchived: false, archivedAt: null });
}
