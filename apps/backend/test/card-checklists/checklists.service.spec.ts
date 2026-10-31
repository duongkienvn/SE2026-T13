import { CardChecklist } from '../../src/api/cards/entities/card-checklist.entity';
import { CardChecklistItem } from '../../src/api/cards/entities/card-checklist-item.entity';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { checklistHarness, ID } from './checklists.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('Card checklists service', () => {
  let h: ReturnType<typeof checklistHarness>;
  beforeEach(() => {
    h = checklistHarness();
  });
  const create = (h: ReturnType<typeof checklistHarness>, title = 'Tasks') =>
    h.service.create(ID.owner, ID.board, ID.card, { title });
  it('creates multiple checklists/items, derives progress, edits, reorders and cascades deletion', async () => {
    const a = await create(h),
      b = await create(h, 'Second');
    expect(a).toMatchObject({
      items: [],
      checkedItems: 0,
      totalItems: 0,
      completionPercentage: 0,
    });
    let list = await h.service.addItem(ID.member, ID.board, ID.card, a.id, {
      text: 'One',
    });
    const one = list.items[0];
    list = await h.service.addItem(ID.guest, ID.board, ID.card, a.id, {
      text: 'Two',
    });
    const two = list.items[1];
    list = await h.service.updateItem(
      ID.member,
      ID.board,
      ID.card,
      a.id,
      one.id,
      { isChecked: true, text: 'Edited' },
    );
    expect(list).toMatchObject({
      checkedItems: 1,
      totalItems: 2,
      completionPercentage: 50,
    });
    expect(list.items[0].text).toBe('Edited');
    list = await h.service.moveItem(
      ID.owner,
      ID.board,
      ID.card,
      a.id,
      two.id,
      one.id,
    );
    expect(list.items.map((item) => item.id)).toEqual([two.id, one.id]);
    await h.service.move(ID.owner, ID.board, ID.card, b.id, a.id);
    await h.service.rename(ID.owner, ID.board, ID.card, b.id, {
      title: 'Renamed',
    });
    expect(
      (await h.service.list(ID.owner, ID.board, ID.card)).checklists.map(
        (row) => row.title,
      ),
    ).toEqual(['Renamed', 'Tasks']);
    await h.service.removeItem(ID.owner, ID.board, ID.card, a.id, two.id);
    expect(
      await h.service.summaries(ID.owner, ID.board, [ID.card, ID.secondCard]),
    ).toEqual([
      {
        cardId: ID.card,
        checkedItems: 1,
        totalItems: 1,
        completionPercentage: 100,
      },
      {
        cardId: ID.secondCard,
        checkedItems: 0,
        totalItems: 0,
        completionPercentage: 0,
      },
    ]);
    await h.service.remove(ID.owner, ID.board, ID.card, a.id);
    expect(h.store(CardChecklistItem).size).toBe(0);
  });
  it('preserves timestamps and suppresses events on repeated checked states, text and moves', async () => {
    const a = await create(h);
    const list = await h.service.addItem(ID.owner, ID.board, ID.card, a.id, {
      text: 'One',
    });
    const item = list.items[0];
    h.events.publish.mockClear();
    h.repository(CardChecklistItem).save.mockClear();
    await h.service.updateItem(ID.owner, ID.board, ID.card, a.id, item.id, {
      isChecked: false,
      text: 'One',
    });
    await h.service.moveItem(ID.owner, ID.board, ID.card, a.id, item.id, null);
    await h.service.move(ID.owner, ID.board, ID.card, a.id, null);
    await h.service.rename(ID.owner, ID.board, ID.card, a.id, {
      title: a.title,
    });
    expect(h.events.publish).not.toHaveBeenCalled();
    expect(h.repository(CardChecklistItem).save).not.toHaveBeenCalled();
    expect(
      (await h.service.list(ID.owner, ID.board, ID.card)).checklists[0].items[0]
        .updatedAt,
    ).toBe(item.updatedAt);
  });
  it('rejects cross-parent identifiers, deleted/self anchors and empty item updates', async () => {
    const a = await create(h),
      b = await create(h);
    const item = (
      await h.service.addItem(ID.owner, ID.board, ID.card, a.id, {
        text: 'One',
      })
    ).items[0];
    for (const call of [
      h.service.rename(ID.owner, ID.board, ID.secondCard, a.id, {
        title: 'No',
      }),
      h.service.updateItem(ID.owner, ID.board, ID.card, b.id, item.id, {
        isChecked: true,
      }),
      h.service.move(ID.owner, ID.board, ID.card, a.id, ID.foreignCard),
      h.service.moveItem(
        ID.owner,
        ID.board,
        ID.card,
        a.id,
        item.id,
        ID.foreignCard,
      ),
      h.service.list(ID.owner, ID.board, ID.foreignCard),
      h.service.summaries(ID.owner, ID.board, [ID.card, ID.foreignCard]),
    ])
      await expect(call).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.move(ID.owner, ID.board, ID.card, a.id, a.id.toUpperCase()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.updateItem(ID.owner, ID.board, ID.card, a.id, item.id, {}),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('requires the Board lock first, permits archived reads and rejects every archived mutation', async () => {
    const a = await create(h);
    const firstLock = h.repository(Board).findOne.mock.calls[0][0];
    expect(firstLock).toMatchObject({ lock: { mode: 'pessimistic_write' } });
    h.store(Card).get(ID.card)!.isArchived = true;
    await expect(
      h.service.list(ID.owner, ID.board, ID.card),
    ).resolves.toBeDefined();
    await expect(create(h)).rejects.toMatchObject({ status: 409 });
    h.store(Card).get(ID.card)!.isArchived = false;
    h.store(Board).get(ID.board)!.isArchived = true;
    await expect(
      h.service.remove(ID.owner, ID.board, ID.card, a.id),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('enforces bounded parent collections and summary input', async () => {
    const a = await create(h);
    for (let index = 1; index < 50; index++) await create(h);
    await expect(create(h)).rejects.toMatchObject({ status: 409 });
    for (let index = 0; index < 200; index++)
      await h.service.addItem(ID.owner, ID.board, ID.card, a.id, {
        text: String(index),
      });
    await expect(
      h.service.addItem(ID.owner, ID.board, ID.card, a.id, {
        text: 'Overflow',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.summaries(ID.owner, ID.board, Array(101).fill(ID.card)),
    ).rejects.toMatchObject({ status: 400 });
    expect(await h.service.summaries(ID.owner, ID.board, [])).toEqual([]);
    expect(
      h
        .repository(CardChecklist)
        .find.mock.calls.every(([query]) => query.take === 50),
    ).toBe(true);
  });
});
