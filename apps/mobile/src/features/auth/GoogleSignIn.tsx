import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import googleMark from '../../../assets/brand/google-g.png';
import { ApiError } from '../../infrastructure/api/errors';
import { Button, spacing, typography, useTheme } from '../../ui';
import { signInWithGoogle, type GoogleSignInOutcome } from './google-identity';
import {
  authError,
  retryDelay,
  useAuth,
  type usePublicRequest,
} from './runtime';

/** Copy for a failed `POST /auth/google`. Server messages are never echoed. */
export function googleError(error: unknown): string {
  if (!(error instanceof ApiError)) return GOOGLE_FAILED;
  if (error.status === 401 || error.status === 400)
    return 'Google sign-in could not be verified. Please try again.';
  if (error.code === 'EMAIL_NOT_VERIFIED')
    return 'Verify your email before signing in. Check your inbox for the link.';
  if (error.code === 'ACCOUNT_LINK_REQUIRED')
    return 'An account already uses this email. Sign in with your password first; you can connect Google later in your account settings.';
  if (error.status === 409)
    return 'This Google account can’t be used here. Sign in with your password.';
  if (error.status === 503)
    return 'Google sign-in is unavailable right now. Use email and password or try again later.';
  if (error.kind === 'timeout') return 'The request timed out. Try again.';
  return authError(error);
}

const GOOGLE_FAILED =
  'Google sign-in couldn’t be completed. Try again or use email and password.';

/** `null`: nothing to show (signed in, or the user simply closed Google). */
export function googleOutcomeMessage(
  outcome: GoogleSignInOutcome,
): string | null {
  if (outcome.kind === 'provider') {
    if (outcome.reason === 'busy') return null;
    if (outcome.reason === 'play-services')
      return 'Google Play services is required for Google sign-in. Update it, or use email and password.';
    if (outcome.reason === 'audience')
      return 'Google sign-in isn’t set up correctly for this app. Use email and password.';
    return GOOGLE_FAILED;
  }
  if (outcome.kind === 'session')
    return outcome.reason === 'unavailable'
      ? 'Connect to verify your session.'
      : 'Sign in could not be verified. Please try again.';
  return null;
}

export interface GoogleFeedback {
  /** Clear previous screen errors before a new attempt. */
  onStart(): void;
  onError(message: string): void;
  onUnverified(): void;
  onCooldown(until: number): void;
}

/**
 * "or continue with" + Google action. Renders nothing when this build has no
 * configured native Google Sign-In, so email/password stays the only path.
 * Shares the screen's request lock: email and Google never run together.
 */
export function GoogleSignInOption({
  request,
  disabled = false,
  feedback,
}: {
  request: ReturnType<typeof usePublicRequest>;
  disabled?: boolean;
  feedback: GoogleFeedback;
}) {
  const { api, manager, google } = useAuth();
  const c = useTheme();
  const [active, setActive] = useState(false);
  if (!google) return null;
  const start = () => {
    if (request.pending || disabled) return;
    feedback.onStart();
    setActive(true);
    void request
      .run(
        async (signal, current) => {
          const outcome = await signInWithGoogle(
            {
              provider: google,
              exchange: (credential, s) => api.google(credential, s),
              establish: (response, s) => manager.establishSession(response, s),
            },
            signal,
            current,
          );
          if (!current()) return;
          const message = googleOutcomeMessage(outcome);
          if (message) feedback.onError(message);
          // RootStack owns authenticated navigation, exactly like password login.
        },
        (cause) => {
          feedback.onError(googleError(cause));
          if (cause instanceof ApiError && cause.code === 'EMAIL_NOT_VERIFIED')
            feedback.onUnverified();
          if (cause instanceof ApiError && cause.status === 429)
            feedback.onCooldown(Date.now() + retryDelay(cause));
        },
      )
      .finally(() => setActive(false));
  };
  return (
    <>
      <View
        accessible={false}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
      >
        <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
        <Text style={[typography.body, { color: c.textSecondary }]}>
          or continue with
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
      </View>
      <Button
        variant="secondary"
        label="Continue with Google"
        loading={active}
        disabled={disabled || (request.pending && !active)}
        onPress={start}
        icon={
          <Image
            source={googleMark}
            accessible={false}
            style={{ width: 20, height: 20, marginRight: spacing.sm }}
          />
        }
      />
    </>
  );
}
