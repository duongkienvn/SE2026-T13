import {
  destinationPath,
  invitationRecipientPath,
  parseLink,
} from '../navigation/routes';
import { notifyIncomingLink } from '../navigation/incoming-link';
import { nativeAuthFlow } from '../features/auth/flow';
import { nativeInvitationFlow } from '../features/workspaces/invitations/flow';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  if (nativeInvitationFlow.intake(path)) return invitationRecipientPath;
  const authKind = nativeAuthFlow.intake(path);
  if (authKind) return `/${authKind}`;
  const destination = parseLink(path);
  if (destination && !initial) {
    const heldPath = notifyIncomingLink(destination);
    if (heldPath) return heldPath;
  }
  return destination ? destinationPath(destination) : '/';
}
