import { useContext, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useDraftNavigation } from '../../../navigation/useDraftNavigation';
import {
  Button,
  PreferenceSwitch,
  ScreenHeader,
  Skeleton,
  Surface,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { PushContext } from '../context';
import { TimeSelector } from './TimeSelector';
import { validSchedule } from './model';
import { scheduleError } from './status';
import { useSchedule } from './useSchedule';

export function PushScheduleScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <Schedule
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
const noSubscribe = () => () => {};
const noPush = () => null;
function DeliveryStatus() {
  const controller = useContext(PushContext);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? noPush,
  );
  const c = useTheme();
  const account = state?.preferences;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityLiveRegion="polite"
        style={[typography.body, { color: c.textSecondary }]}
      >
        {!account
          ? 'Push delivery status is unavailable. Saving quiet hours does not enable Push.'
          : !account.deliveryAvailable
            ? 'Push delivery unavailable on this server. Your saved quiet hours are not currently active for delivery.'
            : !account.enabled
              ? 'Push is disabled for this account. Quiet hours can be edited, but do not currently affect delivery.'
              : 'Quiet hours apply to future server Push sends on eligible enrolled devices. Delivery is best effort.'}
      </Text>
      {state?.capability === 'needs-build' && (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          Remote push is unavailable in Expo Go. You can still configure your
          account’s quiet hours here.
        </Text>
      )}
    </View>
  );
}
function Schedule({ identity }: { identity: SessionIdentity }) {
  const c = useTheme(),
    router = useRouter(),
    editor = useSchedule(identity);
  const { form, query, mutation } = editor;
  const navigation = useDraftNavigation(editor, '/push-schedule');
  const schedule = form?.draft;
  const disabled = editor.pending || !editor.online || mutation.mustVerify;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
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
          title="Quiet hours"
          subtitle="Push notifications"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={editor.pending}
              onPress={() =>
                router.canGoBack()
                  ? router.back()
                  : router.replace('/notification-preferences')
              }
            />
          }
        />
        <Text style={[typography.body, { color: c.textSecondary }]}>
          New push alerts are held until quiet hours end, if they have not
          expired. Notifications still appear in Inbox.
        </Text>
        <DeliveryStatus />
        {!editor.online && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            You’re offline. Your draft is kept; reconnect to load or save quiet
            hours.
          </Text>
        )}
        {editor.pending && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            {mutation.pending === 'save'
              ? 'Saving quiet hours… Please wait before leaving.'
              : 'Checking server schedule…'}
          </Text>
        )}
        {!schedule && !query.isError && !mutation.mustVerify && (
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              Loading quiet hours…
            </Text>
            <Skeleton height={160} />
          </View>
        )}
        {query.isError && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              {form ? 'Couldn’t refresh quiet hours. Your draft is kept. ' : ''}
              {scheduleError(query.error)}
            </Text>
            <Button
              label="Retry quiet hours"
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
            {scheduleError(mutation.error, true)}
          </Text>
        )}
        {mutation.mustVerify && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              Save wasn’t confirmed. Further saves are blocked to protect your
              choices. Checking values cannot prove the earlier save finished.
              Your draft is kept.
            </Text>
            <Button
              label="Check server schedule"
              disabled={!editor.canRefresh}
              onPress={() => void editor.refresh()}
            />
          </View>
        )}
        {editor.observation && (
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.strong, { color: c.text }]}>
              Observed server values
            </Text>
            <Text
              selectable
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              Quiet hours {editor.observation.enabled ? 'On' : 'Off'} ·{' '}
              {editor.observation.startLocal}–{editor.observation.endLocal} ·{' '}
              {editor.observation.timeZone}
            </Text>
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              From the latest recovery check, not confirmation that the earlier
              save completed. Your draft is unchanged; saving remains blocked.
            </Text>
          </View>
        )}
        {form?.conflict && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              Quiet hours or account timezone changed. Your edits are kept;
              review the current timezone before saving.
            </Text>
            <Button
              label="Review and keep my edits"
              variant="secondary"
              disabled={disabled}
              onPress={editor.acknowledge}
            />
            <Button
              label="Reload server values"
              variant="secondary"
              disabled={disabled}
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
        {schedule && (
          <>
            <Surface>
              <PreferenceSwitch
                label="Quiet hours"
                description="Hold new Push alerts during this daily interval"
                value={schedule.enabled}
                disabled={disabled}
                onValueChange={(enabled) => editor.edit({ enabled })}
              />
              <TimeSelector
                label="Start time"
                value={schedule.startLocal}
                disabled={disabled}
                onChange={(startLocal) => editor.edit({ startLocal })}
              />
              <TimeSelector
                label="End time"
                value={schedule.endLocal}
                disabled={disabled}
                onChange={(endLocal) => editor.edit({ endLocal })}
              />
              <Text style={[typography.strong, { color: c.text }]}>
                Account time zone
              </Text>
              <Text
                selectable
                style={[typography.body, { color: c.textSecondary }]}
              >
                {schedule.timeZone}
              </Text>
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                Read-only here. Uses your saved account time zone, not this
                device’s clock. Overnight intervals are supported.
              </Text>
              {!validSchedule(schedule) && (
                <Text
                  accessibilityRole="alert"
                  style={[typography.body, { color: c.danger }]}
                >
                  Start and end must differ when quiet hours are enabled.
                </Text>
              )}
            </Surface>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1, minWidth: 100 }}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={!editor.dirty || editor.pending}
                  onPress={editor.cancel}
                />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Button
                  label="Save quiet hours"
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
        message="Your quiet-hours changes have not been saved."
      />
    </SafeAreaView>
  );
}
