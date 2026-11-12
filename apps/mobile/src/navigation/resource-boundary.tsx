import type { ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { guardDecision, type ResourceAccess } from './session';
import { useSession } from './session-context';
import { Scaffold } from './scaffold';

/** The feature owner must derive access from an authoritative server response. */
export function ResourceBoundary({
  access,
  children,
}: {
  access: ResourceAccess;
  children?: ReactNode;
}) {
  const session = useSession();
  const pathname = usePathname();
  const decision = guardDecision(session, access, pathname);
  if (decision === 'render') return <>{children}</>;
  if (decision === 'sign-in') return null;
  if (decision === 'wait')
    return <Scaffold title="Checking access" message="Please wait." header />;
  if (decision === 'offline')
    return (
      <Scaffold
        title="Connection unavailable"
        message="Connect to the internet to verify access."
        header
      />
    );
  return (
    <Scaffold
      title="Resource unavailable"
      message="This destination is unavailable."
      header
    />
  );
}
