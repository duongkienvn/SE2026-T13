import { Repository } from 'typeorm';
import { Board } from '../src/api/boards/entities/board.entity';
import { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';
import { Card } from '../src/api/cards/entities/card.entity';
import { Comment } from '../src/api/comments/entities/comment.entity';
import { CommentsService } from '../src/api/comments/comments.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

const ID = {
  user: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  other: '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  board: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  card: 'a6ba7134-97ef-4c1b-a342-001a982a7721',
  comment: 'b6ba7134-97ef-4c1b-a342-001a982a7721',
};

function commentFixture(overrides: Partial<Comment> = {}): Comment {
  return Object.assign(new Comment(), {
    id: ID.comment,
    cardId: ID.card,
    authorId: ID.user,
    content: 'Original',
    createdAt: new Date('2026-10-16T00:00:00Z'),
    updatedAt: new Date('2026-10-16T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });
}

function cardFixture(overrides: Partial<Card> = {}): Card {
  return Object.assign(new Card(), {
    id: ID.card,
    boardId: ID.board,
    isArchived: false,
    ...overrides,
  });
}

function harness() {
  const comments = {
    findOne: jest.fn().mockResolvedValue(commentFixture()),
    create: jest.fn((input) => commentFixture(input)),
    save: jest.fn(async (input) => input),
    softRemove: jest.fn(async (input) => {
      input.deletedAt = new Date('2026-10-16T01:00:00Z');
      return input;
    }),
    createQueryBuilder: jest.fn(),
  };
  const cards = { findOne: jest.fn().mockResolvedValue(cardFixture()) };
  const txBoards = {
    findOne: jest.fn().mockResolvedValue({ isArchived: false }),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Comment ? comments : entity === Card ? cards : txBoards,
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
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[commentFixture()], 1]),
  };
  comments.createQueryBuilder.mockReturnValue(builder);
  const service = new CommentsService(
    comments as unknown as Repository<Comment>,
    cards as unknown as Repository<Card>,
    boards as unknown as Repository<Board>,
    authorization as unknown as BoardAuthorizationService,
    {
      record: jest.fn(),
    } as unknown as import('../src/api/activities/activity-writer.service').ActivityWriterService,
  );
  return {
    service,
    comments,
    cards,
    boards,
    manager,
    transaction,
    authorization,
    builder,
  };
}

describe('CommentsService', () => {
  it('creates a comment after the board lock and scopes it to the card', async () => {
    const h = harness();

    await expect(
      h.service.create(ID.user, ID.board, ID.card, { content: ' Hello ' }),
    ).resolves.toMatchObject({
      cardId: ID.card,
      authorId: ID.user,
      content: ' Hello ',
    });
    expect(h.authorization.requireMember).toHaveBeenCalledWith(
      ID.user,
      ID.board,
      { mutable: true },
      h.manager,
    );
    expect(h.comments.create).toHaveBeenCalledWith({
      cardId: ID.card,
      authorId: ID.user,
      content: ' Hello ',
    });
  });

  it('lists active comments in stable ascending order with pagination', async () => {
    const h = harness();

    await expect(
      h.service.list(ID.user, ID.board, ID.card, { page: 2, limit: 20 }),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ id: ID.comment })],
      meta: { page: 2, limit: 20, total: 1, totalPages: 1 },
    });
    expect(h.builder.orderBy).toHaveBeenCalledWith('comment.createdAt', 'ASC');
    expect(h.builder.addOrderBy).toHaveBeenCalledWith('comment.id', 'ASC');
  });

  it('allows only the author to edit and soft-delete, without hard deletion', async () => {
    const h = harness();

    await expect(
      h.service.update(ID.user, ID.board, ID.card, ID.comment, {
        content: 'Edited',
      }),
    ).resolves.toMatchObject({ content: 'Edited' });
    h.comments.findOne.mockResolvedValueOnce(
      commentFixture({ authorId: ID.other }),
    );
    await expect(
      h.service.update(ID.user, ID.board, ID.card, ID.comment, {
        content: 'Denied',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      h.service.remove(ID.user, ID.board, ID.card, ID.comment),
    ).resolves.toBeUndefined();
    expect(h.comments.softRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID.comment }),
    );
  });

  it('rejects archived cards for mutations but keeps them readable', async () => {
    const h = harness();
    h.cards.findOne.mockResolvedValue(cardFixture({ isArchived: true }));

    await expect(
      h.service.create(ID.user, ID.board, ID.card, { content: 'No' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.service.list(ID.user, ID.board, ID.card, { page: 1, limit: 20 }),
    ).resolves.toBeDefined();
  });
});
