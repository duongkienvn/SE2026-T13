import { NotFoundException } from '@nestjs/common';
import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('CardsService', () => {
  let h: ReturnType<typeof cardsHarness>;
  beforeEach(() => {
    h = cardsHarness();
  });

  it('creates at the end with server-controlled identity and nullable defaults', async () => {
    h.cards.findOne.mockResolvedValue(
      cardFixture({ position: '200.0000000000' }),
    );
    const result = await h.service.create(ID.user, ID.board, {
      columnId: ID.column,
      title: 'New',
    });
    expect(result).toMatchObject({
      position: '300.0000000000',
      createdById: ID.user,
      boardId: ID.board,
      dueDate: null,
      description: null,
      assignees: [],
    });
    expect(h.authorization.requireMember).toHaveBeenCalledWith(
      ID.user,
      ID.board,
      { mutable: true },
      h.manager,
    );
    expect(
      h.authorization.requireMember.mock.invocationCallOrder[0],
    ).toBeLessThan(h.cards.save.mock.invocationCallOrder[0]);
    expect(h.cards.findOne).toHaveBeenCalledWith({
      where: { boardId: ID.board, columnId: ID.column, isArchived: false },
      order: { position: 'DESC', id: 'DESC' },
    });
  });

  it('creates first card and rebalances an overflowing append atomically', async () => {
    h.cards.findOne.mockResolvedValueOnce(null);
    await expect(
      h.service.create(ID.user, ID.board, {
        columnId: ID.column,
        title: 'First',
      }),
    ).resolves.toMatchObject({ position: '100.0000000000' });
    h.cards.findOne.mockResolvedValue(
      cardFixture({ position: '9999999999.9999999999' }),
    );
    h.cards.find.mockResolvedValue([
      cardFixture({ position: '9999999999.9999999999' }),
    ]);
    await expect(
      h.service.create(ID.user, ID.board, {
        columnId: ID.column,
        title: 'Next',
      }),
    ).resolves.toMatchObject({ position: '200.0000000000' });
    expect(h.cards.save).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ position: '100.0000000000' }),
        expect.objectContaining({ position: '200.0000000000' }),
      ]),
    );
  });

  it('rejects an inaccessible destination or archived board before writing', async () => {
    h.columns.findOne.mockResolvedValue(null);
    await expect(
      h.service.create(ID.user, ID.board, {
        columnId: ID.column,
        title: 'Denied',
      }),
    ).rejects.toMatchObject({ status: 404 });
    h.authorization.requireMember.mockRejectedValueOnce(
      Object.assign(new Error('Archived'), { status: 409 }),
    );
    await expect(
      h.service.create(ID.user, ID.board, {
        columnId: ID.column,
        title: 'Denied',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.cards.save).not.toHaveBeenCalled();
  });

  it('updates only supplied fields, clears nullables and rejects an empty patch', async () => {
    h.cards.findOne.mockResolvedValue(
      cardFixture({
        description: 'keep',
        dueDate: new Date('2020-01-01T00:00:00Z'),
      }),
    );
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { title: 'Changed' }),
    ).resolves.toMatchObject({
      title: 'Changed',
      description: 'keep',
      dueDate: '2020-01-01T00:00:00.000Z',
    });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, {
        description: null,
        dueDate: null,
      }),
    ).resolves.toMatchObject({ description: null, dueDate: null });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, {}),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, {
        dueDate: '2000-01-01T07:00:00+07:00',
      }),
    ).resolves.toMatchObject({ dueDate: '2000-01-01T00:00:00.000Z' });
  });

  it('archives without deleting relations or changing position, and rejects further mutation', async () => {
    const card = cardFixture();
    h.cards.findOne.mockResolvedValue(card);
    const result = await h.service.archive(ID.user, ID.board, ID.card);
    expect(result).toMatchObject({
      isArchived: true,
      columnId: ID.column,
      position: card.position,
    });
    expect(Date.parse(result.archivedAt!)).not.toBeNaN();
    await expect(
      h.service.archive(ID.user, ID.board, ID.card),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CARD_ARCHIVED' },
    });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { title: 'No' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    [[], null, '100.0000000000'],
    [[['a', '100.0000000000']], 'a', '50.0000000000'],
    [
      [
        ['a', '100.0000000000'],
        ['b', '200.0000000000'],
      ],
      'b',
      '150.0000000000',
    ],
    [
      [
        ['a', '100.0000000000'],
        ['b', '200.0000000000'],
      ],
      null,
      '300.0000000000',
    ],
  ])(
    'moves into destination at the requested position: %j',
    async (rows, anchor, expected) => {
      h.columns.findOne.mockResolvedValue({
        id: ID.secondColumn,
        boardId: ID.board,
      });
      h.cards.find.mockResolvedValue(
        (rows as string[][]).map(([id, position]) =>
          cardFixture({ id, position, columnId: ID.secondColumn }),
        ),
      );
      await expect(
        h.service.move(ID.user, ID.board, ID.card, {
          toColumnId: ID.secondColumn,
          beforeCardId: anchor as string | null,
        }),
      ).resolves.toMatchObject({
        position: expected,
        columnId: ID.secondColumn,
        boardId: ID.board,
      });
      expect(h.cards.find).toHaveBeenCalledWith({
        where: {
          boardId: ID.board,
          columnId: ID.secondColumn,
          isArchived: false,
        },
        order: { position: 'ASC', id: 'ASC' },
      });
    },
  );

  it('handles no-op moves, self anchors and inaccessible targets without writes', async () => {
    h.cards.find.mockResolvedValue([
      cardFixture(),
      cardFixture({ id: 'anchor', position: '200.0000000000' }),
    ]);
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.column,
        beforeCardId: 'anchor',
      }),
    ).resolves.toMatchObject({ position: '100.0000000000' });
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.column,
        beforeCardId: ID.card.toUpperCase(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.column,
        beforeCardId: 'foreign-or-archived',
      }),
    ).rejects.toMatchObject({ status: 404 });
    h.columns.findOne.mockResolvedValue(null);
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.secondColumn,
        beforeCardId: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.cards.save).not.toHaveBeenCalled();
  });

  it('rebalances only the destination active order on gap exhaustion and propagates failed persistence', async () => {
    const destination = [
      cardFixture({
        id: 'a',
        position: '100.0000000000',
        columnId: ID.secondColumn,
      }),
      cardFixture({
        id: 'b',
        position: '100.0000000001',
        columnId: ID.secondColumn,
      }),
    ];
    h.columns.findOne.mockResolvedValue({
      id: ID.secondColumn,
      boardId: ID.board,
    });
    h.cards.find.mockResolvedValue(destination);
    const result = await h.service.move(ID.user, ID.board, ID.card, {
      toColumnId: ID.secondColumn,
      beforeCardId: 'b',
    });
    expect(result.position).toBe('200.0000000000');
    expect(h.cards.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', position: '100.0000000000' }),
      expect.objectContaining({ id: ID.card, position: '200.0000000000' }),
      expect.objectContaining({ id: 'b', position: '300.0000000000' }),
    ]);
    h.cards.save.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.secondColumn,
        beforeCardId: null,
      }),
    ).rejects.toThrow('write failed');
    h.cards.findOne.mockResolvedValue(cardFixture({ isArchived: true }));
    await expect(
      h.service.move(ID.user, ID.board, ID.card, {
        toColumnId: ID.secondColumn,
        beforeCardId: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('scopes active lists to the board with stable ordering and pagination', async () => {
    const result = await h.service.list(ID.user, ID.board, {
      page: 2,
      limit: 10,
    });
    expect(result.meta).toMatchObject({ page: 2, total: 1 });
    expect(h.builder.where).toHaveBeenCalledWith('card.boardId = :boardId', {
      boardId: ID.board,
    });
    expect(h.builder.andWhere).toHaveBeenCalledWith(
      'card.isArchived = :isArchived',
      { isArchived: false },
    );
    expect(h.builder.orderBy).toHaveBeenCalledWith('card.columnId', 'ASC');
    expect(h.builder.addOrderBy.mock.calls).toEqual([
      ['card.position', 'ASC'],
      ['card.id', 'ASC'],
    ]);
    expect(h.builder.skip).toHaveBeenCalledWith(10);
  });
  it('validates column scope and orders filtered lists by position and id', async () => {
    await h.service.list(ID.user, ID.board, {
      page: 1,
      limit: 20,
      columnId: ID.column,
    });
    expect(h.columns.findOne).toHaveBeenCalledWith({
      where: { id: ID.column, boardId: ID.board },
    });
    expect(h.builder.orderBy).toHaveBeenCalledWith('card.position', 'ASC');
    h.columns.findOne.mockResolvedValue(null);
    await expect(
      h.service.list(ID.user, ID.board, {
        page: 1,
        limit: 20,
        columnId: ID.column,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('allows archived detail reads and scopes card lookup to the board', async () => {
    h.cards.findOne.mockResolvedValue(cardFixture({ isArchived: true }));
    await expect(
      h.service.get(ID.user, ID.board, ID.card),
    ).resolves.toMatchObject({ isArchived: true });
    expect(h.cards.findOne).toHaveBeenCalledWith({
      where: { id: ID.card, boardId: ID.board },
      relations: { assignees: true },
    });
    h.cards.findOne.mockResolvedValue(null);
    await expect(
      h.service.get(ID.user, ID.board, ID.card),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects non-members before loading cards, and rejects invalid pagination', async () => {
    h.authorization.requireMember.mockRejectedValueOnce(
      new NotFoundException(),
    );
    await expect(
      h.service.get(ID.user, ID.board, ID.card),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.cards.findOne).not.toHaveBeenCalled();
    await expect(
      h.service.list(ID.user, ID.board, {
        page: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.cards.createQueryBuilder).not.toHaveBeenCalled();
  });
});
