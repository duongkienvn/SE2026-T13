import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const start = '2026-03-08T01:30:00-05:00',
  due = '2026-03-08T03:30:00-04:00';
describe('atomic Card date mutations', () => {
  it.each([
    {},
    { startDate: start },
    { dueDate: due },
    { startDate: start, dueDate: due },
    { startDate: due, dueDate: due },
  ])('creates nullable/partial/equal date ranges %p', async (input) => {
    const h = cardsHarness();
    const result = await h.service.create(ID.user, ID.board, {
      columnId: ID.column,
      title: 'Dates',
      ...input,
    });
    expect(result.startDate).toBe(
      input.startDate ? new Date(input.startDate).toISOString() : null,
    );
    expect(result.dueDate).toBe(
      input.dueDate ? new Date(input.dueDate).toISOString() : null,
    );
    expect(h.events.publish).toHaveBeenCalledTimes(1);
  });
  it('validates both persisted counterparts before changing any field and leaves failed writes silent', async () => {
    const h = cardsHarness(),
      card = cardFixture({
        startDate: new Date(start),
        dueDate: new Date(due),
      });
    h.cards.findOne.mockResolvedValue(card);
    for (const input of [
      { startDate: '2026-03-08T08:00Z', title: 'Do not write' },
      { dueDate: '2026-03-08T05:00Z' },
    ])
      await expect(
        h.service.update(ID.user, ID.board, ID.card, input),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'CARD_DATE_RANGE_INVALID' },
      });
    await expect(
      h.service.create(ID.user, ID.board, {
        columnId: ID.column,
        title: 'No',
        startDate: due,
        dueDate: start,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(card.title).toBe('Card');
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.activities.record).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });
  it('keeps omitted values, permits atomic range replacement/clears, and suppresses equivalent instants', async () => {
    const h = cardsHarness(),
      card = cardFixture({
        startDate: new Date(start),
        dueDate: new Date(due),
      });
    h.cards.findOne.mockResolvedValue(card);
    await h.service.update(ID.user, ID.board, ID.card, {
      startDate: '2026-03-08T06:30:00Z',
      dueDate: '2026-03-08T07:30:00Z',
    });
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
    const result = await h.service.update(ID.user, ID.board, ID.card, {
      startDate: '2026-04-01T00:00Z',
      dueDate: '2026-04-02T00:00Z',
    });
    expect(result.startDate).toBe('2026-04-01T00:00:00.000Z');
    expect(h.activities.record).toHaveBeenCalledTimes(1);
    expect(h.events.publish).toHaveBeenCalledTimes(1);
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { startDate: null }),
    ).resolves.toMatchObject({
      startDate: null,
      dueDate: '2026-04-02T00:00:00.000Z',
    });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { dueDate: null }),
    ).resolves.toMatchObject({ startDate: null, dueDate: null });
  });
  it('validates direct service calls and never publishes after commit failure', async () => {
    const h = cardsHarness();
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { startDate: '2026-03-08' }),
    ).rejects.toMatchObject({ status: 400 });
    h.transaction.mockImplementation(async (callback) => {
      await callback(h.manager);
      throw new Error('commit failed');
    });
    await expect(
      h.service.update(ID.user, ID.board, ID.card, { startDate: start }),
    ).rejects.toThrow('commit failed');
    expect(h.events.publish).not.toHaveBeenCalled();
  });
});
