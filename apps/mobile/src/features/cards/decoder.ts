import { isCardDateInstant } from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import {
  decodeKanbanCard,
  normalizeKanbanFilters,
} from '../boards/kanban-api.ts';

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
    (!card.isArchived && dto.archivedAt !== null)
  )
    throw invalidResponse(200);
  return {
    ...card,
    createdById: dto.createdById.toLowerCase(),
    assignees: card.assignees.map(({ userId }, index) => {
      const assignee = (dto.assignees as Record<string, unknown>[])[index]!;
      const { assignedById, createdAt } = assignee;
      if (
        (assignedById !== null && !isUuid(assignedById)) ||
        !isCardDateInstant(createdAt) ||
        !createdAt.endsWith('Z')
      )
        throw invalidResponse(200);
      return {
        userId,
        assignedById: assignedById?.toLowerCase() ?? null,
        createdAt,
      };
    }),
  };
}

export type Card = ReturnType<typeof decodeCard>;
