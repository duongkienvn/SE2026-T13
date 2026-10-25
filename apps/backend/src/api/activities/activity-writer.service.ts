import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  ActivityActionType,
  ActivityEntityType,
  BoardMemberRole,
} from '../../common/enums/database-enums';
import {
  ActivityRecordValidationError,
  ActivityRecorder,
  RecordActivityInput,
} from './activity-recorder';
import { Activity } from './entities/activity.entity';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_METADATA_STRING_LENGTH = 200;

const ENTITY_FOR_ACTION: Record<ActivityActionType, ActivityEntityType> = {
  [ActivityActionType.BOARD_UPDATED]: ActivityEntityType.BOARD,
  [ActivityActionType.BOARD_ARCHIVED]: ActivityEntityType.BOARD,
  [ActivityActionType.BOARD_RESTORED]: ActivityEntityType.BOARD,
  [ActivityActionType.MEMBER_ADDED]: ActivityEntityType.MEMBER,
  [ActivityActionType.MEMBER_REMOVED]: ActivityEntityType.MEMBER,
  [ActivityActionType.ROLE_CHANGED]: ActivityEntityType.MEMBER,
  [ActivityActionType.COLUMN_CREATED]: ActivityEntityType.COLUMN,
  [ActivityActionType.COLUMN_UPDATED]: ActivityEntityType.COLUMN,
  [ActivityActionType.COLUMN_MOVED]: ActivityEntityType.COLUMN,
  [ActivityActionType.COLUMN_DELETED]: ActivityEntityType.COLUMN,
  [ActivityActionType.CARD_CREATED]: ActivityEntityType.CARD,
  [ActivityActionType.CARD_UPDATED]: ActivityEntityType.CARD,
  [ActivityActionType.CARD_MOVED]: ActivityEntityType.CARD,
  [ActivityActionType.CARD_ARCHIVED]: ActivityEntityType.CARD,
  [ActivityActionType.COMMENT_CREATED]: ActivityEntityType.COMMENT,
  [ActivityActionType.COMMENT_UPDATED]: ActivityEntityType.COMMENT,
  [ActivityActionType.COMMENT_DELETED]: ActivityEntityType.COMMENT,
};

const METADATA_KEYS: Partial<Record<ActivityActionType, readonly string[]>> = {
  [ActivityActionType.CARD_MOVED]: ['fromColumnId', 'toColumnId'],
  [ActivityActionType.COLUMN_MOVED]: ['beforeColumnId'],
  [ActivityActionType.ROLE_CHANGED]: ['fromRole', 'toRole'],
  [ActivityActionType.MEMBER_REMOVED]: ['targetUserId'],
  [ActivityActionType.COMMENT_CREATED]: ['cardId'],
};

@Injectable()
export class ActivityWriterService implements ActivityRecorder {
  async record(
    manager: EntityManager,
    input: RecordActivityInput,
  ): Promise<void> {
    validateRecordActivityInput(input);
    const activities = manager.getRepository(Activity);
    await activities.save(
      activities.create({
        boardId: input.boardId,
        actorId: input.actorId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ? { ...input.metadata } : null,
      }),
    );
  }
}

function validateRecordActivityInput(input: RecordActivityInput): void {
  if (!UUID_PATTERN.test(input.boardId) || !UUID_PATTERN.test(input.actorId)) {
    throw new ActivityRecordValidationError(
      'Activity board and actor IDs must be UUIDs',
    );
  }
  if (input.entityId !== null && !UUID_PATTERN.test(input.entityId)) {
    throw new ActivityRecordValidationError(
      'Activity entity ID must be a UUID',
    );
  }
  if (ENTITY_FOR_ACTION[input.actionType] !== input.entityType) {
    throw new ActivityRecordValidationError(
      'Activity action and entity types do not match',
    );
  }

  const allowedKeys = METADATA_KEYS[input.actionType];
  if (input.metadata === null) return;
  if (!allowedKeys) {
    throw new ActivityRecordValidationError(
      'This activity action does not accept metadata',
    );
  }

  const keys = Object.keys(input.metadata);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw new ActivityRecordValidationError(
      'Activity metadata has an invalid shape',
    );
  }
  for (const [key, value] of Object.entries(input.metadata)) {
    if (
      typeof value === 'string' &&
      value.length > MAX_METADATA_STRING_LENGTH
    ) {
      throw new ActivityRecordValidationError(
        'Activity metadata value is too long',
      );
    }
    if (
      (value !== null && typeof value === 'object') ||
      typeof value === 'function' ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new ActivityRecordValidationError(
        'Activity metadata must be flat JSON values',
      );
    }
    validateMetadataValue(input.actionType, key, value);
  }
}

function validateMetadataValue(
  actionType: ActivityActionType,
  key: string,
  value: string | number | boolean | null,
): void {
  if (value === null) {
    if (
      actionType !== ActivityActionType.COLUMN_MOVED ||
      key !== 'beforeColumnId'
    ) {
      throw new ActivityRecordValidationError(
        'Activity metadata identifier cannot be null',
      );
    }
    return;
  }
  if (
    key.endsWith('Id') &&
    (typeof value !== 'string' || !UUID_PATTERN.test(value))
  ) {
    throw new ActivityRecordValidationError(
      'Activity metadata IDs must be UUIDs',
    );
  }
  if (
    actionType === ActivityActionType.ROLE_CHANGED &&
    key.endsWith('Role') &&
    !Object.values(BoardMemberRole).some((role) => role === value)
  ) {
    throw new ActivityRecordValidationError(
      'Activity metadata role is invalid',
    );
  }
}
