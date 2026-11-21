import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  AppHeader,
  Button,
  PasswordField,
  ScreenHeader,
  Skeleton,
  Surface,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { EMAIL_CHANGE_ACCEPTANCE, EMAIL_CHANGE_HANDOFF } from './email-change';
import { useEmailChange } from './useEmailChange';

export function ChangeEmailScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <ChangeEmailContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
      currentEmail={session.user.email}
    />
  );
}
function ChangeEmailContent({
  identity,
  currentEmail,
}: {
  identity: SessionIdentity;
  currentEmail: string;
}) {
  const editor = useEmailChange(identity, currentEmail),
    router = useRouter(),
    c = useTheme(),
    navigation = useDraftNavigation(editor, '/change-email');
  const status = (text: string) => (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.textSecondary }]}
    >
      {text}
    </Text>
  );
  const summary = editor.summary.data;
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
            refreshing={editor.summary.isRefetching}
            onRefresh={() => void editor.refresh()}
            tintColor={c.primary}
          />
        }
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader
          title="Change email"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={editor.pending}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/profile')
              }
            />
          }
        />
        <Surface>
          <Text style={[typography.strong, { color: c.text }]}>
            Current email
          </Text>
          <Text
            selectable
            style={[typography.body, { color: c.textSecondary }]}
          >
            {currentEmail}
          </Text>
          {status(
            'Your current email stays active until the secure Web confirmation succeeds.',
          )}
        </Surface>
        {!editor.online &&
          status(
            'You’re offline. Pending status may be stale. Reconnect to verify your account or request a change.',
          )}
        {editor.providers.isPending && (
          <>
            <Skeleton height={100} />
            {status('Loading verification methods…')}
          </>
        )}
        {(editor.providers.isError || editor.summary.isError) && (
          <>
            {status(
              'Could not refresh verification methods or pending status. Please try again.',
            )}
            <Button
              label="Retry email status"
              variant="secondary"
              disabled={editor.pending || !editor.online}
              onPress={() => void editor.refresh()}
            />
          </>
        )}
        {editor.providers.data?.googleLinked &&
          !editor.methods.includes('google') &&
          status(
            'Google verification needs a configured native build. Use your current password if available, or request the change on Kanvexa Web.',
          )}
        {editor.providers.data &&
          !editor.methods.length &&
          status(
            'No verification method is available in this build. Use Kanvexa Web with a linked verification method.',
          )}
        {editor.methods.length > 0 && (
          <Surface>
            <TextField
              label="New email"
              value={editor.newEmail}
              onChangeText={editor.email}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              maxLength={254}
              editable={!editor.pending}
              error={editor.fieldError}
              hint="Enter a different email address you control."
            />
            {editor.methods.length > 1 && (
              <>
                <Button
                  label="Use current password"
                  variant={
                    editor.method === 'password' ? 'primary' : 'secondary'
                  }
                  disabled={editor.pending}
                  onPress={() => editor.choose('password')}
                />
                <Button
                  label="Use linked Google"
                  variant={editor.method === 'google' ? 'primary' : 'secondary'}
                  disabled={editor.pending}
                  onPress={() => editor.choose('google')}
                />
              </>
            )}
            {editor.method === 'password' ? (
              <PasswordField
                label="Current password"
                value={editor.password}
                onChangeText={editor.passwordText}
                autoComplete="current-password"
                textContentType="password"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={128}
                editable={!editor.pending}
              />
            ) : (
              status(
                'Choose your linked Google account for a fresh verification. This does not sign in as a different Kanvexa account.',
              )
            )}
            <Button
              label={
                editor.method === 'google'
                  ? 'Verify with linked Google'
                  : 'Request email change'
              }
              loading={editor.pending}
              disabled={editor.blocked || !editor.valid}
              onPress={() => void editor.submit()}
            />
            <Button
              label="Clear form"
              variant="secondary"
              disabled={editor.pending || !editor.dirty}
              onPress={editor.cancel}
            />
          </Surface>
        )}
        {editor.pending &&
          status(
            'Verifying your request… This normally takes at least 10 seconds. Please wait before leaving.',
          )}
        {!!editor.error && status(editor.error)}
        {editor.accepted && status(EMAIL_CHANGE_ACCEPTANCE)}
        {!!editor.cooldown &&
          status(`You can request again in ${editor.cooldown} seconds.`)}
        {summary && !editor.expired && (
          <Surface>
            <Text
              accessibilityRole="header"
              style={[typography.strong, { color: c.text }]}
            >
              Email change pending
            </Text>
            {status(
              `${summary.maskedNewEmail} · expires in ${Math.ceil((Date.parse(summary.expiresAt) - editor.now) / 60_000)} minutes.`,
            )}
            {status('Pending status does not confirm email delivery.')}
          </Surface>
        )}
        {editor.expired &&
          status(
            'The previously observed request expired. Refresh to check current pending status.',
          )}
        {editor.summary.isSuccess &&
          !summary &&
          status('No pending email change reported by the server.')}
        <Surface>
          {status(EMAIL_CHANGE_HANDOFF)}
          {status(
            'Use only the HTTPS confirmation link generated by Kanvexa in the email. Confirmation is handled on the trusted Web page; no email token is entered or stored in this app.',
          )}
        </Surface>
        <Button
          label="Refresh email status"
          variant="link"
          disabled={
            editor.pending ||
            !editor.online ||
            editor.summary.isFetching ||
            editor.providers.isFetching
          }
          onPress={() => void editor.refresh()}
        />
      </ScrollView>
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="Your new email and verification input will be discarded."
      />
    </SafeAreaView>
  );
}
