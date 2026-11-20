import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useDraftNavigation } from '../../../navigation/useDraftNavigation';
import {
  Button,
  ScreenHeader,
  Skeleton,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { PreferenceSections } from './PreferenceSections';
import { preferencesError } from './status';
import { usePreferences } from './usePreferences';

export function NotificationPreferencesScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <Preferences
      key={session.user.id + ':' + session.generation}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function Preferences({ identity }: { identity: SessionIdentity }) {
  const c = useTheme(),
    router = useRouter(),
    editor = usePreferences(identity);
  const { form, query, mutation } = editor;
  const navigation = useDraftNavigation(editor, '/notification-preferences');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.lg,
          width: '100%',
          maxWidth: 720,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void editor.refresh()}
            tintColor={c.primary}
          />
        }
      >
        <ScreenHeader
          title="Notification preferences"
          subtitle="Choose which updates you want to receive."
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={editor.pending}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/inbox')
              }
            />
          }
        />
        {mutation.pending === 'save' && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            Saving preferences… Please wait before leaving.
          </Text>
        )}
        {!editor.online && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            You’re offline. Your draft is kept; reconnect to load or save
            preferences.
          </Text>
        )}
        {!form && !query.isError && (
          <View accessibilityLiveRegion="polite" style={{ gap: spacing.sm }}>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              Loading notification preferences…
            </Text>
            <Skeleton height={100} />
            <Skeleton height={100} />
          </View>
        )}
        {query.isError && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              {form
                ? 'Couldn’t refresh preferences. Saved data may be stale; your draft is kept. '
                : ''}
              {preferencesError(query.error)}
            </Text>
            <Button
              label="Retry preferences"
              variant="secondary"
              disabled={!editor.canRefresh}
              onPress={() => void editor.refresh()}
            />
          </View>
        )}
        {!!mutation.error && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            {preferencesError(mutation.error, true)}
          </Text>
        )}
        {mutation.mustVerify && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              Save wasn’t confirmed. Check server preferences before another
              save. Your draft is kept.
            </Text>
            <Button
              label="Check server preferences"
              loading={mutation.pending === 'verify'}
              disabled={!editor.canRefresh}
              onPress={() => void editor.refresh()}
            />
          </View>
        )}
        {form?.conflict && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              Preferences changed — review your choices. Untouched settings now
              reflect the server; your edits are kept.
            </Text>
            <Button
              label="Review and keep my edits"
              variant="secondary"
              disabled={editor.pending || mutation.mustVerify}
              onPress={editor.acknowledge}
            />
            <Button
              label="Reload server values"
              variant="secondary"
              disabled={editor.pending}
              onPress={editor.cancel}
            />
          </View>
        )}
        {!!editor.notice && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            {editor.notice}
          </Text>
        )}
        {form && (
          <>
            <PreferenceSections
              draft={form.draft}
              emailEnabled={editor.emailEnabled}
              disabled={editor.pending || !editor.online || mutation.mustVerify}
              onEdit={editor.edit}
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1, minWidth: 120 }}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={!editor.dirty || editor.pending}
                  onPress={editor.cancel}
                />
              </View>
              <View style={{ flex: 1, minWidth: 160 }}>
                <Button
                  label="Save changes"
                  loading={mutation.pending === 'save'}
                  disabled={!editor.canSave}
                  onPress={() => void editor.save()}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="Your notification preference changes have not been saved."
      />
    </SafeAreaView>
  );
}
