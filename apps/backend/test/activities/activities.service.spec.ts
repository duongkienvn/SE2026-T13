import type { EntityManager, Repository } from 'typeorm';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../src/common/enums/database-enums';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { Activity } from '../../src/api/activities/entities/activity.entity';
import {
  ActivityRecordValidationError,
  RecordActivityInput,
} from '../../src/api/activities/activity-recorder';
import { ActivitiesService } from '../../src/api/activities/activities.service';
import { ActivityWriterService } from '../../src/api/activities/activity-writer.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

const ID = {
  actor: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  board: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  otherBoard: 'd6ba7134-97ef-4c1b-a342-001a982a7721',
  column: 'a6ba7134-97ef-4c1b-a342-001a982a7721',
  card: 'b6ba7134-97ef-4c1b-a342-001a982a7721',
};

function activityFixture(overrides: Partial<Activity> = {}): Activity {
  return Object.assign(new Activity(), {
    id: 'e6ba7134-97ef-4c1b-a342-001a982a7721',
    boardId: ID.board,
    actorId: ID.actor,
    actionType: ActivityActionType.CARD_MOVED,
    entityType: ActivityEntityType.CARD,
    entityId: ID.card,
    metadata: { fromColumnId: ID.column, toColumnId: ID.column },
    createdAt: new Date('2026-10-16T12:00:00.000Z'),
    ...overrides,
  });
}

function validRecord(
  overrides: Partial<RecordActivityInput> = {},
): RecordActivityInput {
  return {
    boardId: ID.board,
    actorId: ID.actor,
    actionType: ActivityActionType.CARD_MOVED,
    entityType: ActivityEntityType.CARD,
    entityId: ID.card,
    metadata: { fromColumnId: ID.column, toColumnId: ID.column },
    ...overrides,
  };
}

function harness() {
  const activityRepository = {
    create: jest.fn((input: Partial<Activity>) =>
      Object.assign(new Activity(), input),
    ),
    save: jest.fn(async (activity: Activity) => activity),
    createQueryBuilder: jest.fn(),
  };
  const builder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[activityFixture()], 1]),
  };
  activityRepository.createQueryBuilder.mockReturnValue(builder);
  const authorization = {
    requireRead: jest.fn().mockResolvedValue({ board: { isArchived: true } }),
  };
  const manager = {
    getRepository: jest.fn().mockReturnValue(activityRepository),
  };
  const service = new ActivitiesService(
    activityRepository as unknown as Repository<Activity>,
    authorization as unknown as BoardAuthorizationService,
    new ActivityWriterService(),
  );
  return { service, activityRepository, authorization, manager, builder };
}

describe('ActivitiesService', () => {
  it('filters membership administration before counting a Workspace viewer feed', async () => {
    const h = harness();
    h.authorization.requireRead.mockResolvedValue({ member: null });
    await h.service.list(ID.actor, ID.board, { page: 1, limit: 20 });
    expect(h.builder.andWhere).toHaveBeenCalledWith(
      'activity.entityType <> :memberEntityType',
      { memberEntityType: 'MEMBER' },
    );
    expect(h.builder.andWhere.mock.invocationCallOrder[0]).toBeLessThan(
      h.builder.getManyAndCount.mock.invocationCallOrder[0],
    );
  });
  it('lists only the requested board in newest-first deterministic order', async () => {
    const h = harness();

    await expect(
      h.service.list(ID.actor, ID.board, { page: 2, limit: 20 }),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ boardId: ID.board })],
      meta: { page: 2, limit: 20, total: 1, totalPages: 1 },
    });
    expect(h.authorization.requireRead).toHaveBeenCalledWith(
      ID.actor,
      ID.board,
    );
    expect(h.builder.where).toHaveBeenCalledWith(
      'activity.boardId = :boardId',
      { boardId: ID.board },
    );
    expect(h.builder.orderBy).toHaveBeenCalledWith(
      'activity.createdAt',
      'DESC',
    );
    expect(h.builder.addOrderBy).toHaveBeenCalledWith('activity.id', 'DESC');
    expect(h.builder.skip).toHaveBeenCalledWith(20);
  });

  it('records through the caller transaction manager and never sets createdAt from input', async () => {
    const h = harness();

    await expect(
      h.service.record(h.manager as unknown as EntityManager, validRecord()),
    ).resolves.toBeUndefined();
    expect(h.manager.getRepository).toHaveBeenCalledWith(Activity);
    expect(h.activityRepository.create).toHaveBeenCalledWith({
      boardId: ID.board,
      actorId: ID.actor,
      actionType: ActivityActionType.CARD_MOVED,
      entityType: ActivityEntityType.CARD,
      entityId: ID.card,
      metadata: { fromColumnId: ID.column, toColumnId: ID.column },
    });
    expect(h.activityRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe or mismatched writer input', async () => {
    const h = harness();
    const nestedMetadata = validRecord();
    if (nestedMetadata.metadata) {
      Object.assign(nestedMetadata.metadata, {
        toColumnId: { secret: 'no' },
      });
    }
    const inputs = [
      validRecord({ entityType: ActivityEntityType.BOARD }),
      nestedMetadata,
      validRecord({
        metadata: { fromColumnId: ID.column, toColumnId: 'x'.repeat(201) },
      }),
    ];

    for (const input of inputs) {
      await expect(
        h.service.record(h.manager as unknown as EntityManager, input),
      ).rejects.toBeInstanceOf(ActivityRecordValidationError);
    }
    expect(h.activityRepository.save).not.toHaveBeenCalled();
  });

  it('allows null metadata for actions without a defined metadata payload', async () => {
    const h = harness();

    await expect(
      h.service.record(
        h.manager as unknown as EntityManager,
        validRecord({
          actionType: ActivityActionType.BOARD_UPDATED,
          entityType: ActivityEntityType.BOARD,
          entityId: null,
          metadata: null,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ActivityActionType.BOARD_ARCHIVED,
    ActivityActionType.BOARD_RESTORED,
  ])('accepts %s as a board action without metadata', async (actionType) => {
    const h = harness();
    const input = validRecord({
      actionType,
      entityType: ActivityEntityType.BOARD,
      entityId: ID.board,
      metadata: null,
    });
    await expect(
      h.service.record(h.manager as unknown as EntityManager, input),
    ).resolves.toBeUndefined();
    await expect(
      h.service.record(h.manager as unknown as EntityManager, {
        ...input,
        metadata: { previous: true },
      }),
    ).rejects.toBeInstanceOf(ActivityRecordValidationError);
    expect(h.activityRepository.save).toHaveBeenCalledTimes(1);
  });

  it('allows a null column anchor for an appended column move', async () => {
    const h = harness();

    await expect(
      h.service.record(
        h.manager as unknown as EntityManager,
        validRecord({
          actionType: ActivityActionType.COLUMN_MOVED,
          entityType: ActivityEntityType.COLUMN,
          entityId: ID.column,
          metadata: { beforeColumnId: null },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
