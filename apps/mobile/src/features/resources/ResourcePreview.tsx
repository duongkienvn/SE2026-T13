import { useIsFocused, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import {
  destinationPath,
  parsePath,
  type Destination,
} from '../../navigation/routes';
import { Scaffold } from '../../navigation/scaffold';
import { useSession } from '../../navigation/session-context';

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
  const path = destinationPath(destination);
  const key = [
    ...queryKeys.card(identity, boardId, cardId),
    'detail-access',
  ] as const;
  const access = useQuery({
    queryKey: key,
    enabled: focused,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      try {
        // The GET enforces Card read access and the parent Board relationship.
        return await data.api.json(
          path,
          (value) => {
            const card = value as { id?: unknown; boardId?: unknown } | null;
            return card?.id === cardId && card?.boardId === boardId;
          },
          {
            identity,
            signal,
            resourceKey: key,
            expectedStatus: 200,
            retries: 0,
          },
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
  if (access.isError || access.isPaused || access.data === false)
    return <ResourceBoundary access="unavailable" />;
  if (
    !access.isFetchedAfterMount ||
    access.data !== true ||
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
        title="Card detail"
        message="Card detail is coming soon."
        header
      />
    </ResourceBoundary>
  );
}
