import { useIsFocused, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms';
import { queryKeys } from '../../infrastructure/query/keys';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import {
  destinationPath,
  parsePath,
  type Destination,
} from '../../navigation/routes';
import { Scaffold } from '../../navigation/scaffold';
import { useSession } from '../../navigation/session-context';

type Preview = Extract<Destination, { kind: 'board' | 'card' }>;

export function ResourcePreview({ kind }: { kind: Preview['kind'] }) {
  const pathname = usePathname();
  const destination = parsePath(pathname);
  const session = useSessionSnapshot();
  if (
    !destination ||
    destination.kind !== kind ||
    session.status !== 'authenticated'
  )
    return <ResourceBoundary access="unavailable" />;
  return (
    <AccessCheck
      key={`${session.generation}:${session.user.id}:${pathname}`}
      destination={destination}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function AccessCheck({
  destination,
  identity,
}: {
  destination: Preview;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const session = useSession();
  const focused = useIsFocused();
  const { boardId } = destination;
  const path = destinationPath(destination);
  // The GETs enforce Board/Card membership, including the parent relationship.
  // Keep only an access marker while the actual detail UI is still pending.
  const key =
    destination.kind === 'board'
      ? ([...queryKeys.board(identity, boardId), 'detail-access'] as const)
      : ([
          ...queryKeys.card(identity, boardId, destination.cardId),
          'detail-access',
        ] as const);
  const access = useQuery({
    queryKey: key,
    enabled: focused,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      const homeKey = queryKeys.home(identity);
      try {
        const result = await data.api.json(
          path,
          (value) => {
            if (destination.kind === 'board') {
              const board = decodeBoardAccess(value);
              return board.id === boardId && board.capabilities.canReadBoard
                ? board
                : false;
            }
            const card = value as { id?: unknown; boardId?: unknown } | null;
            return card?.id === destination.cardId && card?.boardId === boardId;
          },
          {
            identity,
            signal,
            resourceKey: key,
            expectedStatus: 200,
            retries: 0,
          },
        );
        if (typeof result === 'object')
          data.resources.rememberBoardWorkspace(boardId, result.workspaceId);
        return result !== false;
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          // Returning to Home must not flash a preview after an authoritative
          // denial, even while MOB-06 is still checking broader Board access.
          data.evict(identity, [homeKey]);
          void data.invalidateHints(identity, [homeKey]).catch(() => undefined);
        }
        throw error;
      }
    },
  });
  const title = destination.kind === 'board' ? 'Board detail' : 'Card detail';
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
      <Scaffold title={title} message={`${title} is coming soon.`} header />
    </ResourceBoundary>
  );
}
