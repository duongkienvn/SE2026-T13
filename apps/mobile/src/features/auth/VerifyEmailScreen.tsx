import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ApiError } from '../../infrastructure/api/errors';
import { Button, TextField } from '../../ui';
import { AuthFrame, AuthIcon, AuthLink, AuthText } from './components';
import {
  authError,
  retryDelay,
  useAuth,
  useAuthFlow,
  useCooldown,
  usePublicRequest,
} from './runtime';
import { emailError, maskEmail } from './validation';

export function VerifyEmailScreen() {
  const { api, flow } = useAuth(),
    state = useAuthFlow(),
    router = useRouter(),
    request = usePublicRequest();
  const [email, setEmail] = useState(state.email),
    [error, setError] = useState(''),
    [ack, setAck] = useState(''),
    [verified, setVerified] = useState(false);
  const cooldown = useCooldown(state.cooldownUntil);
  useFocusEffect(
    useCallback(() => () => flow.cancelProof('verify-email'), [flow]),
  );
  const back = () => {
    request.cancel();
    flow.cancelProof('verify-email');
    router.replace('/sign-in');
  };
  const verify = () => {
    if (request.pending) return;
    const proof = flow.takeProof('verify-email');
    if (!proof) return;
    void request.run(
      async (signal, current) => {
        await api.verify(proof, signal);
        if (current()) {
          setVerified(true);
          setError('');
        }
      },
      () =>
        setError(
          'This verification link is invalid, expired, already used, or could not be confirmed. Request a new link or try signing in.',
        ),
    );
  };
  const resend = () => {
    const validation = emailError(email);
    setError(validation ?? '');
    if (validation || cooldown) return;
    void request.run(
      async (signal, current) => {
        await api.resend(email, signal);
        if (current()) {
          flow.setEmail(email);
          flow.cooldown('verification');
          setAck(
            'If verification is needed, an email may arrive. Delivery may be delayed or unavailable.',
          );
        }
      },
      (cause) => {
        setError(authError(cause));
        if (cause instanceof ApiError && cause.status === 429)
          flow.cooldown('verification', retryDelay(cause));
      },
    );
  };
  if (verified)
    return (
      <AuthFrame
        title="Email verified"
        subtitle="Your email is verified. Sign in to continue."
        illustration
      >
        <Button label="Go to sign in" onPress={back} />
      </AuthFrame>
    );
  return (
    <AuthFrame
      title={
        state.hasProof && state.proofKind === 'verify-email'
          ? 'Verify your email'
          : 'Check your email'
      }
      subtitle={
        state.email
          ? `Check the inbox for ${maskEmail(state.email)}.`
          : 'Open the verification link in your email to confirm your account.'
      }
      back={back}
      illustration
    >
      {state.mailFailure && (
        <AuthText error>
          Account created, but the verification email could not be requested.
          Use resend after the cooldown; do not register again.
        </AuthText>
      )}
      <AuthText>
        Open your inbox, then select the verification link. It opens Kanvexa
        securely in your browser. Once verified, return here to sign in.
      </AuthText>
      <AuthText>Verification does not sign you in automatically.</AuthText>
      {state.hasProof && state.proofKind === 'verify-email' && (
        <Button
          label="Verify email"
          loading={request.pending}
          onPress={verify}
        />
      )}
      {error && <AuthText error>{error}</AuthText>}
      {ack && <AuthText>{ack}</AuthText>}
      <TextField
        label="Email address"
        leading={<AuthIcon kind="mail" />}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="done"
        onSubmitEditing={resend}
        editable={!request.pending}
      />
      <Button
        label={
          cooldown
            ? `Resend available in ${cooldown}s`
            : 'Resend verification email'
        }
        variant="secondary"
        disabled={!!cooldown}
        loading={request.pending}
        onPress={resend}
      />
      <AuthLink label="Back to sign in" onPress={back} />
    </AuthFrame>
  );
}
