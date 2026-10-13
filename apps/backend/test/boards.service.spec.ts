import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BoardsService } from '../src/api/boards/boards.service';
import { Board } from '../src/api/boards/entities/board.entity';
import { BoardMember } from '../src/api/board-members/entities/board-member.entity';
import { BoardMemberRole } from '../src/common/enums/database-enums';

const USER_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const boardFixture = () =>
  Object.assign(new Board(), {
    id: BOARD_ID,
    name: 'Board',
    description: null,
    createdById: USER_ID,
    isArchived: false,
    archivedAt: null,
    createdAt: new Date('2026-10-13T00:00:00Z'),
    updatedAt: new Date('2026-10-13T00:00:00Z'),
  });

describe('BoardsService', () => {
  let service: BoardsService;
  let board: Board;
  const txBoards = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const txMembers = { create: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const manager = { getRepository: jest.fn() };
  const transaction = jest.fn();
  const boards = { manager: { transaction }, createQueryBuilder: jest.fn() };
  const members = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    board = boardFixture();
    txBoards.create.mockImplementation((value) => value);
    txBoards.save.mockImplementation(async (value) =>
      Object.assign(board, value),
    );
    txMembers.create.mockImplementation((value) => value);
    txMembers.save.mockImplementation(async (value) => value);
    manager.getRepository.mockImplementation((entity) =>
      entity === Board ? txBoards : txMembers,
    );
    transaction.mockImplementation(async (callback) => callback(manager));
    const module = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: getRepositoryToken(Board), useValue: boards },
        { provide: getRepositoryToken(BoardMember), useValue: members },
      ],
    }).compile();
    service = module.get(BoardsService);
  });

  it('creates exactly one OWNER using only transaction-scoped repositories', async () => {
    const result = await service.create(USER_ID, { name: 'Board' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.getRepository.mock.calls).toEqual([[Board], [BoardMember]]);
    expect(txBoards.create).toHaveBeenCalledWith({
      name: 'Board',
      description: null,
      createdById: USER_ID,
    });
    expect(txMembers.save).toHaveBeenCalledTimes(1);
    expect(txMembers.create).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      userId: USER_ID,
      role: BoardMemberRole.OWNER,
    });
    expect(result).toMatchObject({
      id: BOARD_ID,
      currentUserRole: 'OWNER',
      createdAt: '2026-10-13T00:00:00.000Z',
    });
    expect(result).not.toHaveProperty('members');
  });

  it('propagates membership failure out of the transaction so TypeORM rolls back', async () => {
    const failure = new Error('Membership insert failed');
    txMembers.save.mockRejectedValue(failure);
    await expect(service.create(USER_ID, { name: 'Board' })).rejects.toBe(
      failure,
    );
    expect(txBoards.save).toHaveBeenCalledTimes(1);
    expect(txMembers.save).toHaveBeenCalledTimes(1);
  });

  it('does not attempt membership insertion if board persistence fails', async () => {
    txBoards.save.mockRejectedValue(new Error('Board insert failed'));
    await expect(service.create(USER_ID, { name: 'Board' })).rejects.toThrow(
      'Board insert failed',
    );
    expect(txMembers.save).not.toHaveBeenCalled();
  });

  it('ignores forged creator and role even when called outside HTTP validation', async () => {
    const input = {
      name: 'Board',
      createdById: 'attacker',
      currentUserRole: 'MEMBER',
    };
    await service.create(USER_ID, input);
    expect(txBoards.create).toHaveBeenCalledWith({
      name: 'Board',
      description: null,
      createdById: USER_ID,
    });
    expect(txMembers.create).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      userId: USER_ID,
      role: BoardMemberRole.OWNER,
    });
  });
});
