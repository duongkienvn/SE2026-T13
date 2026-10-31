import { randomUUID } from 'node:crypto';
import { EntityManager, Repository } from 'typeorm';
import { attachmentHarness, ID } from './attachments.fixture';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardAttachment } from '../../src/api/cards/entities/card-attachment.entity';
import { CardAttachmentsService } from '../../src/api/cards/card-attachments.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { RealtimeBroadcastService } from '../../src/realtime/realtime-broadcast.service';
import { attachmentQuotaUsage } from '../../src/api/cards/attachments/attachment-policy';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('attachment mutations', () => {
  let h: ReturnType<typeof attachmentHarness>;
  const create = (key?: string) =>
    h.service.create(
      ID.owner,
      ID.board,
      ID.card,
      { kind: 'URL', url: 'HTTPS://Example.com:443/doc' },
      key,
    );
  beforeEach(() => {
    h = attachmentHarness();
  });
  it('normalizes, owns and idempotently replays while isolating the request key', async () => {
    const key = randomUUID();
    const first = await create(key);
    expect(first).toMatchObject({
      kind: 'URL',
      state: 'ACTIVE',
      url: 'https://example.com/doc',
      displayName: 'example.com',
      uploaderId: ID.owner,
      revision: 1,
    });
    expect(await create(key)).toEqual(first);
    expect(h.events.publish).toHaveBeenCalledTimes(1);
    await expect(
      h.service.create(
        ID.owner,
        ID.board,
        ID.card,
        { kind: 'URL', url: 'https://different.example/' },
        key,
      ),
    ).rejects.toMatchObject({
      response: { code: 'ATTACHMENT_IDEMPOTENCY_CONFLICT' },
    });
    await h.service.create(
      ID.member,
      ID.board,
      ID.card,
      { kind: 'URL', url: 'https://example.com/doc' },
      key,
    );
    expect(h.rows.size).toBe(2);
    await h.service.remove(ID.member, ID.board, ID.card, first.id);
    await expect(create(key)).rejects.toMatchObject({
      response: { code: 'ATTACHMENT_REMOVED' },
    });
    await expect(create('not-a-key')).rejects.toMatchObject({ status: 400 });
  });
  it('serializes partial edits and protects stale revisions; normalized no-ops stay silent', async () => {
    const first = await create();
    const same = await h.service.update(ID.guest, ID.board, ID.card, first.id, {
      expectedRevision: 1,
      url: 'https://EXAMPLE.com:443/doc',
    });
    expect(same.revision).toBe(1);
    expect(h.events.publish).toHaveBeenCalledTimes(1);
    const changed = await h.service.update(
      ID.member,
      ID.board,
      ID.card,
      first.id,
      { expectedRevision: 1, displayName: ' New ' },
    );
    expect(changed).toMatchObject({
      displayName: 'New',
      url: first.url,
      revision: 2,
    });
    await expect(
      h.service.update(ID.owner, ID.board, ID.card, first.id, {
        expectedRevision: 1,
        displayName: 'stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.update(ID.owner, ID.board, ID.card, first.id, {
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      h.service.update(ID.owner, ID.board, ID.card, first.id, {
        expectedRevision: 2,
        url: 'data:x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.rows.get(first.id)?.displayName).toBe('New');
    await expect(
      h.service.remove(ID.owner, ID.board, ID.card, first.id, 1),
    ).rejects.toMatchObject({ status: 409 });
    await h.service.remove(ID.owner, ID.board, ID.card, first.id, 2);
    const events = h.events.publish.mock.calls.length;
    await h.service.remove(ID.guest, ID.board, ID.card, first.id, 2);
    expect(h.events.publish).toHaveBeenCalledTimes(events);
  });
  it('counts pending reservations, hides unfinished assets, and releases removed URL slots', async () => {
    const first = await create();
    for (let i = 0; i < 19; i++) {
      const id = randomUUID();
      h.rows.set(id, {
        ...h.rows.get(first.id)!,
        id,
        kind: 'FILE',
        state: 'PENDING',
        reservedBytes: '100',
        expiresAt: new Date(0),
      });
    }
    await expect(create()).rejects.toMatchObject({
      response: { code: 'ATTACHMENT_LIMIT_REACHED' },
    });
    expect(
      await attachmentQuotaUsage(
        h.manager as unknown as EntityManager,
        ID.board,
        ID.card,
      ),
    ).toEqual({ cardSlots: 20n, boardFileBytes: 1900n });
    expect(
      (
        await h.service.list(ID.owner, ID.board, ID.card, {
          page: 1,
          limit: 20,
        })
      ).data,
    ).toHaveLength(1);
    const hidden = [...h.rows.values()].find((row) => row.state === 'PENDING')!;
    await expect(
      h.service.get(ID.owner, ID.board, ID.card, hidden.id),
    ).rejects.toMatchObject({ status: 404 });
    await h.service.remove(ID.owner, ID.board, ID.card, first.id);
    await expect(create()).resolves.toBeDefined();
  });
  it('enforces Card/Board isolation, archived mutation rules and read-only access', async () => {
    const row = await create();
    await expect(
      h.service.get(ID.owner, ID.board, ID.secondCard, row.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.list(ID.owner, ID.board, ID.foreignCard, {
        page: 1,
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.list(ID.admin, ID.board, ID.card, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ status: 404 });
    h.store(Board).get(ID.board)!.visibility = 'WORKSPACE_VISIBLE';
    await expect(
      h.service.get(ID.viewer, ID.board, ID.card, row.id),
    ).resolves.toMatchObject({ id: row.id });
    await expect(
      h.service.remove(ID.viewer, ID.board, ID.card, row.id),
    ).rejects.toMatchObject({ status: 404 });
    h.store(Card).get(ID.card)!.isArchived = true;
    await expect(create()).rejects.toMatchObject({
      response: { code: 'CARD_ARCHIVED' },
    });
    await expect(
      h.service.get(ID.guest, ID.board, ID.card, row.id),
    ).resolves.toBeDefined();
    h.store(Board).get(ID.board)!.isArchived = true;
    await expect(
      h.service.remove(ID.owner, ID.board, ID.card, row.id),
    ).rejects.toMatchObject({ response: { code: 'BOARD_ARCHIVED' } });
  });
  it('rejects file mutations without intents, grants, metadata or events', async () => {
    await expect(
      h.service.create(ID.owner, ID.board, ID.card, { kind: 'FILE' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.rows.size).toBe(0);
    expect(h.events.publish).not.toHaveBeenCalled();
    await expect(
      h.service.create(ID.outsider, ID.board, ID.card, { kind: 'FILE' }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('publishes IDs once after the transaction completes, and handles broadcaster failure', async () => {
    let inside = false;
    h.manager.transaction.mockImplementation(async (operation) => {
      inside = true;
      try {
        return await operation(h.manager);
      } finally {
        inside = false;
      }
    });
    h.events.publish.mockImplementation(async (event, payload) => {
      expect(inside).toBe(false);
      expect(event).toBe('card:updated');
      expect(payload).toEqual({
        boardId: ID.board,
        cardId: ID.card,
        columnId: ID.column,
      });
    });
    await create();
    expect(h.repository(Board).findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    const broadcast = {
      emitToBoard: jest.fn().mockRejectedValue(new Error('offline')),
    };
    const service = new CardAttachmentsService(
      h.repository(Board) as unknown as Repository<Board>,
      h.authorization,
      new BoardEventPublisher(broadcast as unknown as RealtimeBroadcastService),
    );
    await expect(
      service.create(ID.owner, ID.board, ID.card, {
        kind: 'URL',
        url: 'https://example.com/new',
      }),
    ).resolves.toBeDefined();
  });
  it('uses deterministic pages and rejects unsafe pagination', async () => {
    await create();
    await create();
    for (const row of h.rows.values()) row.createdAt = new Date(0);
    const first = await h.service.list(ID.member, ID.board, ID.card, {
      page: 1,
      limit: 1,
    });
    const second = await h.service.list(ID.guest, ID.board, ID.card, {
      page: 2,
      limit: 1,
    });
    expect(first.meta.total).toBe(2);
    expect(first.data[0].id > second.data[0].id).toBe(true);
    await expect(
      h.service.list(ID.owner, ID.board, ID.card, {
        page: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
