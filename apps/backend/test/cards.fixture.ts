import { Repository } from 'typeorm';
import { Card } from '../src/api/cards/entities/card.entity';
import { Board } from '../src/api/boards/entities/board.entity';
import { BoardColumn } from '../src/api/columns/entities/board-column.entity';
import { CardAssignee } from '../src/api/cards/entities/card-assignee.entity';
import { BoardMember } from '../src/api/board-members/entities/board-member.entity';
import { CardsService } from '../src/api/cards/cards.service';
import { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';

export const CARD_IDS = {
  user: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  target: '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  board: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  column: 'd6ba7134-97ef-4c1b-a342-001a982a7721',
  secondColumn: 'e6ba7134-97ef-4c1b-a342-001a982a7721',
  card: 'a6ba7134-97ef-4c1b-a342-001a982a7721',
};

export function cardFixture(overrides: Partial<Card> = {}): Card {
  return Object.assign(
    new Card(),
    {
      id: CARD_IDS.card,
      boardId: CARD_IDS.board,
      columnId: CARD_IDS.column,
      createdById: CARD_IDS.user,
      title: 'Card',
      description: null,
      position: '100.0000000000',
      isArchived: false,
      dueDate: null,
      archivedAt: null,
      createdAt: new Date('2026-10-16T00:00:00Z'),
      updatedAt: new Date('2026-10-16T00:00:00Z'),
      assignees: [],
    },
    overrides,
  );
}

export function cardsHarness() {
  const cards = {
    findOne: jest.fn().mockResolvedValue(cardFixture()),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((input) => cardFixture(input)),
    save: jest.fn(async (input) => input),
    createQueryBuilder: jest.fn(),
  };
  const columns = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: CARD_IDS.column, boardId: CARD_IDS.board }),
  };
  const assignees = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((input) => ({
      ...input,
      createdAt: new Date('2026-10-16T00:00:00Z'),
    })),
    save: jest.fn(async (value) => value),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const members = {
    findOne: jest.fn().mockResolvedValue({ userId: CARD_IDS.target }),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Card
        ? cards
        : entity === BoardColumn
          ? columns
          : entity === CardAssignee
            ? assignees
            : entity === BoardMember
              ? members
              : {},
    ),
  };
  const transaction = jest.fn(async (callback) => callback(manager));
  const boards = { manager: { transaction } };
  const authorization = {
    requireMember: jest
      .fn()
      .mockResolvedValue({ board: { isArchived: false } }),
  };
  const builder = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[cardFixture()], 1]),
  };
  cards.createQueryBuilder.mockReturnValue(builder);
  const service = new CardsService(
    cards as unknown as Repository<Card>,
    boards as unknown as Repository<Board>,
    columns as unknown as Repository<BoardColumn>,
    authorization as unknown as BoardAuthorizationService,
  );
  return {
    service,
    cards,
    columns,
    members,
    assignees,
    manager,
    transaction,
    authorization,
    builder,
  };
}
