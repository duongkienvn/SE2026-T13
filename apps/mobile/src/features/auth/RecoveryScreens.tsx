import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ApiError } from '../../infrastructure/api/errors';
import { Button, PasswordField, TextField } from '../../ui';
import { AuthFrame, AuthIcon, AuthLink, AuthText } from './components';
import {
  authError,
  retryDelay,
  useAuth,
  useAuthFlow,
  useCooldown,
  usePublicRequest,
} from './runtime';
import {
  confirmationError,
  emailError,
  passwordError,
  PASSWORD_HINT,
} from './validation';

export function ForgotPasswordScreen() {
  const { api, flow } = useAuth(),
    state = useAuthFlow(),
    router = useRouter(),
    request = usePublicRequest();
  const [email, setEmail] = useState(state.email),
    [error, setError] = useState(''),
    [ack, setAck] = useState(false);
  const cooldown = useCooldown(state.recoveryCooldownUntil);
  const back = () => {
    request.cancel();
    flow.setEmail(email);
    router.replace('/sign-in');
  };
  const submit = () => {
    const validation = emailError(email);
    setError(validation ?? '');
    if (validation || cooldown) return;
    void request.run(
      async (signal, current) => {
        await api.forgot(email, signal);
        if (current()) {
          flow.setEmail(email);
          flow.cooldown('recovery');
          setAck(true);
        }
      },
      (cause) => {
        setError(authError(cause));
        if (cause instanceof ApiError && cause.status === 429)
          flow.cooldown('recovery', retryDelay(cause));
      },
    );
  };
  return (
    <AuthFrame
      title="Forgot your password?"
      subtitle="Enter your email to request a password reset link."
      back={back}
    >
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
        onSubmitEditing={submit}
        editable={!request.pending}
      />
      {error && <AuthText error>{error}</AuthText>}
      {ack && (
        <AuthText>
          If this email is eligible, a recovery link may arrive. Delivery may be
          delayed or unavailable. Check your inbox and spam folder.
        </AuthText>
      )}
      {request.pending && (
        <AuthText>
          Requesting a recovery link. This can take a little while…
        </AuthText>
      )}
      <Button
        label={cooldown ? `Request again in ${cooldown}s` : 'Send reset link'}
        loading={request.pending}
        disabled={!!cooldown}
        onPress={submit}
      />
      <AuthText>
        Open the link in your email to reset your password securely in your
        browser. Then return to the app and sign in with your new password.
      </AuthText>
    </AuthFrame>
  );
}

export function ResetPasswordScreen() {
  const { api, flow } = useAuth(),
    state = useAuthFlow(),
    router = useRouter(),
    request = usePublicRequest();
  const [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [errors, setErrors] = useState<Record<string, string | undefined>>({}),
    [error, setError] = useState('');
  const confirmation = useRef<ComponentRef<typeof TextInput>>(null);
  const valid = state.hasProof && state.proofKind === 'reset-password';
  useFocusEffect(
    useCallback(
      () => () => {
        setPassword('');
        setConfirm('');
        flow.cancelProof('reset-password');
      },
      [flow],
    ),
  );
  const back = () => {
    request.cancel();
    setPassword('');
    setConfirm('');
    flow.cancelProof('reset-password');
    router.replace('/sign-in');
  };
  const recover = () => {
    request.cancel();
    setPassword('');
    setConfirm('');
    flow.cancelProof('reset-password');
    router.replace('/forgot-password');
  };
  const submit = () => {
    const validation = {
      password: passwordError(password),
      confirm: confirmationError(password, confirm),
    };
    setErrors(validation);
    if (Object.values(validation).some(Boolean) || request.pending || !valid)
      return;
    const proof = flow.takeProof('reset-password');
    if (!proof) return;
    const draft = password;
    setPassword('');
    setConfirm('');
    setError('');
    void request.run(
      async (signal, current) => {
        await api.reset(proof, draft, signal);
        if (current()) {
          flow.notice('Password reset. Sign in with your new password.');
          router.replace('/sign-in');
        }
      },
      (cause) =>
        setError(
          cause instanceof ApiError && cause.code === 'PASSWORD_REUSED'
            ? authError(cause)
            : 'This recovery link is invalid, expired, already used, or could not be confirmed. Request a new link. If the reset completed, sign in with your new password.',
        ),
    );
  };
  return (
    <AuthFrame
      title="Reset your password"
      subtitle="Choose a new password, then sign in again."
      back={back}
    >
      {!valid && !request.pending && (
        <AuthText error>
          Open a valid password reset link from your email. Request a new link
          if yours expired or was already used.
        </AuthText>
      )}
      <PasswordField
        inlineToggle
        label="New password"
        leading={<AuthIcon kind="lock" />}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint={PASSWORD_HINT}
        editable={valid && !request.pending}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmation.current?.focus()}
      />
      <PasswordField
        ref={confirmation}
        inlineToggle
        label="Confirm password"
        leading={<AuthIcon kind="lock" />}
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        editable={valid && !request.pending}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={submit}
        showPasswordLabel="Show confirmed password"
        hidePasswordLabel="Hide confirmed password"
      />
      {error && <AuthText error>{error}</AuthText>}
      <Button
        label="Reset password"
        loading={request.pending}
        disabled={!valid}
        onPress={submit}
      />
      <AuthLink label="Request a new reset link" onPress={recover} />
    </AuthFrame>
  );
}
