import { isProof } from '../../auth/validation.ts';
import {
  systemTimers,
  type Timers,
} from '../../../infrastructure/auth/clock.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';

const lifetime = 10 * 60_000;

export function parseInvitationProof(input: string) {
  const match =
    /^https:\/\/kanvexa\.tech\/invitations\/workspace#proof=([A-Za-z0-9_-]{43})$/.exec(
      input,
    );
  return match?.[0] === input && isProof(match[1]) ? match[1] : null;
}

export function createInvitationFlow(timers = systemTimers, now = Date.now) {
  let entry:
    | {
        proof: string;
        owner?: SessionIdentity;
        deadline: number;
        request?: AbortController;
      }
    | undefined;
  let expiry: ReturnType<Timers['setTimeout']> | undefined;
  let snapshot = { revision: 0, available: false, handoff: false };
  const listeners = new Set<() => void>();

  function publish(available: boolean, handoff: boolean, newEntry = false) {
    snapshot = {
      revision: snapshot.revision + Number(newEntry),
      available,
      handoff,
    };
    for (const listener of listeners) listener();
  }

  function clear() {
    if (!entry) return;
    entry.request?.abort();
    entry = undefined;
    if (expiry !== undefined) timers.clearTimeout(expiry);
    expiry = undefined;
    publish(false, false);
  }

  function valid() {
    if (entry && now() >= entry.deadline) clear();
    return entry;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    intake(input: string) {
      if (
        !/^https:\/\/kanvexa\.tech\/invitations\/workspace(?:[?#]|$)/.test(
          input,
        )
      )
        return false;
      const proof = parseInvitationProof(input);
      if (proof && valid()?.proof === proof) return true;
      clear();
      if (proof) {
        entry = { proof, deadline: now() + lifetime };
        expiry = timers.setTimeout(clear, lifetime);
        publish(true, false, true);
      }
      return true;
    },
    bind(identity: SessionIdentity) {
      const current = valid();
      if (!current) return;
      if (current.owner && !sameIdentity(current.owner, identity)) clear();
      else current.owner = identity;
    },
    handoff() {
      if (valid()) publish(true, true);
    },
    resume() {
      if (valid() && snapshot.handoff) publish(true, false);
    },
    claim(identity: SessionIdentity) {
      const current = valid();
      if (
        !current?.owner ||
        !sameIdentity(current.owner, identity) ||
        current.request
      )
        return null;
      const controller = new AbortController();
      current.request = controller;
      return {
        proof: current.proof,
        signal: controller.signal,
        finish(retain = false) {
          if (entry !== current || controller.signal.aborted) return false;
          current.request = undefined;
          if (!retain) clear();
          return true;
        },
      };
    },
    clear,
  };
}

export const nativeInvitationFlow = createInvitationFlow();
