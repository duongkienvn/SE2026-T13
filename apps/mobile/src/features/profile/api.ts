import { queryOptions } from '@tanstack/react-query';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeProfile, displayNamePatch } from './model.ts';

export const profileKey = (identity: SessionIdentity) =>
  [...queryKeys.me(identity), 'profile'] as const;
export function createProfileApi(
  http: SessionHttpClient,
  identity: SessionIdentity,
) {
  const decode = (value: unknown) => {
    const user = decodeProfile(value);
    if (user.id !== identity.userId) throw new Error('Unexpected account');
    return user;
  };
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    expectedStatus: 200,
    retries: 0 as const,
    resourceKey: profileKey(identity),
  });
  return {
    decode,
    get: (signal: AbortSignal) =>
      http.json('/users/me', decode, options(signal)),
    patch: (name: string, signal: AbortSignal) =>
      http.json('/users/me', decode, {
        ...options(signal),
        method: 'PATCH',
        body: displayNamePatch(name),
      }),
  };
}
export function profileOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  return queryOptions({
    queryKey: profileKey(identity),
    queryFn: ({ signal }) => createProfileApi(data.api, identity).get(signal),
    staleTime: 0,
  });
}
