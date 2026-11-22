import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  PasswordField,
  ScreenHeader,
  Skeleton,
  Surface,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { PASSWORD_HINT } from '../auth/validation';
import { useRecoveryHandoff } from './recovery';
import { useChangePassword } from './useAccountSecurity';

export function SecurityScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <SecurityContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
      email={session.user.email}
    />
  );
}

export function StatusText({ children }: { children: string }) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.textSecondary }]}
    >
      {children}
    </Text>
  );
}

function SecurityContent({
  identity,
  email,
}: {
  identity: SessionIdentity;
  email: string;
}) {
  const form = useChangePassword(identity),
    router = useRouter(),
    c = useTheme(),
    navigation = useDraftNavigation(form, '/security'),
    recovery = useRecoveryHandoff(email),
    [confirmRecovery, setConfirmRecovery] = useState(false);
  const query = form.providers.query;
  const disabled = form.pending || recovery.pending;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.lg,
          width: '100%',
          maxWidth: 640,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void form.providers.refresh()}
            tintColor={c.primary}
          />
        }
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader
          title="Security"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={disabled}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings')
              }
            />
          }
        />
        <StatusText>
          Keep your sign-in safe. Changing your password signs you out
          everywhere, including this device.
        </StatusText>
        {!form.providers.online && (
          <StatusText>
            You’re offline. Reconnect to check your sign-in methods or change
            your password.
          </StatusText>
        )}
        {query.isPending && !query.isError && (
          <>
            <Skeleton height={120} />
            <StatusText>Checking your sign-in methods…</StatusText>
          </>
        )}
        {query.isError && !query.data && (
          <>
            <StatusText>
              Could not check whether this account has a password. Please try
              again.
            </StatusText>
            <Button
              label="Retry security status"
              variant="secondary"
              disabled={disabled || !form.providers.online}
              onPress={() => void form.providers.refresh()}
            />
          </>
        )}
        {form.hasPassword === true && (
          <Surface>
            <Text
              accessibilityRole="header"
              style={[typography.strong, { color: c.text }]}
            >
              Change password
            </Text>
            <PasswordField
              label="Current password"
              value={form.draft.currentPassword}
              onChangeText={form.currentPassword}
              autoComplete="current-password"
              textContentType="password"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={128}
              editable={!form.pending}
              error={form.errors.currentPassword}
            />
            <PasswordField
              label="New password"
              value={form.draft.newPassword}
              onChangeText={form.newPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8; maxlength: 128; required: upper; required: digit; required: special;"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={256}
              editable={!form.pending}
              error={form.errors.newPassword}
              hint={PASSWORD_HINT}
              showPasswordLabel="Show new password"
              hidePasswordLabel="Hide new password"
            />
            <PasswordField
              label="Confirm new password"
              value={form.draft.confirmation}
              onChangeText={form.confirmation}
              autoComplete="new-password"
              textContentType="newPassword"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={256}
              editable={!form.pending}
              error={form.errors.confirmation}
              showPasswordLabel="Show confirmation"
              hidePasswordLabel="Hide confirmation"
            />
            <Button
              label="Change password"
              loading={form.pending}
              disabled={form.blocked}
              onPress={() => void form.submit()}
            />
            <Button
              label="Clear form"
              variant="secondary"
              disabled={form.pending || !form.dirty}
              onPress={form.cancel}
            />
          </Surface>
        )}
        {form.pending && (
          <StatusText>Changing your password… Please wait.</StatusText>
        )}
        {!!form.error && <StatusText>{form.error}</StatusText>}
        {!!form.cooldown && (
          <StatusText>{`You can try again in ${form.cooldown} seconds.`}</StatusText>
        )}
        {form.hasPassword === false && (
          <Surface>
            <Text
              accessibilityRole="header"
              style={[typography.strong, { color: c.text }]}
            >
              No password set
            </Text>
            <StatusText>
              This account signs in with Google and has no Kanvexa password. To
              set one, sign out and request a recovery link to your verified
              email.
            </StatusText>
          </Surface>
        )}
        {form.hasPassword !== undefined && (
          <Surface>
            <Text
              accessibilityRole="header"
              style={[typography.strong, { color: c.text }]}
            >
              {form.hasPassword ? 'Forgot your password?' : 'Set a password'}
            </Text>
            <StatusText>
              Password recovery happens signed out. A link may arrive at your
              verified email; after resetting, sign in with the new password.
            </StatusText>
            <Button
              label={
                form.hasPassword
                  ? 'Sign out and recover password'
                  : 'Sign out and set a password'
              }
              variant="secondary"
              loading={recovery.pending}
              disabled={disabled}
              onPress={() => setConfirmRecovery(true)}
            />
          </Surface>
        )}
        <Button
          label="Connected accounts"
          variant="link"
          disabled={disabled}
          onPress={() => router.push('/connected-accounts')}
        />
      </ScrollView>
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="The passwords you entered will be cleared."
      />
      <ConfirmDialog
        visible={confirmRecovery}
        title="Sign out to recover?"
        message="You’ll be signed out on this device, then you can request a password recovery link."
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirmRecovery(false);
          form.cancel();
          recovery.start();
        }}
        onCancel={() => setConfirmRecovery(false)}
      />
    </SafeAreaView>
  );
}
