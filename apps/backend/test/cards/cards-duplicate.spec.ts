import { RealtimeServerEvent } from '@kanban/shared';
import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

const COPY_ID = 'f6ba7134-97ef-4c1b-a342-001a982a7721';
const LABEL_ID = 'b7ba7134-97ef-4c1b-a342-001a982a7721';

describe('CardsService.duplicate', () => {
  let h: ReturnType<typeof cardsHarness>;
  beforeEach(() => {
    h = cardsHarness();
    const source = cardFixture({
      title: 'Source',
      description: 'Notes',
      startDate: new Date('2026-11-01T01:00:00Z'),
      dueDate: new Date('2026-11-02T09:30:00Z'),
      assignees: [
        {
          cardId: ID.card,
          userId: ID.target,
          assignedById: ID.user,
          createdAt: new Date('2026-10-16T00:00:00Z'),
        } as never,
      ],
    });
    // requireCard, then the last card of the destination column.
    h.cards.findOne
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(cardFixture({ position: '200.0000000000' }));
    h.cards.save.mockImplementation(async (input) => ({
      ...input,
      id: COPY_ID,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
    }));
  });

  it('copies content, dates, labels and checklists with every item unchecked', async () => {
    h.cardLabels.find.mockResolvedValue([
      { cardId: ID.card, labelId: LABEL_ID, boardId: ID.board },
    ]);
    h.checklists.find.mockResolvedValue([
      {
        id: 'first',
        title: 'First',
        position: '100.0000000000',
        items: [
          { text: 'Done', position: '100.0000000000', isChecked: true },
          { text: 'Open', position: '200.0000000000', isChecked: false },
        ],
      },
      { id: 'second', title: 'Second', position: '200.0000000000', items: [] },
    ]);

    const result = await h.service.duplicate(ID.user, ID.board, ID.card, {});

    expect(result).toMatchObject({
      id: COPY_ID,
      boardId: ID.board,
      columnId: ID.column,
      createdById: ID.user,
      title: 'Source',
      description: 'Notes',
      startDate: '2026-11-01T01:00:00.000Z',
      dueDate: '2026-11-02T09:30:00.000Z',
      position: '300.0000000000',
      isArchived: false,
      assignees: [],
    });
    expect(h.cardLabels.find).toHaveBeenCalledWith({
      where: { cardId: ID.card, boardId: ID.board },
    });
    expect(h.cardLabels.insert).toHaveBeenCalledWith([
      { cardId: COPY_ID, labelId: LABEL_ID, boardId: ID.board },
    ]);
    expect(h.checklists.create.mock.calls.map(([input]) => input)).toEqual([
      { cardId: COPY_ID, title: 'First', position: '100.0000000000' },
      { cardId: COPY_ID, title: 'Second', position: '200.0000000000' },
    ]);
    expect(h.checklistItems.insert).toHaveBeenCalledTimes(1);
    expect(h.checklistItems.insert).toHaveBeenCalledWith([
      {
        checklistId: 'copy-of-First',
        text: 'Done',
        position: '100.0000000000',
        isChecked: false,
      },
      {
        checklistId: 'copy-of-First',
        text: 'Open',
        position: '200.0000000000',
        isChecked: false,
      },
    ]);
    expect(h.activities.record).toHaveBeenCalledWith(
      h.manager,
      expect.objectContaining({ entityId: COPY_ID, metadata: null }),
    );
  });

  it('locks the board first and publishes card:created only after the transaction', async () => {
    await h.service.duplicate(ID.user, ID.board, ID.card, {});
    expect(h.authorization.requireMember).toHaveBeenCalledWith(
      ID.user,
      ID.board,
      { mutable: true },
      h.manager,
    );
    expect(
      h.authorization.requireMember.mock.invocationCallOrder[0],
    ).toBeLessThan(h.cards.findOne.mock.invocationCallOrder[0]);
    expect(h.events.publish).toHaveBeenCalledWith(
      RealtimeServerEvent.CARD_CREATED,
      { boardId: ID.board, cardId: COPY_ID, columnId: ID.column },
    );
    expect(h.events.publish.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.transaction.mock.invocationCallOrder[0],
    );
  });

  it('appends to a requested column of the same board', async () => {
    h.columns.findOne.mockResolvedValue({
      id: ID.secondColumn,
      boardId: ID.board,
    });
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {
        columnId: ID.secondColumn,
      }),
    ).resolves.toMatchObject({ columnId: ID.secondColumn });
    expect(h.columns.findOne).toHaveBeenCalledWith({
      where: { id: ID.secondColumn, boardId: ID.board },
    });
  });

  it('rejects archived sources, foreign columns and read-only boards without writing', async () => {
    h.cards.findOne.mockReset();
    h.cards.findOne.mockResolvedValueOnce(cardFixture({ isArchived: true }));
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {}),
    ).rejects.toMatchObject({ status: 409 });

    h.cards.findOne.mockResolvedValueOnce(null);
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {}),
    ).rejects.toMatchObject({ status: 404 });

    h.cards.findOne.mockResolvedValueOnce(cardFixture());
    h.columns.findOne.mockResolvedValueOnce(null);
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {
        columnId: ID.secondColumn,
      }),
    ).rejects.toMatchObject({ status: 404 });

    h.authorization.requireMember.mockRejectedValueOnce(
      Object.assign(new Error('Read only'), { status: 403 }),
    );
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {}),
    ).rejects.toMatchObject({ status: 403 });

    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.cardLabels.insert).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('publishes nothing when copying checklists fails', async () => {
    h.checklists.find.mockRejectedValue(new Error('lost connection'));
    await expect(
      h.service.duplicate(ID.user, ID.board, ID.card, {}),
    ).rejects.toThrow('lost connection');
    expect(h.events.publish).not.toHaveBeenCalled();
  });
});
