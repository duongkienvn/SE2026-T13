import { ApiError } from '../../infrastructure/api/errors.ts';
import { MAX_AUTOMATIC_RETRY_DELAY_MS } from '../../infrastructure/api/client.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
type Failure = { error: ApiError; updatedAt: number };
const cooldowns = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; list?: Failure; count?: Failure }
>();
export function inboxCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
  lane: 'list' | 'count',
) {
  const current = cooldowns.get(data);
  return current && sameIdentity(current.identity, identity)
    ? current[lane]
    : undefined;
}
export function guardInboxCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
  lane: 'list' | 'count',
) {
  data.assertCurrent(identity);
  const failure = inboxCooldown(data, identity, lane);
  if (failure && !canRetryWorkspace(failure.error, failure.updatedAt)) {
    const delay = Number.isFinite(failure.error.retryAfterMs)
      ? failure.error.retryAfterMs!
      : MAX_AUTOMATIC_RETRY_DELAY_MS;
    throw new ApiError('http', {
      status: 429,
      retryAfterMs: Math.max(0, failure.updatedAt + delay - Date.now()),
    });
  }
}
export function rememberInboxCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
  lane: 'list' | 'count',
  error: unknown,
) {
  if (!(error instanceof ApiError) || error.status !== 429) return;
  data.assertCurrent(identity);
  const previous = cooldowns.get(data);
  const entry =
    previous && sameIdentity(previous.identity, identity)
      ? previous
      : { identity };
  entry[lane] = { error, updatedAt: Date.now() };
  cooldowns.set(data, entry);
}
