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
