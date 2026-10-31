import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { checklistHarness, ID } from '../card-checklists/checklists.fixture';
import { Board } from '../../src/api/boards/entities/board.entity';
import { CardAttachment } from '../../src/api/cards/entities/card-attachment.entity';
import { CardAttachmentsService } from '../../src/api/cards/card-attachments.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';

export { ID };
/** Reuse the established Board/member repository doubles; PostgreSQL proves SQL/locks. */
export function attachmentHarness() {
  const base = checklistHarness();
  const rows = new Map<string, CardAttachment>();
  const matches = (row: CardAttachment, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([key, value]) =>
        String(row[key as keyof CardAttachment]).toLowerCase() ===
        String(value).toLowerCase(),
    );
  const repository = {
    create: jest.fn(
      (input) =>
        ({
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...input,
        }) as CardAttachment,
    ),
    save: jest.fn(async (row: CardAttachment) => {
      row.updatedAt = new Date();
      rows.set(row.id, structuredClone(row));
      return row;
    }),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = [...rows.values()].find((row) => matches(row, where));
      return row ? structuredClone(row) : null;
    }),
    createQueryBuilder: jest.fn(() => {
      const params: Record<string, unknown> = {};
      let offset = 0,
        limit = 100;
      const where = (
        sql: string | Record<string, unknown>,
        values?: Record<string, unknown>,
      ) => {
        Object.assign(params, typeof sql === 'object' ? sql : values);
        return builder;
      };
      const filtered = () =>
        [...rows.values()].filter((row) => matches(row, params));
      const builder = {
        where,
        andWhere: where,
        select: () => builder,
        addSelect: () => builder,
        orderBy: () => builder,
        addOrderBy: () => builder,
        skip: (value: number) => {
          offset = value;
          return builder;
        },
        take: (value: number) => {
          limit = value;
          return builder;
        },
        getOne: async () => structuredClone(filtered()[0] ?? null),
        getManyAndCount: async () => {
          const values = filtered().sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          );
          return [
            structuredClone(values.slice(offset, offset + limit)),
            values.length,
          ] as const;
        },
        getRawOne: async () => {
          const reserved = [...rows.values()].filter(
            (row) =>
              row.boardId === params.boardId &&
              ['ACTIVE', 'PENDING'].includes(row.state),
          );
          return {
            cardSlots: String(
              reserved.filter((row) => row.cardId === params.cardId).length,
            ),
            boardFileBytes: String(
              reserved.reduce(
                (sum, row) =>
                  sum +
                  (row.kind === 'FILE'
                    ? BigInt(
                        row.state === 'PENDING'
                          ? row.reservedBytes!
                          : row.byteSize!,
                      )
                    : 0n),
                0n,
              ),
            ),
          };
        },
      };
      return builder;
    }),
  };
  const original = base.manager.getRepository;
  base.manager.getRepository = (entity) =>
    entity === CardAttachment
      ? (repository as unknown as ReturnType<typeof original>)
      : original(entity);
  const service = new CardAttachmentsService(
    base.repository(Board) as unknown as Repository<Board>,
    base.authorization,
    base.events as unknown as BoardEventPublisher,
  );
  return { ...base, service, rows, attachmentRepository: repository };
}
