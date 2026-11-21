import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { EMAIL_CHANGE_COOLDOWN_MS } from './email-change.ts';
/** Only deadline metadata survives a screen/account change, never addresses or proofs. */
const deadlines = new WeakMap<MobileDataLayer, Map<string, number>>();
export function emailCooldown(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  return deadlines.get(data)?.get(identity.userId) ?? 0;
}
export function holdEmailRequest(
  data: MobileDataLayer,
  identity: SessionIdentity,
  delay = EMAIL_CHANGE_COOLDOWN_MS,
) {
  const users = deadlines.get(data) ?? new Map<string, number>();
  deadlines.set(data, users);
  const until = Math.max(users.get(identity.userId) ?? 0, Date.now() + delay);
  users.set(identity.userId, until);
  return until;
}
