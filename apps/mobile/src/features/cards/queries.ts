import {
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { kanbanCardOptions } from '../boards/kanban-queries.ts';
import { createCardApi } from './api.ts';
import { readCardOrder } from './ordering.ts';

export function cardOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
) {
  return queryOptions({
    queryKey: queryKeys.card(identity, boardId, cardId),
    queryFn: ({ signal }) =>
      createCardApi(data.api, identity, boardId).getCard(cardId, signal),
    staleTime: 0,
    retry: false,
  });
}

export function useCard(
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
  enabled = true,
) {
  const data = useMobileData();
  return useQuery({ ...cardOptions(data, identity, boardId, cardId), enabled });
}

export function useArchivedCards(identity: SessionIdentity, boardId: string) {
  const data = useMobileData();
  return useInfiniteQuery(
    kanbanCardOptions(data.api, identity, boardId, { status: 'archived' }),
  );
}

export function useCardOrder(
  identity: SessionIdentity,
  boardId: string,
  columnId: string,
  enabled: boolean,
) {
  const data = useMobileData();
  return useQuery({
    queryKey: [...queryKeys.cards(identity, boardId), 'move-order', columnId],
    queryFn: ({ signal }) =>
      readCardOrder(
        createCardApi(data.api, identity, boardId),
        columnId,
        signal,
      ),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
