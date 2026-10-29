/**
 * The invitation proof from the email link (`#proof=…`). It lives only in
 * this tab's memory: never in storage, the URL, router state or logs. A
 * reload or a full-page redirect (Google sign-in, email verification) drops
 * it, and the recipient opens the email link again.
 */
let current: string | null = null;

const PROOF = /^[A-Za-z0-9_-]{43}$/;

/** Reads a well-formed proof from a URL fragment; anything else is ignored. */
export function readProofFragment(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('proof');
  return value && PROOF.test(value) ? value : null;
}

export const invitationProof = {
  get: () => current,
  set: (proof: string) => {
    current = proof;
  },
  clear: () => {
    current = null;
  },
};

/** Path the invitation email links to (agreed with P2-10, #119). */
export const INVITATION_ACCEPT_PATH = '/invitations/workspace';
