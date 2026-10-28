/** Empty keeps delivery unavailable until the frontend owner confirms a working route. */
export function invitationAcceptPath(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)
  )
    throw new Error(
      'WORKSPACE_INVITATION_ACCEPT_PATH must be an absolute application path without query or fragment, or empty to disable delivery',
    );
  return value;
}

export function workspaceInvitationLink(
  appOrigin: string,
  acceptPath: string,
  proof: string,
): string {
  const origin = new URL(appOrigin);
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== 'https:' &&
      (origin.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Invitation email requires a safe application origin');
  const path = invitationAcceptPath(acceptPath);
  if (!path) throw new Error('Invitation acceptance destination unavailable');
  if (!/^[A-Za-z0-9_-]{43}$/.test(proof))
    throw new Error('Invalid invitation proof');
  const link = new URL(path, origin);
  // Fragments stay out of HTTP access logs and Referrer headers. P2-08 must
  // extract/clear this immediately and retain it only in ephemeral memory.
  link.hash = new URLSearchParams({ proof }).toString();
  return link.toString();
}
