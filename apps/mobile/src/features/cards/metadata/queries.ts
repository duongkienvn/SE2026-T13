import { useQuery } from '@tanstack/react-query';
import type { SessionIdentity } from '../../../infrastructure/api/session-client.ts';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import type { KanbanAssignee } from '../../boards/kanban-api.ts';
import { useKanbanCatalogs } from '../../boards/kanban-queries.ts';
import { useCard } from '../queries';
import { createMetadataApi } from './api.ts';

export { preferencesOptions as datePreferencesOptions } from '../../preferences/api.ts';

export function useCardLabels(
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
  enabled: boolean,
) {
  const { api } = useMobileData();
  return useQuery({
    queryKey: queryKeys.cardLabels(identity, boardId, cardId),
    queryFn: ({ signal }) =>
      createMetadataApi(api, identity, boardId, cardId).labels(signal),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
}

// Table can use the same Card query for a selected row, and Board catalogs for bulk rows.
export const useMetadataCard = useCard;
export { useKanbanCatalogs as useBoardMetadataCatalogs };

export function resolveAssignees(
  assignments: readonly { userId: string }[],
  members: readonly KanbanAssignee[],
) {
  const roster = new Map(members.map((item) => [item.id, item]));
  return assignments.map(({ userId }) => ({
    id: userId,
    name: roster.get(userId)?.name ?? 'Assigned member',
    avatarUrl: roster.get(userId)?.avatarUrl ?? null,
    avatarRevision: roster.get(userId)?.avatarRevision ?? 0,
  }));
}
