import { QueryClient, useQueries } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import {
  avatarDataUri,
  externalAvatarUrl,
  managedAvatarPath,
} from './avatar-source';

export type AvatarPerson = {
  id: string;
  avatarUrl: string | null;
  avatarRevision?: number;
  isDeleted?: boolean;
};

/**
 * One roster-fenced image read per user/revision/path. The key lives under the
 * Board members key, so roster denial, Board teardown and session changes evict
 * it with the roster. Bytes stay in memory (gcTime 0): no files, no Image URL
 * with a bearer token, and nothing is sent to external hosts.
 */
export function memberAvatarOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  boardId: string,
  person: AvatarPerson,
  enabled: boolean,
) {
  const owned = managedAvatarPath(person.avatarUrl, person.id);
  const queryKey = [
    ...queryKeys.members(identity, boardId),
    'avatar',
    person.id,
    person.avatarRevision ?? 0,
    owned,
  ] as const;
  return {
    queryKey,
    enabled: enabled && !!owned && !person.isDeleted,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    async queryFn({ signal }: { signal: AbortSignal }) {
      const { bytes } = await data.api.binary(owned!, ['image/webp'], {
        identity,
        signal,
        resourceKey: queryKey,
        retries: 0,
      });
      return bytes.byteLength <= 512_000
        ? avatarDataUri(new Uint8Array(bytes))
        : null;
    },
  };
}

export function avatarUri(
  person: AvatarPerson,
  image: { isSuccess: boolean; data?: string | null } | undefined,
) {
  if (person.isDeleted) return undefined;
  // Managed photos show only verified bytes; failures keep initials.
  if (managedAvatarPath(person.avatarUrl, person.id))
    return image?.isSuccess ? (image.data ?? undefined) : undefined;
  return externalAvatarUrl(person.avatarUrl) ?? undefined;
}

export type AvatarScopeValue = {
  identity: SessionIdentity;
  boardId: string;
  enabled: boolean;
};
type Scope = AvatarScopeValue & { data: MobileDataLayer };
const AvatarScope = createContext<Scope | null>(null);
// Unscoped renders (no session/Board fence) observe nothing and show initials.
let inert: QueryClient | undefined;

/** Supplies the session and Board fence to assignee photos below it. */
export function AssigneeAvatarScope({
  identity,
  boardId,
  enabled,
  children,
}: AvatarScopeValue & { children: ReactNode }) {
  const data = useMobileData();
  const value = useMemo(
    () => ({ data, identity, boardId, enabled }),
    [data, identity, boardId, enabled],
  );
  return <AvatarScope.Provider value={value}>{children}</AvatarScope.Provider>;
}

/** For a caller that owns the fence itself (e.g. Card metadata). */
export function useAvatarScope(value: AvatarScopeValue): Scope {
  const data = useMobileData();
  const { identity, boardId, enabled } = value;
  return useMemo(
    () => ({ data, identity, boardId, enabled }),
    [data, identity, boardId, enabled],
  );
}

function useAssigneeUris(people: readonly AvatarPerson[], explicit?: Scope) {
  const context = useContext(AvatarScope);
  const scope = explicit ?? context;
  const images = useQueries(
    {
      queries: scope
        ? people.map((person) =>
            memberAvatarOptions(
              scope.data,
              scope.identity,
              scope.boardId,
              person,
              scope.enabled,
            ),
          )
        : [],
    },
    scope?.data.queryClient ?? (inert ??= new QueryClient()),
  );
  return people.map((person, index) =>
    avatarUri(person, scope ? images[index] : undefined),
  );
}

export function useAssigneeSources(
  people: readonly AvatarPerson[],
  explicit?: Scope,
): (ImageSourcePropType | undefined)[] {
  const uris = useAssigneeUris(people, explicit);
  const identity = uris.join(' ');
  // Stable sources keep Image from reloading on unrelated re-renders.
  return useMemo(
    () => uris.map((uri) => (uri ? { uri } : undefined)),
    [identity],
  );
}

/** Without a scope, managed photos fall back to initials (fail closed). */
export function useAssigneeSource(person: AvatarPerson, explicit?: Scope) {
  const [uri] = useAssigneeUris([person], explicit);
  return useMemo(() => (uri ? { uri } : undefined), [uri]);
}
