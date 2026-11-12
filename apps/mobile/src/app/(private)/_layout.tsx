import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { safeReturnTarget } from '../../navigation/session';
import { useReturnTarget, useSession } from '../../navigation/session-context';
import { Scaffold } from '../../navigation/scaffold';
import { useTheme } from '../../ui';
import { isPublicNavigationPreview } from '../../navigation/preview';

export const unstable_settings = { anchor: '(tabs)' };

export default function PrivateLayout() {
  const session = useSession();
  const colors = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const { remember } = useReturnTarget();
  const authenticated =
    session.status === 'authenticated' && !!session.sessionKey;
  const preview = isPublicNavigationPreview(pathname);
  const hadAuthenticatedSession = useRef(authenticated);
  if (authenticated) hadAuthenticatedSession.current = true;
  const signedOut =
    session.status === 'unauthenticated' ||
    session.status === 'expired' ||
    (session.status === 'authenticated' && !session.sessionKey);
  useEffect(() => {
    const unresolved =
      session.status === 'restoring' ||
      session.status === 'verifying' ||
      session.status === 'offline-uncertain';
    if (
      !authenticated &&
      !preview &&
      (!hadAuthenticatedSession.current || unresolved) &&
      safeReturnTarget(pathname)
    )
      remember(pathname, !unresolved);
    if (signedOut && !preview) router.replace('/sign-in');
  }, [
    authenticated,
    session.status,
    signedOut,
    pathname,
    remember,
    router,
    preview,
  ]);
  useEffect(() => {
    if (authenticated && !safeReturnTarget(pathname)) router.replace('/boards');
  }, [authenticated, pathname, router]);
  if (!preview && session.status === 'offline-uncertain')
    return (
      <Scaffold
        title="Connection unavailable"
        message="Connect to the internet to verify your session."
      />
    );
  if (
    !preview &&
    (session.status === 'restoring' || session.status === 'verifying')
  )
    return <Scaffold title="Checking session" message="Please wait." />;
  if ((!authenticated && !preview) || !safeReturnTarget(pathname)) return null;
  return (
    <Stack
      key={
        session.status === 'authenticated'
          ? session.sessionKey
          : 'public-preview'
      }
      screenOptions={{
        headerShown: true,
        title: '',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="invitation" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
