import { destinationPath, parseLink } from '../navigation/routes';
import { notifyIncomingLink } from '../navigation/incoming-link';
import { nativeAuthFlow } from '../features/auth/flow';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  const authKind = nativeAuthFlow.intake(path);
  if (authKind) return `/${authKind}`;
  const destination = parseLink(path);
  if (destination && !initial) notifyIncomingLink(destination);
  return destination ? destinationPath(destination) : '/';
}
