import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ApiError } from '../../infrastructure/api/errors';
import { Button, PasswordField, TextField } from '../../ui';
import { AuthFrame, AuthIcon, AuthLink, AuthText } from './components';
import { GoogleSignInOption, type GoogleFeedback } from './GoogleSignIn';
import {
  authError,
  retryDelay,
  useAuth,
  useAuthFlow,
  useAuthSession,
  useCooldown,
  usePublicRequest,
} from './runtime';
import { emailError, passwordError } from './validation';

export function SignInScreen() {
  const { api, manager, flow } = useAuth(),
    state = useAuthFlow(),
    session = useAuthSession();
  const router = useRouter(),
    request = usePublicRequest();
  const [email, setEmail] = useState(state.email),
    [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [error, setError] = useState(''),
    [unverified, setUnverified] = useState(false),
    [until, setUntil] = useState(0),
    [via, setVia] = useState<'email' | 'google'>('email');
  const cooldown = useCooldown(until),
    passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusEffect(
    useCallback(
      () => () => {
        setPassword('');
        setError('');
        setUnverified(false);
      },
      [],
    ),
  );
  const navigate = (
    path: '/sign-up' | '/forgot-password' | '/verify-email',
  ) => {
    request.cancel();
    setPassword('');
    flow.setEmail(email);
    router.push(path);
  };
  const submit = () => {
    const validation = {
      email: emailError(email),
      password: passwordError(password, false),
    };
    setErrors(validation);
    if (validation.email || validation.password || cooldown) return;
    setError('');
    setUnverified(false);
    setVia('email');
    void request.run(
      async (signal, current) => {
        const response = await api.login(email, password, signal);
        if (!current()) return;
        setPassword('');
        const result = await manager.establishSession(response, signal);
        if (!result.ok && result.reason !== 'superseded' && !signal.aborted)
          setError(
            result.reason === 'unavailable'
              ? 'Connect to verify your session.'
              : 'Sign in could not be verified. Please try again.',
          );
        // RootStack owns the validated return target and authenticated navigation.
      },
      (cause) => {
        setPassword('');
        setError(authError(cause));
        if (cause instanceof ApiError && cause.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(true);
          setError('Verify your email before signing in.');
        }
        if (cause instanceof ApiError && cause.status === 429)
          setUntil(Date.now() + retryDelay(cause));
      },
    );
  };
  const google: GoogleFeedback = {
    onStart: () => {
      setVia('google');
      setPassword('');
      setError('');
      setUnverified(false);
    },
    onError: setError,
    onUnverified: () => setUnverified(true),
    onCooldown: setUntil,
  };
  if (
    session.status === 'restoring' ||
    session.status === 'verifying' ||
    session.status === 'authenticated'
  )
    return (
      <AuthFrame
        title="Checking session"
        subtitle="Please wait while we securely verify your session."
      >
        <AuthText>Checking your account…</AuthText>
      </AuthFrame>
    );
  if (session.status === 'offline-uncertain')
    return (
      <AuthFrame
        title="Connection unavailable"
        subtitle="Connect to the internet to verify your session."
      >
        <Button
          label="Retry verification"
          onPress={() => void manager.retryVerification()}
        />
      </AuthFrame>
    );
  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to your Kanvexa account">
      {session.status === 'expired' && (
        <AuthText>Your session expired. Sign in again.</AuthText>
      )}
      {state.notice && <AuthText>{state.notice}</AuthText>}
      <TextField
        label="Email address"
        leading={<AuthIcon kind="mail" />}
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordInput.current?.focus()}
        editable={!request.pending}
      />
      <PasswordField
        ref={passwordInput}
        inlineToggle
        label="Password"
        leading={<AuthIcon kind="lock" />}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={submit}
        editable={!request.pending}
      />
      <View style={{ alignSelf: 'flex-end' }}>
        <AuthLink
          label="Forgot password?"
          onPress={() => navigate('/forgot-password')}
        />
      </View>
      {error && <AuthText error>{error}</AuthText>}
      {unverified && (
        <AuthLink
          label="Verify email or resend link"
          onPress={() => navigate('/verify-email')}
        />
      )}
      <Button
        label={cooldown ? `Try again in ${cooldown}s` : 'Sign in'}
        loading={request.pending && via === 'email'}
        disabled={!!cooldown || (request.pending && via === 'google')}
        onPress={submit}
      />
      <GoogleSignInOption
        request={request}
        disabled={!!cooldown}
        feedback={google}
      />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AuthText>Don’t have an account?</AuthText>
        <AuthLink label="Sign up" onPress={() => navigate('/sign-up')} />
      </View>
    </AuthFrame>
  );
}
