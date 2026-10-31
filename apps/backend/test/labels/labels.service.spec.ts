import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { labelsHarness, ID } from './labels.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
describe('Board labels service', () => {
  let h: ReturnType<typeof labelsHarness>;
  beforeEach(() => {
    h = labelsHarness();
  });
  const create = (h: ReturnType<typeof labelsHarness>, name = 'Bug') =>
    h.service.create(ID.owner, ID.board, { name, color: ' #aabbcc ' });
  it('normalizes catalog values, orders/pages, rejects duplicate normalized names and preserves omitted fields', async () => {
    const bug = await create(h, ' Bug '),
      other = await create(h, 'Alpha');
    expect(bug).toMatchObject({ name: 'Bug', color: '#AABBCC' });
    await expect(create(h, 'bUg')).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.update(ID.owner, ID.board, other.id, { name: 'bug' }),
    ).rejects.toMatchObject({ status: 409 });
    const updated = await h.service.update(ID.member, ID.board, bug.id, {
      color: '#ffffff',
    });
    expect(updated).toMatchObject({ name: 'Bug', color: '#FFFFFF' });
    expect(
      (await h.service.list(ID.owner, ID.board, { page: 2, limit: 1 })).data[0]
        .id,
    ).toBe(bug.id);
    await expect(
      h.service.update(ID.owner, ID.board, bug.id, {}),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.list(ID.owner, ID.board, {
        page: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('joins current label metadata for many Cards without N+1, and catalog deletion cascades only its associations', async () => {
    const bug = await create(h),
      other = await create(h, 'Other');
    await h.service.assign(ID.guest, ID.board, ID.card, bug.id);
    await h.service.assign(ID.member, ID.board, ID.card, other.id);
    await h.service.assign(ID.owner, ID.board, ID.secondCard, bug.id);
    await expect(
      h.service.assign(ID.owner, ID.board, ID.card, bug.id),
    ).rejects.toMatchObject({ status: 409 });
    await h.service.update(ID.owner, ID.board, bug.id, {
      name: 'Issue',
      color: '#111111',
    });
    h.linkRepository.createQueryBuilder.mockClear();
    const cards = await h.service.forCards(ID.owner, ID.board, [
      ID.card,
      ID.secondCard,
    ]);
    expect(cards[0].labels.map((row) => row.name)).toEqual(['Issue', 'Other']);
    expect(cards[1].labels[0].color).toBe('#111111');
    expect(h.linkRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    await h.service.unassign(ID.owner, ID.board, ID.card, other.id);
    await h.service.remove(ID.owner, ID.board, bug.id);
    expect(h.links.size).toBe(0);
    expect(h.labels.has(other.id)).toBe(true);
  });
  it('checks Board lock and parent ownership, enforces archive and bounded collections, and suppresses no-ops', async () => {
    const bug = await create(h);
    expect(h.repository(Board).findOne.mock.calls[0][0]).toMatchObject({
      lock: { mode: 'pessimistic_write' },
    });
    h.events.publish.mockClear();
    await h.service.update(ID.owner, ID.board, bug.id, {
      name: ' Bug ',
      color: '#aabbcc',
    });
    expect(h.events.publish).not.toHaveBeenCalled();
    await expect(
      h.service.assign(ID.owner, ID.board, ID.foreignCard, bug.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.update(ID.owner, ID.foreignBoard, bug.id, { name: 'No' }),
    ).rejects.toMatchObject({ status: 404 });
    h.store(Card).get(ID.card)!.isArchived = true;
    await expect(
      h.service.assign(ID.owner, ID.board, ID.card, bug.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.cardLabels(ID.owner, ID.board, ID.card),
    ).resolves.toBeDefined();
    h.store(Board).get(ID.board)!.isArchived = true;
    await expect(create(h, 'No')).rejects.toMatchObject({ status: 409 });
    h.store(Board).get(ID.board)!.isArchived = false;
    for (let i = 1; i < 200; i++) await create(h, `Label ${i}`);
    await expect(create(h, 'Overflow')).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.forCards(ID.owner, ID.board, Array(101).fill(ID.card)),
    ).rejects.toMatchObject({ status: 400 });
    expect(await h.service.forCards(ID.owner, ID.board, [])).toEqual([]);
  });
});
