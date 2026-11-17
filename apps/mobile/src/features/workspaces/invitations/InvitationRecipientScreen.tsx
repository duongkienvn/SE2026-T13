import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../../infrastructure/api/errors';
import { sameIdentity } from '../../../infrastructure/api/session-client';
import {
  useSessionManager,
  useSessionSnapshot,
} from '../../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { useReturnTarget } from '../../../navigation/session-context';
import { Button, ConfirmDialog, LoadingState } from '../../../ui';
import { AuthFrame, AuthText } from '../../auth/components';
import { useWorkspaceOnline, useWorkspaceRetryReady } from '../status';
import { createInvitationRecipientApi } from './api';
import { invitationRecipientPath } from '../../../navigation/routes';
import { nativeInvitationFlow } from './flow';
import { invitationRetryError } from './mutations';
import {
  readInvitationBaseline,
  reconcileAcceptedInvitation,
} from './reconcile';

const reopen = 'Open the link from your invitation email again.';

function responseMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return 'Your session ended. Sign in and reopen the invitation email.';
    if (error.status === 403)
      return 'Verify the invited email address, then reopen the invitation email.';
    if ([400, 404, 410].includes(error.status))
      return 'This invitation is unavailable. Use the invited account or ask a Workspace admin for a new invitation.';
    if (error.status === 409)
      return 'Email delivery was not confirmed. Ask a Workspace admin to check the invitation.';
    if (error.status === 429)
      return 'Too many attempts. Wait before trying again.';
    if (
      !error.requestStarted &&
      ['offline', 'network', 'timeout'].includes(error.kind)
    )
      return 'Reconnect to respond to the invitation.';
  }
  return 'We couldn’t confirm what happened. Check your Workspaces or reopen the invitation email before trying again.';
}

export function InvitationRecipientScreen() {
  const flow = useSyncExternalStore(
    nativeInvitationFlow.subscribe,
    nativeInvitationFlow.getSnapshot,
  );
  return <RecipientEntry key={flow.revision} available={flow.available} />;
}

