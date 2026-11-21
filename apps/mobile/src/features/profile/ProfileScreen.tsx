import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ScreenHeader,
  Skeleton,
  Surface,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { validDisplayName } from './model';
import { PrivateAvatar } from './PrivateAvatar';
import { profileError } from './status';
import { useProfile } from './useProfile';

export function ProfileScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <ProfileContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function ProfileContent({ identity }: { identity: SessionIdentity }) {
  const editor = useProfile(identity),
    c = useTheme(),
    router = useRouter(),
    navigation = useDraftNavigation(editor, '/profile');
  const [confirm, setConfirm] = useState(false);
  const profile = editor.form?.saved;
  const status = (text: string) => (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.textSecondary }]}
    >
      {text}
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
        refreshControl={
          <RefreshControl
            refreshing={editor.query.isRefetching}
            onRefresh={() => void editor.refresh()}
            tintColor={c.primary}
          />
        }
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader
          title={editor.editing ? 'Edit profile' : 'Profile'}
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={editor.pending}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings')
              }
            />
          }
        />
        {!editor.online &&
          status(
            'You’re offline. Showing previously loaded account details; reconnect to refresh or save.',
          )}
        {!profile && !editor.query.isError && (
          <>
            <Skeleton height={160} />
            {status('Loading profile…')}
          </>
        )}
        {editor.query.isError && (
          <>
            {status(profileError(editor.query.error))}
            <Button
              label="Retry profile"
              variant="secondary"
              disabled={!editor.online || editor.pending}
              onPress={() => void editor.refresh()}
            />
          </>
        )}
        {!!editor.error && status(editor.error)}
        {!!editor.notice && status(editor.notice)}
        {!!editor.cooldown &&
          status(`Try again in ${editor.cooldown} seconds.`)}
        {editor.mutation.uncertain && (
          <Surface>
            {editor.mutation.recovery && (
              <Button
                label="Retry same photo operation"
                disabled={!editor.online || editor.pending || !!editor.cooldown}
                onPress={() => void editor.retryAvatar()}
              />
            )}
            {status(
              'The earlier change was not confirmed. Further changes are blocked to prevent a late operation overwriting your choices. A refresh can show observed values, but cannot prove that operation finished.',
            )}
            <Button
              label="Check server profile"
              variant="secondary"
              disabled={!editor.online || editor.pending}
              onPress={() => void editor.refresh()}
            />
            {editor.mutation.observation &&
              status(
                `Observed server name: ${editor.mutation.observation.displayName}. Changes remain blocked.`,
              )}
          </Surface>
        )}
        {profile && (
          <>
            <Surface>
              <View
                style={{
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.lg,
                }}
              >
                <PrivateAvatar
                  profile={profile}
                  identity={identity}
                  refreshKey={editor.query.dataUpdatedAt}
                />
                <Text
                  accessibilityRole="header"
                  style={[
                    typography.section,
                    { color: c.text, textAlign: 'center' },
                  ]}
                >
                  {profile.displayName}
                </Text>
                <Text
                  selectable
                  style={[
                    typography.body,
                    { color: c.textSecondary, textAlign: 'center' },
                  ]}
                >
                  {profile.email}
                </Text>
              </View>
              <Button
                label="Choose photo"
                variant="secondary"
                disabled={!editor.ready}
                onPress={() => void editor.choose()}
              />
              {!!profile.avatarUrl && (
                <Button
                  label="Remove photo"
                  variant="link"
                  disabled={!editor.ready}
                  onPress={() => setConfirm(true)}
                />
              )}
              {status('Private photo · JPEG, PNG or WebP · up to 5 MiB')}
              {editor.photo && (
                <View style={{ gap: spacing.sm, alignItems: 'center' }}>
                  <Image
                    source={{ uri: editor.photo.uri, cache: 'reload' }}
                    accessibilityLabel="Selected photo preview, not yet saved"
                    style={{ width: 96, height: 96, borderRadius: 48 }}
                  />
                  {status('Selected photo preview — not saved yet.')}
                  <Button
                    label="Upload photo"
                    disabled={!editor.ready}
                    onPress={() => void editor.upload()}
                  />
                  <Button
                    label="Cancel selected photo"
                    variant="link"
                    disabled={editor.pending}
                    onPress={editor.clearPhoto}
                  />
                </View>
              )}
            </Surface>
            {editor.editing ? (
              <Surface>
                <TextField
                  label="Display name"
                  value={editor.form?.text ?? ''}
                  onChangeText={editor.text}
                  editable={!editor.pending && !editor.mutation.uncertain}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="done"
                  hint="Use 2–80 characters. Leading and trailing spaces are removed."
                  error={
                    !validDisplayName(editor.form?.text)
                      ? 'Enter a display name of 2–80 characters.'
                      : undefined
                  }
                />
                {status(
                  'Email is read-only here. Use Change email to verify a new address.',
                )}
                {editor.form?.conflict && (
                  <>
                    {status(
                      'Your name changed on another client. Your draft is kept; review the current name above before saving.',
                    )}
                    <Button
                      label="Review and keep my name"
                      variant="secondary"
                      disabled={editor.pending}
                      onPress={editor.acknowledge}
                    />
                  </>
                )}
                <Button
                  label="Save changes"
                  loading={editor.mutation.pending === 'name'}
                  disabled={!editor.canSave}
                  onPress={() => void editor.save()}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={editor.pending}
                  onPress={editor.cancel}
                />
              </Surface>
            ) : (
              <Button
                label="Edit profile"
                disabled={!editor.ready}
                onPress={editor.edit}
              />
            )}
            <Button
              label="Change email"
              variant="secondary"
              disabled={editor.dirty || editor.pending}
              onPress={() => router.push('/change-email')}
            />
          </>
        )}
        {editor.pending &&
          status(editor.phase || 'Saving profile… Please wait before leaving.')}
        <Button
          label="Refresh profile"
          variant="link"
          disabled={!editor.online || editor.pending || editor.query.isFetching}
          onPress={() => void editor.refresh()}
        />
      </ScrollView>
      <ConfirmDialog
        visible={confirm}
        title="Remove profile photo?"
        message="Your account will use initials until you upload another photo."
        confirmLabel="Remove photo"
        onConfirm={() => {
          setConfirm(false);
          void editor.remove();
        }}
        onCancel={() => setConfirm(false)}
        destructive
      />
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="Your profile changes have not been saved."
      />
    </SafeAreaView>
  );
}
