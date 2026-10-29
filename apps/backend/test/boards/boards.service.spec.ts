import { Test } from '@nestjs/testing';
import { Inject } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BoardsService } from '../../src/api/boards/boards.service';
import { Board } from '../../src/api/boards/entities/board.entity';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { BoardMemberRole } from '../../src/common/enums/database-enums';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { ActivityWriterService } from '../../src/api/activities/activity-writer.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { ActivityActionType } from '../../src/common/enums/database-enums';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { Workspace } from '../../src/api/workspaces/entities/workspace.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
  getRepositoryToken: (entity: { name: string }) => `${entity.name}Repository`,
}));

const USER_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const boardFixture = () =>
  Object.assign(new Board(), {
    id: BOARD_ID,
    name: 'Board',
    description: null,
    createdById: USER_ID,
    workspace: {
      boardInvitesEnabled: true,
      boardMembershipChangesEnabled: true,
    },
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
  const txWorkspace = { findOneByOrFail: jest.fn() };
  const manager = { getRepository: jest.fn() };
  const transaction = jest.fn();
  const boards = {
    manager: { transaction, getRepository: () => txWorkspace },
    createQueryBuilder: jest.fn(),
  };
  const readBoard = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const members = {
    findOne: jest.fn(),
    manager: { getRepository: () => ({ createQueryBuilder: () => readBoard }) },
  };
  const activities = { record: jest.fn() };
  const events = { publish: jest.fn() };
  const workspaces = {
    ensurePersonalWorkspace: jest.fn(),
    requireMember: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    board = boardFixture();
    readBoard.getOne.mockResolvedValue(null);
    readBoard.where.mockReturnThis();
    readBoard.innerJoinAndSelect.mockReturnThis();
    readBoard.andWhere.mockReturnThis();
    workspaces.ensurePersonalWorkspace.mockResolvedValue({
      id: 'personal-workspace',
    });
    workspaces.requireMember.mockResolvedValue({
      workspace: {
        id: 'personal-workspace',
        boardCreationAdminOnly: false,
        boardInvitesEnabled: true,
        boardMembershipChangesEnabled: true,
      },
    });
    txWorkspace.findOneByOrFail.mockResolvedValue({
      boardInvitesEnabled: true,
      boardMembershipChangesEnabled: true,
    });
    txBoards.create.mockImplementation((value) => value);
    txBoards.save.mockImplementation(async (value) =>
      Object.assign(board, value),
    );
    txMembers.create.mockImplementation((value) => value);
    txMembers.save.mockImplementation(async (value) => value);
    manager.getRepository.mockImplementation((entity) =>
      entity === Board
        ? txBoards
        : entity === Workspace
          ? txWorkspace
          : txMembers,
    );
    transaction.mockImplementation(async (callback) => callback(manager));
    const module = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: WorkspacesService, useValue: workspaces },
        BoardAuthorizationService,
        { provide: ActivityWriterService, useValue: activities },
        { provide: BoardEventPublisher, useValue: events },
        { provide: getRepositoryToken(Board), useValue: boards },
        { provide: getRepositoryToken(BoardMember), useValue: members },
      ],
    }).compile();
    service = module.get(BoardsService);
  });

  it('creates exactly one OWNER using only transaction-scoped repositories', async () => {
    const result = await service.create(USER_ID, { name: 'Board' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(workspaces.ensurePersonalWorkspace).toHaveBeenCalledWith(
      USER_ID,
      manager,
    );
    expect(manager.getRepository.mock.calls).toEqual([[Board], [BoardMember]]);
    expect(txBoards.create).toHaveBeenCalledWith({
      name: 'Board',
      description: null,
      createdById: USER_ID,
      workspaceId: 'personal-workspace',
      visibility: 'PRIVATE',
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

  it('returns policy-aware membership capabilities for owner detail, update and restore', async () => {
    txWorkspace.findOneByOrFail.mockResolvedValue({
      boardInvitesEnabled: false,
      boardMembershipChangesEnabled: false,
    });
    board.workspace = Object.assign(new Workspace(), {
      boardInvitesEnabled: false,
      boardMembershipChangesEnabled: false,
    });
    members.findOne.mockResolvedValue({ board, role: BoardMemberRole.OWNER });
    expect(
      (await service.getDetail(USER_ID, BOARD_ID)).capabilities
        .canManageMembers,
    ).toBe(false);
    txBoards.findOne.mockResolvedValue(board);
    txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
    expect(
      (await service.update(USER_ID, BOARD_ID, { name: 'Changed' }))
        .capabilities.canManageMembers,
    ).toBe(false);
    board.isArchived = true;
    expect(
      (await service.restore(USER_ID, BOARD_ID)).capabilities.canManageMembers,
    ).toBe(false);
  });

  it('filters by membership and archive state, uses stable ordering and preserves page metadata', async () => {
    const builder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          Object.assign(board, {
            members: [{ role: BoardMemberRole.MEMBER }],
          }),
        ],
        3,
      ]),
      expressionMap: {
        mainAlias: {
          name: 'board',
          metadata: {
            findColumnWithPropertyPath: () => ({ propertyPath: 'createdAt' }),
            primaryColumns: [{ propertyPath: 'id' }],
          },
        },
      },
    };
    boards.createQueryBuilder.mockReturnValue(builder);
    const result = await service.list(USER_ID, { page: 2, limit: 1 });
    expect(builder.leftJoinAndSelect).toHaveBeenCalledWith(
      'board.members',
      'member',
      'member.userId = :userId',
      { userId: USER_ID },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'board.isArchived = :isArchived',
      { isArchived: false },
    );
    expect(builder.orderBy).toHaveBeenCalledWith('board.createdAt', 'DESC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('board.id', 'DESC');
    expect(builder.skip).toHaveBeenCalledWith(1);
    expect(builder.take).toHaveBeenCalledWith(1);
    expect(builder.getManyAndCount).toHaveBeenCalledTimes(1);
    expect(result.meta).toEqual({ page: 2, limit: 1, total: 3, totalPages: 3 });
    expect(result.data[0].currentUserRole).toBe('MEMBER');
    expect(result.data[0]).not.toHaveProperty('members');
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
      visibility: 'WORKSPACE_VISIBLE',
    };
    await service.create(USER_ID, input);
    expect(txBoards.create).toHaveBeenCalledWith({
      name: 'Board',
      description: null,
      createdById: USER_ID,
      workspaceId: 'personal-workspace',
      visibility: 'PRIVATE',
    });
    expect(txMembers.create).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      userId: USER_ID,
      role: BoardMemberRole.OWNER,
    });
  });

  it.each([BoardMemberRole.OWNER, BoardMemberRole.MEMBER])(
    'allows %s to read persisted board role, including archived boards',
    async (role) => {
      board.isArchived = true;
      board.archivedAt = new Date();
      members.findOne.mockResolvedValue({ board, role });
      const result = await service.getDetail(USER_ID, BOARD_ID);
      expect(members.findOne).toHaveBeenCalledWith({
        where: { boardId: BOARD_ID, userId: USER_ID },
        relations: { board: true },
      });
      expect(result.currentUserRole).toBe(role);
      expect(result.isArchived).toBe(true);
    },
  );

  it('conceals missing and inaccessible boards', async () => {
    members.findOne.mockResolvedValue(null);
    await expect(service.getDetail(USER_ID, BOARD_ID)).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });

  it('updates only supplied fields and distinguishes null from omitted description', async () => {
    txBoards.findOne.mockResolvedValue(board);
    txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
    board.description = 'Keep';
    const input = {
      name: 'Changed',
      isArchived: true,
      createdById: 'attacker',
    };
    const result = await service.update(USER_ID, BOARD_ID, input);
    expect(result).toMatchObject({
      name: 'Changed',
      description: 'Keep',
      isArchived: false,
      createdById: USER_ID,
    });
    expect(txBoards.findOne).toHaveBeenCalledWith({
      where: { id: BOARD_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txMembers.findOne).toHaveBeenCalledWith({
      where: { boardId: BOARD_ID, userId: USER_ID },
    });
    expect(
      (await service.update(USER_ID, BOARD_ID, { description: null }))
        .description,
    ).toBeNull();
    expect(
      (await service.update(USER_ID, BOARD_ID, { description: '' }))
        .description,
    ).toBe('');
  });

  it('rejects an empty update before touching persistence', async () => {
    await expect(service.update(USER_ID, BOARD_ID, {})).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('archives through one save without deleting relations and rejects further writes', async () => {
    txBoards.findOne.mockResolvedValue(board);
    txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
    board.members = [
      Object.assign(new BoardMember(), { role: BoardMemberRole.OWNER }),
    ];
    const before = Date.now();
    const result = await service.archive(USER_ID, BOARD_ID);
    expect(result.isArchived).toBe(true);
    expect(Date.parse(result.archivedAt!)).toBeGreaterThanOrEqual(before);
    expect(board.members).toHaveLength(1);
    expect(txBoards.save).toHaveBeenCalledTimes(1);
    expect(activities.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actionType: ActivityActionType.BOARD_ARCHIVED,
        entityId: BOARD_ID,
        metadata: null,
      }),
    );
    expect(events.publish).toHaveBeenCalledTimes(1);
    const archivedAt = board.archivedAt;
    await expect(service.archive(USER_ID, BOARD_ID)).rejects.toMatchObject({
      status: 409,
      response: { code: 'BOARD_ARCHIVED' },
    });
    await expect(
      service.update(USER_ID, BOARD_ID, { name: 'No' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(board.archivedAt).toBe(archivedAt);
    expect(txBoards.save).toHaveBeenCalledTimes(1);
    expect(activities.record).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('restores only archived boards and records audit before publishing', async () => {
    board.isArchived = true;
    board.archivedAt = new Date();
    txBoards.findOne.mockResolvedValue(board);
    txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
    const result = await service.restore(USER_ID, BOARD_ID);
    expect(result).toMatchObject({
      isArchived: false,
      archivedAt: null,
      id: BOARD_ID,
    });
    expect(activities.record).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        actionType: ActivityActionType.BOARD_RESTORED,
        entityId: BOARD_ID,
        metadata: null,
      }),
    );
    expect(events.publish).toHaveBeenCalledWith('board:restored', {
      boardId: BOARD_ID,
    });
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      events.publish.mock.invocationCallOrder[0],
    );
    await expect(service.restore(USER_ID, BOARD_ID)).rejects.toMatchObject({
      status: 409,
      response: { code: 'BOARD_NOT_ARCHIVED' },
    });
    expect(activities.record).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('does not publish when activity recording fails inside the transaction', async () => {
    board.isArchived = true;
    board.archivedAt = new Date();
    txBoards.findOne.mockResolvedValue(board);
    txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
    activities.record.mockRejectedValue(new Error('Audit failed'));
    await expect(service.restore(USER_ID, BOARD_ID)).rejects.toThrow(
      'Audit failed',
    );
    expect(events.publish).not.toHaveBeenCalled();
  });

  it.each(['update', 'archive'] as const)(
    'enforces role, membership, existence and archive state on %s',
    async (operation) => {
      const execute = () =>
        operation === 'update'
          ? service.update(USER_ID, BOARD_ID, { name: 'Changed' })
          : service.archive(USER_ID, BOARD_ID);
      txBoards.findOne.mockResolvedValue(null);
      await expect(execute()).rejects.toMatchObject({ status: 404 });
      txBoards.findOne.mockResolvedValue(board);
      txMembers.findOne.mockResolvedValue(null);
      await expect(execute()).rejects.toMatchObject({ status: 404 });
      txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.MEMBER });
      await expect(execute()).rejects.toMatchObject({ status: 403 });
      txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
      board.isArchived = true;
      await expect(execute()).rejects.toMatchObject({ status: 409 });
      expect(txBoards.save).not.toHaveBeenCalled();
    },
  );

  it.each(['update', 'archive'] as const)(
    'propagates persistence failures from %s',
    async (operation) => {
      txBoards.findOne.mockResolvedValue(board);
      txMembers.findOne.mockResolvedValue({ role: BoardMemberRole.OWNER });
      txBoards.save.mockRejectedValue(new Error('Persistence failed'));
      const result =
        operation === 'update'
          ? service.update(USER_ID, BOARD_ID, { name: 'Changed' })
          : service.archive(USER_ID, BOARD_ID);
      await expect(result).rejects.toThrow('Persistence failed');
    },
  );
});
