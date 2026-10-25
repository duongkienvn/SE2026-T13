// Bootstrap-only memory: never persist recovery proof in storage or router state.
let incomingToken: string | null = null;
export function captureRecoveryLink(): void {
  if (window.location.pathname !== '/reset-password') return;
  incomingToken = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState(window.history.state, '', '/reset-password');
}
export function readIncomingRecoveryToken(): string | null {
  return incomingToken;
}
export function clearIncomingRecoveryToken(): void {
  incomingToken = null;
}
