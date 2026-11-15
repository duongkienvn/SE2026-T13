import { useIsFocused, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { useBoardRealtime } from '../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import {
  destinationPath,
  parsePath,
  type Destination,
} from '../../navigation/routes';
import { Scaffold } from '../../navigation/scaffold';
import { useSession } from '../../navigation/session-context';
import { createCardApi } from '../cards/api';

type CardDestination = Extract<Destination, { kind: 'card' }>;

export function ResourcePreview() {
  const pathname = usePathname();
  const destination = parsePath(pathname);
  const session = useSessionSnapshot();
  if (destination?.kind !== 'card' || session.status !== 'authenticated')
    return <ResourceBoundary access="unavailable" />;
  return (
    <CardAccessCheck
      key={`${session.generation}:${session.user.id}:${pathname}`}
      destination={destination}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function CardAccessCheck({
  destination,
  identity,
}: {
  destination: CardDestination;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const session = useSession();
  const focused = useIsFocused();
  const { boardId, cardId } = destination;
  const room = useBoardRealtime(boardId, focused, true);
  const path = destinationPath(destination);
  const key = queryKeys.card(identity, boardId, cardId);
  const access = useQuery({
    queryKey: key,
    enabled:
      focused && room.status !== 'unavailable' && room.status !== 'checking',
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      try {
        return await createCardApi(data.api, identity, boardId).getCard(
          cardId,
          signal,
        );
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          const home = queryKeys.home(identity);
          data.evict(identity, [home]);
          void data.invalidateHints(identity, [home]).catch(() => undefined);
        }
        throw error;
      }
    },
  });
  if (access.isError || access.isPaused || room.status === 'unavailable')
    return <ResourceBoundary access="unavailable" />;
  if (
    !access.isFetchedAfterMount ||
    !access.data ||
    room.status === 'checking' ||
    !data.resources.readable(key) ||
    session.status !== 'authenticated'
  )
    return <ResourceBoundary access="checking" />;
  return (
    <ResourceBoundary
      access={{
        status: 'allowed',
        sessionKey: session.sessionKey,
        resourcePath: path,
      }}
    >
      <Scaffold
        title={access.data.isArchived ? access.data.title : 'Card detail'}
        message={
          access.data.isArchived
            ? ['Archived · Read-only', access.data.description]
                .filter(Boolean)
                .join('\n\n')
            : 'Card detail is coming soon.'
        }
        header
      />
    </ResourceBoundary>
  );
}
