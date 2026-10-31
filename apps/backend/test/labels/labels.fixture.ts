import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { checklistHarness, ID } from '../card-checklists/checklists.fixture';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardLabel } from '../../src/api/cards/entities/card-label.entity';
import { BoardLabel } from '../../src/api/labels/entities/board-label.entity';
import { LabelsService } from '../../src/api/labels/labels.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
export { ID };

export function labelsHarness() {
  const base = checklistHarness(),
    labels = new Map<string, BoardLabel>(),
    links = new Map<string, CardLabel>();
  const matches = (row: object, where: object) =>
    Object.entries(where).every(
      ([key, value]) =>
        String((row as Record<string, unknown>)[key]).toLowerCase() ===
        String(value).toLowerCase(),
    );
  const sorted = () =>
    [...labels.values()].sort(
      (a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.id.localeCompare(b.id),
    );
  const labelRepository = {
    create: jest.fn((input: Partial<BoardLabel>) =>
      Object.assign(
        new BoardLabel(),
        { id: randomUUID(), createdAt: new Date(), updatedAt: new Date() },
        input,
      ),
    ),
    save: jest.fn(async (row: BoardLabel) => {
      row.updatedAt = new Date();
      labels.set(row.id, structuredClone(row));
      return row;
    }),
    findOneBy: jest.fn(async (where: object) => {
      const row = [...labels.values()].find((row) => matches(row, where));
      return row ? structuredClone(row) : null;
    }),
    countBy: jest.fn(
      async (where: object) =>
        [...labels.values()].filter((row) => matches(row, where)).length,
    ),
    delete: jest.fn(async (where: object) => {
      let affected = 0;
      for (const row of labels.values())
        if (matches(row, where)) {
          labels.delete(row.id);
          affected++;
          for (const [key, link] of links)
            if (link.labelId === row.id) links.delete(key);
        }
      return { affected };
    }),
    createQueryBuilder: jest.fn(() => {
      const params: Record<string, unknown> = {};
      let skip = 0,
        take = 100;
      const rows = () =>
        sorted().filter((row) => row.boardId === params.boardId);
      const builder = {
        where: (_sql: string, values: object) => {
          Object.assign(params, values);
          return builder;
        },
        andWhere: (_sql: string, values: object) => {
          Object.assign(params, values);
          return builder;
        },
        orderBy: () => builder,
        addOrderBy: () => builder,
        skip: (n: number) => {
          skip = n;
          return builder;
        },
        take: (n: number) => {
          take = n;
          return builder;
        },
        getManyAndCount: async () => [
          rows()
            .slice(skip, skip + take)
            .map((row) => structuredClone(row)),
          rows().length,
        ],
        getExists: async () =>
          rows().some(
            (row) =>
              row.name.toLowerCase() === String(params.name).toLowerCase() &&
              row.id !== params.excludingId,
          ),
      };
      return builder;
    }),
  };
  const linkRepository = {
    create: jest.fn((input: Partial<CardLabel>) =>
      Object.assign(new CardLabel(), { createdAt: new Date() }, input),
    ),
    save: jest.fn(async (row: CardLabel) => {
      links.set(`${row.cardId}:${row.labelId}`, structuredClone(row));
      return row;
    }),
    findOneBy: jest.fn(
      async (where: object) =>
        [...links.values()].find((row) => matches(row, where)) ?? null,
    ),
    delete: jest.fn(async (where: object) => {
      let affected = 0;
      for (const [key, row] of links)
        if (matches(row, where)) {
          links.delete(key);
          affected++;
        }
      return { affected };
    }),
    createQueryBuilder: jest.fn(() => {
      const params: Record<string, unknown> = {};
      let limit = 20000;
      const builder = {
        innerJoinAndSelect: () => builder,
        where: (_sql: string, values: object) => {
          Object.assign(params, values);
          return builder;
        },
        andWhere: (_sql: string, values: object) => {
          Object.assign(params, values);
          return builder;
        },
        orderBy: () => builder,
        addOrderBy: () => builder,
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        getMany: async () =>
          [...links.values()]
            .filter(
              (row) =>
                row.boardId === params.boardId &&
                (params.ids as string[]).includes(row.cardId),
            )
            .map((row) => ({ ...row, label: labels.get(row.labelId)! }))
            .sort(
              (a, b) =>
                a.cardId.localeCompare(b.cardId) ||
                a.label.name
                  .toLowerCase()
                  .localeCompare(b.label.name.toLowerCase()) ||
                a.labelId.localeCompare(b.labelId),
            )
            .slice(0, limit),
      };
      return builder;
    }),
  };
  const getRepository = base.manager.getRepository;
  const cards = base.repository(Card);
  const cardRepository = {
    ...cards,
    findOneBy: jest.fn(async (where: object) =>
      cards.findOne({ where: where as Record<string, unknown> }),
    ),
  };
  cardRepository.find.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      [...base.store(Card).values()].filter(
        (card) =>
          card.boardId === where.boardId &&
          (where.id as { value: string[] }).value.includes(card.id),
      ),
  );
  base.manager.getRepository = (entity: unknown) =>
    (entity === BoardLabel
      ? labelRepository
      : entity === CardLabel
        ? linkRepository
        : entity === Card
          ? cardRepository
          : getRepository(entity)) as ReturnType<typeof getRepository>;
  const service = new LabelsService(
    base.repository(Board) as unknown as Repository<Board>,
    base.authorization,
    base.events as unknown as BoardEventPublisher,
  );
  return { ...base, service, labels, links, labelRepository, linkRepository };
}
