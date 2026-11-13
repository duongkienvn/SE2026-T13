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
  useCooldown,
  usePublicRequest,
} from './runtime';
import {
  confirmationError,
  emailError,
  nameError,
  passwordError,
  PASSWORD_HINT,
} from './validation';

export function SignUpScreen() {
  const { api, flow } = useAuth(),
    state = useAuthFlow(),
    router = useRouter(),
    request = usePublicRequest();
  const [name, setName] = useState(''),
    [email, setEmail] = useState(state.email),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({}),
    [error, setError] = useState(''),
    [until, setUntil] = useState(0),
    [uncertain, setUncertain] = useState(false),
    [via, setVia] = useState<'email' | 'google'>('email');
  const cooldown = useCooldown(until),
    emailInput = useRef<ComponentRef<typeof TextInput>>(null),
    passwordInput = useRef<ComponentRef<typeof TextInput>>(null),
    confirmInput = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusEffect(
    useCallback(
      () => () => {
        setPassword('');
        setConfirm('');
      },
      [],
    ),
  );
  const back = () => {
    request.cancel();
    setPassword('');
    setConfirm('');
    flow.setEmail(email);
    router.replace('/sign-in');
  };
  const check = (failed = false) => {
    setPassword('');
    setConfirm('');
    flow.checkEmail(email, failed);
    router.replace('/verify-email');
  };
  const submit = () => {
    const validation = {
      name: nameError(name),
      email: emailError(email),
      password: passwordError(password),
      confirm: confirmationError(password, confirm),
    };
    setErrors(validation);
    if (Object.values(validation).some(Boolean) || cooldown || uncertain)
      return;
    setError('');
    setVia('email');
    void request.run(
      async (signal, current) => {
        await api.register(name, email, password, signal);
        if (current()) check();
      },
      (cause) => {
        setPassword('');
        setConfirm('');
        if (
          cause instanceof ApiError &&
          cause.code === 'MAIL_DELIVERY_UNAVAILABLE'
        ) {
          check(true);
          return;
        }
        setError(authError(cause));
        if (cause instanceof ApiError && cause.status === 429)
          setUntil(Date.now() + retryDelay(cause));
        // Lost responses can follow a committed account. Never replay registration automatically.
        if (
          cause instanceof ApiError &&
          (cause.kind === 'timeout' ||
            cause.kind === 'network' ||
            cause.status >= 500)
        )
          setUncertain(true);
      },
    );
  };
  // Google creates (or reuses) the account server-side; no local registration.
  const google: GoogleFeedback = {
    onStart: () => {
      setVia('google');
      setPassword('');
      setConfirm('');
      setError('');
    },
    onError: setError,
    onUnverified: () => {},
    onCooldown: setUntil,
  };
  return (
    <AuthFrame
      title="Create your account"
      subtitle="Get started with Kanvexa in a few steps"
      back={back}
    >
      <TextField
        label="Full name"
        leading={<AuthIcon kind="person" />}
        value={name}
        onChangeText={setName}
        error={errors.name}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailInput.current?.focus()}
        editable={!request.pending}
      />
      <TextField
        ref={emailInput}
        label="Email address"
        leading={<AuthIcon kind="mail" />}
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
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
        hint={PASSWORD_HINT}
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => confirmInput.current?.focus()}
        editable={!request.pending}
      />
      <PasswordField
        ref={confirmInput}
        inlineToggle
        label="Confirm password"
        leading={<AuthIcon kind="lock" />}
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={submit}
        editable={!request.pending}
        showPasswordLabel="Show confirmed password"
        hidePasswordLabel="Hide confirmed password"
      />
      {error && <AuthText error>{error}</AuthText>}
      {uncertain && (
        <>
          <AuthText>
            Your account may have been created. Check your email, sign in, or
            request verification before registering again.
          </AuthText>
          <AuthLink
            label="Check email or resend verification"
            onPress={() => check()}
          />
        </>
      )}
      <Button
        label={cooldown ? `Try again in ${cooldown}s` : 'Sign up'}
        loading={request.pending && via === 'email'}
        disabled={
          !!cooldown || uncertain || (request.pending && via === 'google')
        }
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
        <AuthText>Already have an account?</AuthText>
        <AuthLink label="Sign in" onPress={back} />
      </View>
    </AuthFrame>
  );
}
