import { Redirect } from 'expo-router';
import { useSession } from '../navigation/session-context';
import { Scaffold } from '../navigation/scaffold';
import { isPublicNavigationPreview } from '../navigation/preview';

export default function Index() {
  const session = useSession();
  if (isPublicNavigationPreview('/home')) return <Redirect href="/home" />;
  if (session.status === 'restoring' || session.status === 'verifying')
    return <Scaffold title="Checking session" message="Please wait." />;
  if (session.status === 'offline-uncertain')
    return (
      <Scaffold
        title="Connection unavailable"
        message="Connect to the internet to verify your session."
      />
    );
  if (session.status === 'authenticated' && session.sessionKey) return null;
  return <Redirect href="/sign-in" />;
}
