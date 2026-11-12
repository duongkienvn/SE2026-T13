import { useSession } from './session-context';
import { Scaffold } from './scaffold';

export function PublicScaffold({
  title,
  header = false,
}: {
  title: string;
  header?: boolean;
}) {
  const session = useSession();
  if (
    session.status === 'restoring' ||
    session.status === 'verifying' ||
    (session.status === 'authenticated' && !!session.sessionKey)
  )
    return null;
  if (session.status === 'offline-uncertain')
    return (
      <Scaffold
        title="Connection unavailable"
        message="Connect to the internet to verify your session."
        header={header}
      />
    );
  return <Scaffold title={title} header={header} />;
}
