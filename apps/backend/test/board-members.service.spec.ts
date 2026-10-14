import { Test } from '@nestjs/testing';
import { Inject } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BoardMembersService } from '../src/api/board-members/board-members.service';
import { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';
import { BoardMember } from '../src/api/board-members/entities/board-member.entity';
import { Board } from '../src/api/boards/entities/board.entity';
import { CardAssignee } from '../src/api/cards/entities/card-assignee.entity';
import { User } from '../src/api/users/entities/user.entity';
import { BoardMemberRole } from '../src/common/enums/database-enums';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
  getRepositoryToken: (entity: { name: string }) => `${entity.name}Repository`,
}));

const ACTOR_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const TARGET_ID = '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const board = Object.assign(new Board(), {
  id: BOARD_ID,
  createdById: ACTOR_ID,
  isArchived: false,
});
const target = Object.assign(new User(), {
  id: TARGET_ID,
  email: 'member@example.com',
  displayName: 'Member',
  avatarUrl: null,
  createdAt: new Date('2026-10-13T00:00:00Z'),
  updatedAt: new Date('2026-10-13T00:00:00Z'),
});

describe('BoardMembersService', () => {
  const txMembers = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  };
  const txUsers = { findOne: jest.fn() };
  const query = {
    delete: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    execute: jest.fn(),
  };
  const txAssignments = { createQueryBuilder: jest.fn() };
  const manager = { getRepository: jest.fn() };
  const transaction = jest.fn();
  const members = { createQueryBuilder: jest.fn() };
  const users = {};
  const boards = { manager: { transaction } };
  const assignments = {};
  const authorization = {
    requireMember: jest.fn(),
    requireMutableOwner: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    manager.getRepository.mockImplementation((entity) => {
      if (entity === BoardMember) return txMembers;
      if (entity === User) return txUsers;
      return txAssignments;
    });
    transaction.mockImplementation(async (callback) => callback(manager));
    txAssignments.createQueryBuilder.mockReturnValue(query);
    query.delete.mockReturnValue(query);
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.andWhere.mockReturnValue(query);
    query.execute.mockResolvedValue({ affected: 2 });
    authorization.requireMutableOwner.mockResolvedValue({
      board,
      member: { role: BoardMemberRole.OWNER },
    });
    const module = await Test.createTestingModule({
      providers: [
        BoardMembersService,
        { provide: getRepositoryToken(BoardMember), useValue: members },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Board), useValue: boards },
        { provide: getRepositoryToken(CardAssignee), useValue: assignments },
        { provide: BoardAuthorizationService, useValue: authorization },
      ],
    }).compile();
    service = module.get(BoardMembersService);
  });

  let service: BoardMembersService;

  it('adds a registered user as MEMBER using normalized email', async () => {
    const member = Object.assign(new BoardMember(), {
      id: 'member-row',
      boardId: BOARD_ID,
      userId: TARGET_ID,
      user: target,
      role: BoardMemberRole.MEMBER,
      joinedAt: new Date('2026-10-14T00:00:00Z'),
    });
    txUsers.findOne.mockResolvedValue(target);
    txMembers.findOne.mockResolvedValue(null);
    txMembers.create.mockReturnValue(member);
    txMembers.save.mockResolvedValue(member);

    const result = await service.add(ACTOR_ID, BOARD_ID, {
      email: '  MEMBER@EXAMPLE.COM ',
    });

    expect(txUsers.findOne).toHaveBeenCalledWith({
      where: { email: 'member@example.com' },
    });
    expect(txMembers.create).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      userId: TARGET_ID,
      role: BoardMemberRole.MEMBER,
      user: target,
    });
    expect(result.role).toBe(BoardMemberRole.MEMBER);
  });

  it('rejects demoting the creator and preserves the transaction write set', async () => {
    const creator = Object.assign(new BoardMember(), {
      userId: ACTOR_ID,
      role: BoardMemberRole.OWNER,
      user: target,
    });
    txMembers.findOne.mockResolvedValue(creator);

    await expect(
      service.updateRole(ACTOR_ID, BOARD_ID, ACTOR_ID, {
        role: BoardMemberRole.MEMBER,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(txMembers.save).not.toHaveBeenCalled();
  });

  it('promotes a member and allows demotion while another OWNER remains', async () => {
    const member = Object.assign(new BoardMember(), {
      id: 'member-row',
      userId: TARGET_ID,
      user: target,
      role: BoardMemberRole.MEMBER,
      joinedAt: new Date('2026-10-14T00:00:00Z'),
    });
    txMembers.findOne.mockResolvedValue(member);
    txMembers.count.mockResolvedValue(2);
    txMembers.save.mockImplementation(async (value) => value);

    await expect(
      service.updateRole(ACTOR_ID, BOARD_ID, TARGET_ID, {
        role: BoardMemberRole.OWNER,
      }),
    ).resolves.toMatchObject({ role: BoardMemberRole.OWNER });
    member.role = BoardMemberRole.OWNER;
    await expect(
      service.updateRole(ACTOR_ID, BOARD_ID, TARGET_ID, {
        role: BoardMemberRole.MEMBER,
      }),
    ).resolves.toMatchObject({ role: BoardMemberRole.MEMBER });
  });

  it('rejects demoting the last OWNER', async () => {
    const owner = Object.assign(new BoardMember(), {
      id: 'owner-row',
      userId: TARGET_ID,
      user: target,
      role: BoardMemberRole.OWNER,
      joinedAt: new Date('2026-10-14T00:00:00Z'),
    });
    txMembers.findOne.mockResolvedValue(owner);
    txMembers.count.mockResolvedValue(1);

    await expect(
      service.updateRole(ACTOR_ID, BOARD_ID, TARGET_ID, {
        role: BoardMemberRole.MEMBER,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(txMembers.save).not.toHaveBeenCalled();
  });

  it('removes assignments before the member row in one transaction', async () => {
    const member = Object.assign(new BoardMember(), {
      id: 'member-row',
      userId: TARGET_ID,
      role: BoardMemberRole.MEMBER,
    });
    txMembers.findOne.mockResolvedValue(member);
    await service.remove(ACTOR_ID, BOARD_ID, TARGET_ID);

    expect(query.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: TARGET_ID,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'card_id IN (SELECT id FROM "cards" WHERE "board_id" = :boardId)',
      { boardId: BOARD_ID },
    );
    expect(txMembers.delete).toHaveBeenCalledWith({ id: 'member-row' });
  });

  it('does not remove membership when assignment cleanup fails', async () => {
    txMembers.findOne.mockResolvedValue(
      Object.assign(new BoardMember(), {
        id: 'member-row',
        userId: TARGET_ID,
        role: BoardMemberRole.MEMBER,
      }),
    );
    query.execute.mockRejectedValue(new Error('cleanup failed'));

    await expect(service.remove(ACTOR_ID, BOARD_ID, TARGET_ID)).rejects.toThrow(
      'cleanup failed',
    );
    expect(txMembers.delete).not.toHaveBeenCalled();
  });
});
