// Bootstrap-only memory. Never stored in router state, browser storage or logs.
let incomingToken: string | null = null;

export function captureVerificationLink(): void {
  if (window.location.pathname !== '/verify-email') return;
  incomingToken = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState(window.history.state, '', '/verify-email');
}

export function readIncomingVerificationToken(): string | null {
  return incomingToken;
}
export function clearIncomingVerificationToken(): void {
  incomingToken = null;
}
