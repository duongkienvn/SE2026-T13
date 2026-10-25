import { cardFixture, cardsHarness, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('card restore', () => {
  it('appends an archived card while preserving its data and publishing after commit', async () => {
    const h = cardsHarness();
    const archived = cardFixture({
      isArchived: true,
      archivedAt: new Date(),
      description: 'Keep',
      dueDate: new Date('2026-11-01Z'),
    });
    h.cards.findOne
      .mockResolvedValueOnce(archived)
      .mockResolvedValueOnce(cardFixture({ position: '900.0000000000' }));
    const result = await h.service.restore(ID.user, ID.board, ID.card);
    expect(result).toMatchObject({
      id: ID.card,
      description: 'Keep',
      isArchived: false,
      archivedAt: null,
      position: '1000.0000000000',
    });
    expect(h.events.publish).toHaveBeenCalledWith('card:restored', {
      boardId: ID.board,
      cardId: ID.card,
      columnId: ID.column,
    });
  });

  it('rejects a card that is already active without saving or publishing', async () => {
    const h = cardsHarness();
    await expect(
      h.service.restore(ID.user, ID.board, ID.card),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CARD_NOT_ARCHIVED' },
    });
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('fails safely when the original column is unavailable', async () => {
    const h = cardsHarness();
    h.cards.findOne.mockResolvedValue(cardFixture({ isArchived: true }));
    h.columns.findOne.mockResolvedValue(null);
    await expect(
      h.service.restore(ID.user, ID.board, ID.card),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CARD_COLUMN_UNAVAILABLE' },
    });
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('lists archived cards by archived time then descending ID', async () => {
    const h = cardsHarness();
    await h.service.list(ID.user, ID.board, {
      status: 'archived',
      page: 1,
      limit: 20,
    });
    expect(h.builder.andWhere).toHaveBeenCalledWith(
      'card.isArchived = :isArchived',
      { isArchived: true },
    );
    expect(h.builder.orderBy).toHaveBeenCalledWith('card.archivedAt', 'DESC');
    expect(h.builder.addOrderBy).toHaveBeenCalledWith('card.id', 'DESC');
  });
});