function RecipientEntry({ available }: { available: boolean }) {
  const router = useRouter();
  const focused = useIsFocused();
  const manager = useSessionManager();
  const session = useSessionSnapshot();
  const data = useMobileData();
  const { remember, take } = useReturnTarget();
  const online = useWorkspaceOnline();
  const [pending, setPending] = useState(false);
  const [decline, setDecline] = useState(false);
  const [result, setResult] = useState<'accepted' | 'declined'>();
  const [failure, setFailure] = useState<{ error: unknown; at: number }>();
  const mounted = useRef(false);
  const reconcile = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reconcile.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!focused) return;
    nativeInvitationFlow.resume();
    if (session.status === 'authenticated')
      nativeInvitationFlow.bind({
        userId: session.user.id,
        generation: session.generation,
      });
  }, [focused, session]);
  const retry = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const authenticated = session.status === 'authenticated';
  const checking =
    session.status === 'restoring' || session.status === 'verifying';
  const beginAuth = (path: '/sign-in' | '/sign-up') => {
    nativeInvitationFlow.handoff();
    remember(invitationRecipientPath);
    router.push(path);
  };
  const leave = () => {
    nativeInvitationFlow.clear();
    take();
    router.replace(authenticated ? '/boards' : '/sign-in');
  };
  const changeAccount = () => {
    nativeInvitationFlow.clear();
    take();
    void manager.logout().then(() => {
      if (mounted.current) router.replace('/sign-in');
    });
  };

  async function respond(answer: 'accept' | 'decline') {
    if (!authenticated || !focused || !online || !retry) return;
    const identity = {
      userId: session.user.id,
      generation: session.generation,
    };
    if (!sameIdentity(identity, data.getIdentity())) return;
    const attempt = nativeInvitationFlow.claim(identity);
    if (!attempt) return;
    const current = () =>
      mounted.current && sameIdentity(identity, data.getIdentity());
    setPending(true);
    setFailure(undefined);
    const api = createInvitationRecipientApi(data.api, identity);
    try {
      const baseline =
        answer === 'accept'
          ? await readInvitationBaseline(data, identity, attempt.signal)
          : null;
      if (!current() || attempt.signal.aborted) return;
      const member =
        answer === 'accept'
          ? await api.accept(attempt.proof, attempt.signal)
          : undefined;
      if (answer === 'decline')
        await api.decline(attempt.proof, attempt.signal);
      if (!attempt.finish() || !current()) return;
      setDecline(false);
      setResult(answer === 'accept' ? 'accepted' : 'declined');
      if (member) {
        const controller = new AbortController();
        reconcile.current = controller;
        const id = await reconcileAcceptedInvitation(
          data,
          identity,
          member,
          baseline,
          controller.signal,
        ).catch(() => undefined);
        if (id && current() && !controller.signal.aborted)
          router.replace('/workspaces/' + id);
      }
    } catch (error) {
      const retain =
        error instanceof ApiError &&
        (error.status === 429 ||
          (!error.requestStarted &&
            ['offline', 'network', 'timeout'].includes(error.kind)));
      if (attempt.finish(retain) && current()) {
        setDecline(false);
        setFailure({ error: invitationRetryError(error), at: Date.now() });
      }
    } finally {
      if (current()) setPending(false);
    }
  }

  return (
    <AuthFrame
      title={
        result === 'accepted'
          ? 'Invitation accepted'
          : result === 'declined'
            ? 'Invitation declined'
            : 'Workspace invitation'
      }
      subtitle={
        result
          ? 'Continue to your Workspaces.'
          : 'Use the account with the verified email address that received the invitation.'
      }
    >
      {checking && <LoadingState label="Checking your session" />}
      {session.status === 'offline-uncertain' && (
        <>
          <AuthText>Connect to verify your session.</AuthText>
          <Button
            label="Retry session verification"
            onPress={() => void manager.retryVerification()}
            disabled={!online}
          />
        </>
      )}
      {failure && <AuthText error>{responseMessage(failure.error)}</AuthText>}
      {!available && !result && <AuthText>{reopen}</AuthText>}
      {!online && <AuthText>You’re offline. Reconnect to respond.</AuthText>}
      {!checking &&
        !authenticated &&
        session.status !== 'offline-uncertain' && (
          <>
            {available && (
              <AuthText>
                Verify your email before signing in. If you use Google sign-in,
                reopen the invitation email afterward.
              </AuthText>
            )}
            <Button label="Sign in" onPress={() => beginAuth('/sign-in')} />
            <Button
              label="Create account"
              variant="secondary"
              onPress={() => beginAuth('/sign-up')}
            />
          </>
        )}
      {authenticated && !result && (
        <>
          {available && (
            <>
              <Button
                label="Accept invitation"
                disabled={!online || !retry || pending}
                loading={pending && !decline}
                onPress={() => void respond('accept')}
              />
              <Button
                label="Decline invitation"
                variant="secondary"
                disabled={!online || !retry || pending}
                onPress={() => setDecline(true)}
              />
            </>
          )}
          <Button
            label="Sign out to use another account"
            variant="link"
            disabled={pending}
            onPress={changeAccount}
          />
        </>
      )}
      {(authenticated || available) && (
        <Button
          label={result ? 'Go to Workspaces' : 'Close invitation'}
          variant="link"
          disabled={pending}
          onPress={leave}
        />
      )}
      {decline && available && (
        <ConfirmDialog
          visible
          title="Decline this invitation?"
          message="Declining closes this invitation without joining the Workspace."
          confirmLabel="Decline invitation"
          destructive
          loading={pending}
          confirmDisabled={!online || !retry}
          onCancel={() => setDecline(false)}
          onConfirm={() => void respond('decline')}
        />
      )}
    </AuthFrame>
  );
}
