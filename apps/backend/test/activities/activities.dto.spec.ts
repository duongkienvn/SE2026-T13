import {
  ActivityActionType,
  ActivityEntityType,
} from '../../src/common/enums/database-enums';
import { Activity } from '../../src/api/activities/entities/activity.entity';
import { toActivityResponseDto } from '../../src/api/activities/dto/activity-response.dto';

describe('ActivityResponseDto', () => {
  it('serializes only the documented fields and keeps legacy metadata nullable', () => {
    const activity = Object.assign(new Activity(), {
      id: 'e6ba7134-97ef-4c1b-a342-001a982a7721',
      boardId: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
      actorId: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
      actionType: ActivityActionType.BOARD_UPDATED,
      entityType: ActivityEntityType.BOARD,
      entityId: null,
      metadata: null,
      createdAt: new Date('2026-10-16T12:00:00.000Z'),
      actor: { passwordHash: 'must-not-leak' },
      board: { name: 'must-not-leak' },
    });

    expect(toActivityResponseDto(activity)).toEqual({
      id: activity.id,
      boardId: activity.boardId,
      actorId: activity.actorId,
      actionType: ActivityActionType.BOARD_UPDATED,
      entityType: ActivityEntityType.BOARD,
      entityId: null,
      metadata: null,
      createdAt: '2026-10-16T12:00:00.000Z',
    });
  });
});
