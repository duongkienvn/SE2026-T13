import { queryOptions } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeHomeDashboard } from './decoder.ts';

export function homeOptions(data: MobileDataLayer, identity: SessionIdentity) {
  const queryKey = queryKeys.home(identity);
  return queryOptions({
    queryKey,
    async queryFn({ signal }) {
      try {
        return await data.api.json('/users/me/home', decodeHomeDashboard, {
          identity,
          signal,
          resourceKey: queryKey,
          expectedStatus: 200,
          // Keep one authoritative attempt per refresh, including 429/503.
          retries: 0,
        });
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) {
          // An access failure must purge the previous aggregate, even with no
          // active Home observer. The existing resource epoch fences this read.
          data.evict(identity, [queryKey]);
        }
        throw error;
      }
    },
  });
}
