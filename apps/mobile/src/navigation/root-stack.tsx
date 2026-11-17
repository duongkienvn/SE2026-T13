import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { resumeTarget } from './session';
import { useReturnTarget, useSession } from './session-context';
import { invitationRecipientPath, type DestinationPath } from './routes';
import { nativeInvitationFlow } from '../features/workspaces/invitations/flow';
import { useTheme } from '../ui';

export function RootStack() {
  const session = useSession();
  const colors = useTheme();
  const { take } = useReturnTarget();
  const router = useRouter();
  const pathname = usePathname();
  const authenticated =
    session.status === 'authenticated' && !!session.sessionKey;
  const previouslyAuthenticated = useRef(authenticated);
  const previousSessionKey = useRef(
    session.status === 'authenticated' ? session.sessionKey : null,
  );
  const redirectIntent = useRef<DestinationPath | null>(null);
  const reachedIntent = useRef(false);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    const authHandoff = ['/sign-in', '/sign-up', '/verify-email'];
    if (pathname === invitationRecipientPath) return;
    if (
      nativeInvitationFlow.getSnapshot().handoff &&
      authHandoff.includes(pathname)
    )
      return;
    if (previous === invitationRecipientPath || authHandoff.includes(previous))
      nativeInvitationFlow.clear();
  }, [pathname]);
  useEffect(() => {
    if (session.status === 'authenticated' && session.sessionKey) {
      const switched =
        previousSessionKey.current !== null &&
        previousSessionKey.current !== session.sessionKey;
      if (!previouslyAuthenticated.current || switched) {
        const pending = take();
        redirectIntent.current = switched
          ? '/home'
          : pathname === invitationRecipientPath
            ? invitationRecipientPath
            : (resumeTarget(session, pending) ?? '/home');
        reachedIntent.current = pathname === redirectIntent.current;
        if (pathname !== redirectIntent.current)
          router.replace(redirectIntent.current, { withAnchor: true });
      } else if (pathname === '/') {
        router.replace(redirectIntent.current ?? '/home', { withAnchor: true });
      } else if (pathname === redirectIntent.current) {
        reachedIntent.current = true;
      } else if (reachedIntent.current && !pathname.startsWith('/sign-')) {
        redirectIntent.current = null;
        reachedIntent.current = false;
      }
      previousSessionKey.current = session.sessionKey;
    } else if (
      session.status === 'unauthenticated' ||
      session.status === 'expired'
    ) {
      previousSessionKey.current = null;
      redirectIntent.current = null;
      reachedIntent.current = false;
    }
    previouslyAuthenticated.current = authenticated;
  }, [authenticated, pathname, session, take, router]);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="invitations/workspace" />
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen
          name="sign-up"
          options={{ headerShown: false, title: '' }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{ headerShown: false, title: '' }}
        />
        <Stack.Screen
          name="reset-password"
          options={{ headerShown: false, title: '' }}
        />
        <Stack.Screen
          name="verify-email"
          options={{ headerShown: false, title: '' }}
        />
      </Stack.Protected>
    </Stack>
  );
}
