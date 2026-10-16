import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('Card post-commit events', () => {
  it.each(['create', 'update', 'archive', 'move'] as const)(
    'publishes exactly once after %s commits',
    async (operation) => {
      const h = cardsHarness();
      h.transaction.mockImplementation(async (callback) => {
        const result = await callback(h.manager);
        expect(h.events.publish).not.toHaveBeenCalled();
        return result;
      });
      const args = [ID.user, ID.board, ID.card] as const;
      if (operation === 'create')
        await h.service.create(ID.user, ID.board, {
          columnId: ID.column,
          title: 'Private',
        });
      else if (operation === 'update')
        await h.service.update(...args, { title: 'Private' });
      else if (operation === 'archive') await h.service.archive(...args);
      else {
        h.columns.findOne.mockResolvedValue({
          id: ID.secondColumn,
          boardId: ID.board,
        });
        await h.service.move(...args, {
          toColumnId: ID.secondColumn,
          beforeCardId: null,
        });
      }
      expect(h.events.publish.mock.calls).toEqual([
        [
          `card:${{ create: 'created', update: 'updated', archive: 'archived', move: 'moved' }[operation]}`,
          operation === 'move'
            ? {
                boardId: ID.board,
                cardId: ID.card,
                fromColumnId: ID.column,
                toColumnId: ID.secondColumn,
              }
            : { boardId: ID.board, cardId: ID.card, columnId: ID.column },
        ],
      ]);
    },
  );

  it('suppresses unchanged fields including equivalent instants and no-op moves', async () => {
    const h = cardsHarness();
    const card = cardFixture({ dueDate: new Date('2026-10-16T00:00:00Z') });
    h.cards.findOne.mockResolvedValue(card);
    h.cards.find.mockResolvedValue([card]);
    await h.service.update(ID.user, ID.board, ID.card, {
      title: 'Card',
      description: null,
      dueDate: '2026-10-16T07:00:00+07:00',
    });
    await h.service.move(ID.user, ID.board, ID.card, {
      toColumnId: ID.column,
      beforeCardId: null,
    });
    expect(h.events.publish).not.toHaveBeenCalled();
    expect(h.cards.save).not.toHaveBeenCalled();
  });

  it('does not publish when persistence succeeds inside a transaction that subsequently rejects', async () => {
    const h = cardsHarness();
    h.transaction.mockImplementation(async (callback) => {
      await callback(h.manager);
      throw new Error('rollback');
    });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { title: 'New' }),
    ).rejects.toThrow('rollback');
    expect(h.cards.save).toHaveBeenCalledTimes(1);
    expect(h.events.publish).not.toHaveBeenCalled();
  });
});
