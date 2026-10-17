import type { EntityManager } from 'typeorm';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../common/enums/database-enums';

export type ActivityMetadataValue = string | number | boolean | null;

export interface RecordActivityInput {
  readonly boardId: string;
  readonly actorId: string;
  readonly actionType: ActivityActionType;
  readonly entityType: ActivityEntityType;
  readonly entityId: string | null;
  readonly metadata: Record<string, ActivityMetadataValue> | null;
}

export interface ActivityRecorder {
  record(manager: EntityManager, input: RecordActivityInput): Promise<void>;
}

export class ActivityRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = ActivityRecordValidationError.name;
  }
}
