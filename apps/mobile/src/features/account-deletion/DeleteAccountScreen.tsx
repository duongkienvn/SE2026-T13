import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, Text, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AccountDeletionBlockerType } from '@kanban/shared';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  PasswordField,
  ScreenHeader,
  Surface,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { blockerCopy, blockerDestination } from './blockers';
import { useDeletion } from './useDeletion';

export function DeleteAccountScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <DeletionContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function DeletionContent({ identity }: { identity: SessionIdentity }) {
  const form = useDeletion(identity),
    router = useRouter(),
    data = useMobileData(),
    c = useTheme();
  const navigation = useDraftNavigation(form, '/delete-account');
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null),
    confirmationInput = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (form.pending || !form.eligible || !form.error) return;
    if (form.error.includes('password is incorrect'))
      passwordInput.current?.focus();
    else if (form.error.startsWith('Enter DELETE'))
      confirmationInput.current?.focus();
  }, [form.error, form.pending, form.eligible]);
  const active = useRef<AbortController | null>(null),
    [checking, setChecking] = useState(false),
    [linkError, setLinkError] = useState('');
  useFocusEffect(
    useCallback(
      () => () => {
        active.current?.abort();
        setChecking(false);
        setLinkError('');
      },
      [],
    ),
  );
  async function open(type: AccountDeletionBlockerType, id: string) {
    if (active.current || form.pending) return;
    const controller = new AbortController();
    active.current = controller;
    setChecking(true);
    setLinkError('');
    try {
      const path = await blockerDestination(
        data,
        identity,
        type,
        id,
        controller.signal,
      );
      data.assertCurrent(identity);
      if (controller.signal.aborted) return;
      if (path) {
        form.cancel();
        router.push(path);
      } else
        setLinkError(
          'Your permission to manage this resource has changed. Ask an authorized Board owner or Team workspace admin to help, then refresh. Workspace ADMIN does not grant Board ownership.',
        );
    } catch {
      if (!controller.signal.aborted)
        setLinkError(
          'Could not verify resource access. Reconnect and refresh before continuing.',
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setChecking(false);
      }
    }
  }
  const text = (value: string) => (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.textSecondary }]}
    >
      {value}
    </Text>
  );
  const title = (value: string, danger = false) => (
    <Text
      accessibilityRole="header"
      style={[typography.section, { color: danger ? c.danger : c.text }]}
    >
      {value}
    </Text>
  );
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
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader
          title="Delete account"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={form.pending || checking}
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace('/data-privacy')
              }
            />
          }
        />
        <Surface>
          {title('This is permanent', true)}
          {text(
            'Your identity, profile, preferences, memberships and personal notifications will be removed. There is no undo period.',
          )}
          {text(
            'Shared boards, cards and comments remain, attributed to Deleted user. Creating a new account will not restore your previous memberships.',
          )}
          {text(
            'Export your account data first if you need a copy. Resolve any ownership or workspace requirements before trying again.',
          )}
        </Surface>
        {!form.online &&
          text(
            'You’re offline. Reconnect to verify your identity. No deletion will be retried automatically.',
          )}
        {form.pending &&
          text('Checking your account securely… Do not repeat this request.')}
        {!!form.error && text(form.error)}
        {!!form.cooldown && text(`Try again in ${form.cooldown} seconds.`)}
        <Button
          label="Refresh verification methods"
          variant="secondary"
          disabled={!form.online || form.pending || !!form.cooldown}
          onPress={() => {
            form.cancel();
            void form.refresh();
          }}
        />
        {form.providers?.googleLinked &&
          !form.methods.includes('google') &&
          text(
            'Google verification requires a configured native build. Use your password if available, or the verified deletion flow on Kanvexa Web.',
          )}
        {form.providers &&
          !form.methods.length &&
          text(
            'No supported verification method is available here. Use Kanvexa Web with a linked sign-in method.',
          )}
        <Surface>
          {title('Verify your identity')}
          {form.methods.map((method) => (
            <Button
              key={method}
              label={
                method === 'password'
                  ? 'Use current password'
                  : 'Verify with linked Google'
              }
              variant={form.method === method ? 'primary' : 'secondary'}
              disabled={form.pending || !!form.cooldown || !form.online}
              onPress={() => form.choose(method)}
            />
          ))}
          {form.method === 'password' && (
            <PasswordField
              ref={passwordInput}
              label="Current password"
              value={form.password}
              onChangeText={form.passwordInput}
              editable={!form.pending}
              maxLength={256}
              autoComplete="off"
              textContentType="none"
              hint="Your current Kanvexa password. It is never stored."
            />
          )}
          <TextField
            ref={confirmationInput}
            label="Type DELETE to confirm"
            value={form.confirmation}
            onChangeText={form.confirmationInput}
            editable={!form.pending}
            maxLength={20}
            autoCorrect={false}
            autoCapitalize="characters"
            autoComplete="off"
            hint="Enter the exact uppercase word DELETE, without spaces."
          />
          <Button
            label="Review deletion"
            variant="destructive"
            disabled={!form.valid || checking}
            onPress={() => form.setReview(true)}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={form.pending || checking}
            onPress={() => {
              form.cancel();
              if (router.canGoBack()) router.back();
              else router.replace('/data-privacy');
            }}
          />
        </Surface>
        {!!linkError && text(linkError)}
        {form.blockers.map((blocker) => (
          <Surface key={blocker.type}>
            {title(blockerCopy[blocker.type].title)}
            {text(blockerCopy[blocker.type].help)}
            {text(`Total: ${blocker.totalCount}.`)}
            {blocker.resources.length < blocker.totalCount &&
              text(
                `Showing ${blocker.resources.length} of ${blocker.totalCount} resources.`,
              )}
            {blocker.resources.map((resource) => (
              <View key={resource.id} style={{ gap: spacing.sm }}>
                {text(resource.name)}
                <Button
                  label={`${blockerCopy[blocker.type].action}: ${resource.name}`}
                  variant="secondary"
                  disabled={checking || form.pending || !form.online}
                  onPress={() => void open(blocker.type, resource.id)}
                />
              </View>
            ))}
          </Surface>
        ))}
        {form.blockers.length > 0 &&
          text(
            'After correcting resources, return here and refresh. Deletion requires a new confirmation and fresh proof; it never resumes automatically.',
          )}
      </ScrollView>
      <ConfirmDialog
        visible={form.review}
        title="Permanently delete your account?"
        message="This cannot be undone. Shared work remains with Deleted user attribution, and a new account does not restore memberships. Your identity will be verified before deletion."
        confirmLabel="Delete my account"
        cancelLabel="Keep my account"
        destructive
        confirmDisabled={!form.valid}
        loading={form.pending}
        onCancel={() => form.setReview(false)}
        onConfirm={form.submit}
      />
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onKeepEditing={navigation.keepEditing}
        onDiscard={navigation.discard}
      />
    </SafeAreaView>
  );
}
