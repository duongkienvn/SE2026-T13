import { RealtimeServerEvent } from '@kanban/shared';
import { classifyImportRows } from '../../src/api/cards/cards-import';
import {
  ImportCardsDto,
  MAX_CARD_IMPORT_ROWS,
} from '../../src/api/cards/dto/import-cards.dto';
import { createValidationPipe } from '../../src/config/validation';
import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

/*
 * State model under test (VT-052, state transition testing):
 *   row:  RECEIVED --valid--> ACCEPTED --commit--> CREATED (card ACTIVE)
 *         RECEIVED --invalid--> REJECTED (terminal, never persisted)
 *         ACCEPTED --transaction failure--> ROLLED_BACK (nothing persisted)
 *   board guard: ACTIVE allows ACCEPTED -> CREATED, ARCHIVED forbids it.
 */
const pipe = createValidationPipe();
const validateRequest = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: ImportCardsDto });

describe('Card import row transitions RECEIVED -> ACCEPTED | REJECTED', () => {
  it('TC01 accepts valid rows, keeps their index and reuses CreateCardDto normalisation', async () => {
    const result = await classifyImportRows([
      { title: ' Alpha ' },
      {
        title: 'Beta',
        description: null,
        dueDate: '2000-01-01T07:00:00+07:00',
      },
      { title: 'x'.repeat(120), description: 'x'.repeat(2000) },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.accepted.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(result.accepted[0].row).toMatchObject({ title: 'Alpha' });
    expect(result.accepted[1].row).toMatchObject({
      title: 'Beta',
      description: null,
      dueDate: '2000-01-01T07:00:00+07:00',
    });
  });

  it('TC02 a rejected row between valid rows does not displace or drop them', async () => {
    const result = await classifyImportRows([
      { title: 'First' },
      { title: '' },
      { title: 'Third' },
    ]);
    expect(result.accepted.map(({ index, row }) => [index, row.title])).toEqual(
      [
        [0, 'First'],
        [2, 'Third'],
      ],
    );
    expect(result.rejected).toEqual([
      { index: 1, details: [expect.stringContaining('title')] },
    ]);
  });

  it.each([
    ['null row', null],
    ['string row', 'Alpha'],
    ['array row', [{ title: 'Alpha' }]],
    ['missing title', {}],
    ['blank title after trim', { title: '   ' }],
    ['title just above boundary (121)', { title: 'x'.repeat(121) }],
    [
      'description above boundary',
      { title: 'Ok', description: 'x'.repeat(2001) },
    ],
    ['deadline without timezone', { title: 'Ok', dueDate: '2026-10-01' }],
    ['unknown field (whitelist)', { title: 'Ok', columnId: ID.column }],
  ])('TC03 rejects %s with a field-level detail', async (_name, row) => {
    const result = await classifyImportRows([row]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].index).toBe(0);
    expect(result.rejected[0].details.length).toBeGreaterThan(0);
  });
});

describe('Card import request contract', () => {
  it('TC04 accepts 1 and 100 rows even when rows are invalid, rejects 0 and 101 rows', async () => {
    for (const count of [1, MAX_CARD_IMPORT_ROWS]) {
      await expect(
        validateRequest({
          columnId: ID.column,
          items: Array.from({ length: count }, () => ({ title: '' })),
        }),
      ).resolves.toMatchObject({ columnId: ID.column });
    }
    for (const items of [
      [],
      Array.from({ length: MAX_CARD_IMPORT_ROWS + 1 }, () => ({ title: 'A' })),
      'not-an-array',
    ]) {
      await expect(
        validateRequest({ columnId: ID.column, items }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      validateRequest({ columnId: 'not-a-uuid', items: [{ title: 'A' }] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CardsService.importCards', () => {
  let h: ReturnType<typeof cardsHarness>;
  beforeEach(() => {
    h = cardsHarness();
    h.cards.findOne.mockResolvedValue(
      cardFixture({ position: '200.0000000000' }),
    );
  });

  it('TC05 persists ACCEPTED rows as ACTIVE cards after the last active card and reports REJECTED rows', async () => {
    const result = await h.service.importCards(ID.user, ID.board, {
      columnId: ID.column,
      items: [{ title: 'A' }, { title: 'x'.repeat(121) }, { title: 'C' }],
    });
    expect(result).toMatchObject({
      createdCount: 2,
      rejectedCount: 1,
      rejected: [{ index: 1 }],
    });
    expect(result.created).toEqual([
      expect.objectContaining({
        title: 'A',
        position: '300.0000000000',
        isArchived: false,
        archivedAt: null,
        createdById: ID.user,
        columnId: ID.column,
      }),
      expect.objectContaining({
        title: 'C',
        position: '400.0000000000',
        isArchived: false,
      }),
    ]);
    expect(h.cards.findOne).toHaveBeenCalledWith({
      where: { boardId: ID.board, columnId: ID.column, isArchived: false },
      order: { position: 'DESC', id: 'DESC' },
    });
    expect(h.cards.save).toHaveBeenCalledTimes(1);
    expect(h.activities.record).toHaveBeenCalledTimes(2);
    expect(h.events.publish).toHaveBeenCalledTimes(2);
    expect(h.events.publish).toHaveBeenCalledWith(
      RealtimeServerEvent.CARD_CREATED,
      expect.objectContaining({ boardId: ID.board, columnId: ID.column }),
    );
    expect(h.events.publish.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.cards.save.mock.invocationCallOrder[0],
    );
  });

  it('TC06 all rows REJECTED: still authorises and checks the column, writes and publishes nothing', async () => {
    const result = await h.service.importCards(ID.user, ID.board, {
      columnId: ID.column,
      items: [{ title: '' }, null],
    });
    expect(result).toMatchObject({
      createdCount: 0,
      rejectedCount: 2,
      created: [],
    });
    expect(h.authorization.requireMember).toHaveBeenCalledWith(
      ID.user,
      ID.board,
      { mutable: true },
      h.manager,
    );
    expect(h.columns.findOne).toHaveBeenCalled();
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('TC07 board ARCHIVED or column outside the board forbids ACCEPTED -> CREATED', async () => {
    h.authorization.requireMember.mockRejectedValueOnce(
      Object.assign(new Error('Archived'), { status: 409 }),
    );
    await expect(
      h.service.importCards(ID.user, ID.board, {
        columnId: ID.column,
        items: [{ title: 'A' }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    h.columns.findOne.mockResolvedValueOnce(null);
    await expect(
      h.service.importCards(ID.user, ID.board, {
        columnId: ID.column,
        items: [{ title: 'A' }],
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.cards.save).not.toHaveBeenCalled();
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('TC08 failure path: a write error rolls the batch back (ACCEPTED -> ROLLED_BACK) and publishes nothing', async () => {
    h.activities.record
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      h.service.importCards(ID.user, ID.board, {
        columnId: ID.column,
        items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      }),
    ).rejects.toThrow('database unavailable');
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.events.publish).not.toHaveBeenCalled();
  });

  it('TC09 rebalances the column once when appending overflows NUMERIC(20,10)', async () => {
    const full = cardFixture({ position: '9999999999.9999999999' });
    h.cards.findOne.mockResolvedValue(full);
    h.cards.find.mockResolvedValue([full]);
    const result = await h.service.importCards(ID.user, ID.board, {
      columnId: ID.column,
      items: [{ title: 'A' }, { title: 'B' }],
    });
    expect(result.created.map((card) => card.position)).toEqual([
      '200.0000000000',
      '300.0000000000',
    ]);
    expect(h.cards.save).toHaveBeenCalledTimes(1);
    expect(h.cards.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: full.id, position: '100.0000000000' }),
      expect.objectContaining({ title: 'A' }),
      expect.objectContaining({ title: 'B' }),
    ]);
  });
});
