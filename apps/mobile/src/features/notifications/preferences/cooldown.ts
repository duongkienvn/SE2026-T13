import { MAX_AUTOMATIC_RETRY_DELAY_MS } from '../../../infrastructure/api/client.ts';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';

const budgets = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; until: number }
>();
/** Endpoint-wide budget survives observer/remount changes; no account values stored. */
export function guardPreferencesCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  data.assertCurrent(identity);
  const budget = budgets.get(data);
  if (
    budget &&
    sameIdentity(budget.identity, identity) &&
    budget.until > Date.now()
  )
    throw new ApiError('http', {
      status: 429,
      retryAfterMs: budget.until - Date.now(),
      requestStarted: false,
    });
}
export function rememberPreferencesFailure(
  data: MobileDataLayer,
  identity: SessionIdentity,
  error: unknown,
) {
  if (
    !(error instanceof ApiError) ||
    error.status !== 429 ||
    !sameIdentity(identity, data.getIdentity())
  )
    return error;
  const delay =
    error.retryAfterMs !== undefined && Number.isFinite(error.retryAfterMs)
      ? Math.max(0, error.retryAfterMs)
      : MAX_AUTOMATIC_RETRY_DELAY_MS;
  budgets.set(data, { identity, until: Date.now() + delay });
  return new ApiError(error.kind, {
    ...error,
    message: error.message,
    retryAfterMs: delay,
  });
}
