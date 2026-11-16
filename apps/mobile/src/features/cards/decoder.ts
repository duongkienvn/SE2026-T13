import { isCardDateInstant } from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import {
  decodeKanbanCard,
  normalizeKanbanFilters,
} from '../boards/kanban-api.ts';

export function decodeCardAssignee(value: unknown, status = 200) {
  const dto = value as Record<string, unknown> | null;
  const { userId, assignedById, createdAt } = dto ?? {};
  if (
    !isUuid(userId) ||
    (assignedById !== null && !isUuid(assignedById)) ||
    !isCardDateInstant(createdAt) ||
    !createdAt.endsWith('Z')
  )
    throw invalidResponse(status);
  return {
    userId: userId.toLowerCase(),
    assignedById: assignedById?.toLowerCase() ?? null,
    createdAt,
  };
}

export function decodeCard(value: unknown, boardId: string) {
  const dto = value as Record<string, unknown> | null;
  const card = decodeKanbanCard(
    value,
    boardId,
    normalizeKanbanFilters({
      status: dto?.isArchived === true ? 'archived' : 'active',
    }),
  );
  if (
    !dto ||
    !isUuid(dto.createdById) ||
    [...card.title].length > 120 ||
    (card.description !== null && [...card.description].length > 2000) ||
    (!card.isArchived && dto.archivedAt !== null)
  )
    throw invalidResponse(200);
  return {
    ...card,
    createdById: dto.createdById.toLowerCase(),
    assignees: (dto.assignees as unknown[]).map((value) =>
      decodeCardAssignee(value),
    ),
  };
}

export type Card = ReturnType<typeof decodeCard>;
