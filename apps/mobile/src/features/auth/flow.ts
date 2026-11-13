import { isProof } from './validation.ts';

export type ProofKind = 'verify-email' | 'reset-password';
export interface AuthFlowSnapshot {
  readonly revision: number;
  readonly proofVersion: number;
  readonly email: string;
  readonly mailFailure: boolean;
  readonly notice: string;
  readonly proofKind: ProofKind | null;
  readonly hasProof: boolean;
  readonly cooldownUntil: number;
  readonly recoveryCooldownUntil: number;
}

/** Separate from MOB-03 resource links. Never returns the proof to the router. */
export function parseTrustedAuthLink(
  input: string,
): { kind: ProofKind; token: string } | null {
  // Match raw input so URL normalization cannot hide encoding, ports, traversal,
  // duplicate/query injection, credentials, fragments or foreign authorities.
  const match =
    /^https:\/\/kanvexa\.tech\/(verify-email|reset-password)\?token=([A-Za-z0-9_-]{43})$/.exec(
      input,
    );
  if (!match || match[0].length !== input.length || !isProof(match[2]))
    return null;
  return { kind: match[1] as ProofKind, token: match[2] };
}

export function createAuthFlow() {
  const empty = {
    email: '',
    mailFailure: false,
    notice: '',
    proofKind: null,
    hasProof: false,
    cooldownUntil: 0,
    recoveryCooldownUntil: 0,
  };
  let state: AuthFlowSnapshot = { ...empty, revision: 0, proofVersion: 0 };
  let proof: string | null = null;
  let expiresAt = 0;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function update(patch: Partial<Omit<AuthFlowSnapshot, 'revision'>>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    listeners.forEach((fn) => fn());
  }
  function clearProof() {
    clearTimeout(expiry);
    expiry = undefined;
    proof = null;
    expiresAt = 0;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    checkEmail(email: string, mailFailure = false) {
      clearProof();
      update({
        email: email.trim(),
        mailFailure,
        notice: '',
        proofKind: null,
        hasProof: false,
        cooldownUntil: Date.now() + 60_000,
      });
    },
    setEmail(email: string) {
      update({ email: email.trim() });
    },
    notice(notice: string) {
      update({ notice });
    },
    cooldown(kind: 'verification' | 'recovery', ms = 60_000) {
      update(
        kind === 'verification'
          ? { cooldownUntil: Date.now() + ms }
          : { recoveryCooldownUntil: Date.now() + ms },
      );
    },
    intake(input: string): ProofKind | null {
      const parsed = parseTrustedAuthLink(input);
      if (!parsed) return null;
      if (proof === parsed.token && state.proofKind === parsed.kind)
        return parsed.kind;
      clearProof();
      proof = parsed.token;
      expiresAt = Date.now() + 10 * 60_000;
      update({
        email: '',
        mailFailure: false,
        notice: '',
        proofKind: parsed.kind,
        proofVersion: state.proofVersion + 1,
        hasProof: true,
      });
      expiry = setTimeout(() => {
        clearProof();
        update({ hasProof: false });
      }, 10 * 60_000);
      return parsed.kind;
    },
    /** Single claim, consumed before sending; no secret in snapshots or history. */
    takeProof(kind: ProofKind): string | null {
      if (proof && Date.now() >= expiresAt) {
        clearProof();
        update({ hasProof: false });
      }
      if (state.proofKind !== kind || !proof) return null;
      const result = proof;
      clearProof();
      update({ hasProof: false });
      return result;
    },
    cancelProof(kind: ProofKind, version = state.proofVersion) {
      if (state.proofKind !== kind || version !== state.proofVersion) return;
      clearProof();
      update({ hasProof: false, proofKind: null });
    },
    clear() {
      clearProof();
      update(empty);
    },
  };
}
export type AuthFlow = ReturnType<typeof createAuthFlow>;
export const nativeAuthFlow = createAuthFlow();
