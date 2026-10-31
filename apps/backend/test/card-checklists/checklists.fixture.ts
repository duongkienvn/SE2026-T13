import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Board } from '../../src/api/boards/entities/board.entity';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardChecklist } from '../../src/api/cards/entities/card-checklist.entity';
import { CardChecklistItem } from '../../src/api/cards/entities/card-checklist-item.entity';
import { CardChecklistsService } from '../../src/api/cards/card-checklists.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';

export const ID: Record<string, string> = Object.fromEntries(
  [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
    'board',
    'foreignBoard',
    'card',
    'secondCard',
    'foreignCard',
    'column',
  ].map((key) => [key, randomUUID()]),
);
// Repository doubles exercise services/HTTP; only the PostgreSQL suite proves locks and SQL.
export function checklistHarness() {
  type Row = Record<string, unknown> & { id: string };
  const stores = new Map<unknown, Map<string, Row>>(
    [Board, BoardMember, Card, CardChecklist, CardChecklistItem].map(
      (entity) => [entity, new Map()],
    ),
  );
  const store = (entity: unknown) => stores.get(entity)!;
  store(Board).set(ID.board, {
    id: ID.board,
    isArchived: false,
    visibility: 'PRIVATE',
  });
  store(Board).set(ID.foreignBoard, {
    id: ID.foreignBoard,
    isArchived: false,
    visibility: 'PRIVATE',
  });
  for (const [id, boardId] of [
    [ID.card, ID.board],
    [ID.secondCard, ID.board],
    [ID.foreignCard, ID.foreignBoard],
  ])
    store(Card).set(id, {
      id,
      boardId,
      columnId: ID.column,
      isArchived: false,
    });
  for (const userId of [ID.owner, ID.member, ID.guest]) {
    const id = randomUUID();
    store(BoardMember).set(id, {
      id,
      boardId: ID.board,
      userId,
      role: userId === ID.owner ? 'OWNER' : 'MEMBER',
    });
  }
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([key, value]) =>
        String(row[key]).toLowerCase() === String(value).toLowerCase(),
    );
  const sorted = (rows: Row[]) =>
    rows.sort((a, b) => {
      const units = (value: unknown) =>
        BigInt(
          String(value ?? '0')
            .replace('.', '')
            .padEnd(11, '0'),
        );
      const left = units(a.position),
        right = units(b.position);
      return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    });
  const hydrate = (entity: unknown, row: Row) => {
    const copy = structuredClone(row);
    if (entity === CardChecklist)
      copy.items = sorted(
        [...store(CardChecklistItem).values()].filter(
          (item) => item.checklistId === row.id,
        ),
      ).map((item) => structuredClone(item));
    if (entity === BoardMember)
      copy.board = structuredClone(store(Board).get(String(row.boardId)));
    return copy;
  };
  const repositories = new Map<unknown, ReturnType<typeof repository>>();
  function repository(entity: unknown) {
    return {
      find: jest.fn(
        async ({
          where,
          take,
        }: {
          where: Record<string, unknown>;
          take?: number;
        }) =>
          sorted(
            [...store(entity).values()].filter((row) => matches(row, where)),
          )
            .slice(0, take)
            .map((row) => hydrate(entity, row)),
      ),
      findOne: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const row = [...store(entity).values()].find((row) =>
            matches(row, where),
          );
          return row ? hydrate(entity, row) : null;
        },
      ),
      create: jest.fn((input) => ({
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      })),
      save: jest.fn(async (input) => {
        for (const row of Array.isArray(input) ? input : [input]) {
          row.updatedAt = new Date();
          const copy = structuredClone(row);
          delete copy.items;
          store(entity).set(row.id, copy);
        }
        return input;
      }),
      delete: jest.fn(async (where: Record<string, unknown>) => {
        let affected = 0;
        for (const row of store(entity).values())
          if (matches(row, where)) {
            store(entity).delete(row.id);
            affected++;
            if (entity === CardChecklist)
              for (const item of store(CardChecklistItem).values())
                if (item.checklistId === row.id)
                  store(CardChecklistItem).delete(item.id);
          }
        return { affected };
      }),
      createQueryBuilder: jest.fn(() => {
        const params: Record<string, unknown> = {};
        const builder = {
          leftJoinAndSelect: () => builder,
          orderBy: () => builder,
          addOrderBy: () => builder,
          getMany: async () =>
            sorted(
              [...store(entity).values()].filter(
                (row) => row.cardId === params.cardId,
              ),
            )
              .slice(0, Number(params.maximum))
              .map((row) => hydrate(entity, row)),
          leftJoin: () => builder,
          select: () => builder,
          addSelect: () => builder,
          groupBy: () => builder,
          limit: () => builder,
          where: (_sql: string, values: Record<string, unknown>) => {
            Object.assign(params, values);
            return builder;
          },
          andWhere: (_sql: string, values: Record<string, unknown>) => {
            Object.assign(params, values);
            return builder;
          },
          getOne: async () => {
            const board = store(Board).get(String(params.boardId));
            return board?.visibility === 'WORKSPACE_VISIBLE' &&
              [ID.viewer, ID.admin].includes(String(params.userId))
              ? board
              : null;
          },
          getRawMany: async () =>
            [...store(Card).values()]
              .filter(
                (card) =>
                  card.boardId === params.boardId &&
                  (params.ids as string[]).includes(card.id),
              )
              .map((card) => {
                const ids = [...store(CardChecklist).values()]
                  .filter((row) => row.cardId === card.id)
                  .map((row) => row.id);
                const items = [...store(CardChecklistItem).values()].filter(
                  (item) => ids.includes(String(item.checklistId)),
                );
                return {
                  cardId: card.id,
                  checkedItems: String(
                    items.filter((item) => item.isChecked).length,
                  ),
                  totalItems: String(items.length),
                };
              }),
        };
        return builder;
      }),
    };
  }
  for (const entity of stores.keys())
    repositories.set(entity, repository(entity));
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity)!,
    transaction: jest.fn(async (callback): Promise<unknown> =>
      callback(manager),
    ),
  };
  for (const repo of repositories.values()) Object.assign(repo, { manager });
  const authorization = new BoardAuthorizationService(
    manager.getRepository(BoardMember) as unknown as Repository<BoardMember>,
  );
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new CardChecklistsService(
    manager.getRepository(Board) as unknown as Repository<Board>,
    authorization,
    events as unknown as BoardEventPublisher,
  );
  return {
    service,
    events,
    manager,
    authorization,
    store,
    repository: (entity: unknown) => manager.getRepository(entity),
  };
}
