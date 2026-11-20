import { createContext, useContext, useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';
import {
  Button,
  PreferenceSwitch,
  SectionHeader,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { PushController } from './controller';
export const PushContext = createContext<PushController | null>(null);
export function PushSection() {
  const controller = useContext(PushContext);
  return controller ? (
    <PushControls controller={controller} />
  ) : (
    <Surface>
      <SectionHeader title="Push notifications" />
      <Text>Push setup is unavailable in this runtime.</Text>
    </Surface>
  );
}
export function PushControls({ controller }: { controller: PushController }) {
  const c = useTheme(),
    state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    );
  const account = state.preferences;
  const unavailable =
    !account?.deliveryAvailable || state.capability !== 'ready';
  const disabled = state.busy || !state.online || state.uncertain || !account;
  const status = state.uncertain
    ? 'Push state is uncertain'
    : state.capability === 'needs-build'
      ? 'Needs development build — remote push is unavailable in Expo Go'
      : state.capability === 'setup-required'
        ? 'Setup required — this build has no valid EAS project'
        : state.capability === 'unavailable'
          ? 'Unavailable on this device'
          : !account
            ? 'Loading push preferences…'
            : !account.deliveryAvailable
              ? 'Unavailable — push delivery is disabled on this server'
              : state.permission === 'denied'
                ? 'Permission denied — allow notifications in system settings'
                : state.eligible && account.enabled
                  ? 'Enabled on this device'
                  : account.enabled
                    ? 'Not enabled on this device — permission and registration are required'
                    : 'Push is off. Enabling asks for notification permission on this device.';
  return (
    <Surface>
      <SectionHeader title="Push notifications" />
      <Text style={[typography.body, { color: c.textSecondary }]}>
        Push changes save immediately for your account. Messages shown outside
        the app contain no task or account details.
      </Text>
      <PreferenceSwitch
        label="Push notifications"
        description="Receive generic updates on enrolled devices"
        value={account?.enabled ?? false}
        disabled={disabled || (!account?.enabled && unavailable)}
        onValueChange={(value) => {
          void (value ? controller.enable() : controller.disable());
        }}
      />
      <View style={{ gap: spacing.sm }}>
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          {status}
        </Text>
        {!state.online && (
          <Text style={[typography.body, { color: c.text }]}>
            You’re offline. Push changes need a connection.
          </Text>
        )}
        {!!state.error && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            {state.error}
          </Text>
        )}
        {state.uncertain && (
          <Text style={[typography.body, { color: c.text }]}>
            Further changes are blocked. Checking server values cannot prove
            when the previous request has finished.
          </Text>
        )}
        {account?.enabled && !state.eligible && !unavailable && (
          <Button
            label="Enable on this device"
            disabled={disabled}
            onPress={() => void controller.enable()}
          />
        )}
        {state.permission === 'denied' && (
          <Button
            label="Open system notification settings"
            variant="secondary"
            onPress={() => void Linking.openSettings().catch(() => {})}
          />
        )}
        <Button
          label={state.uncertain ? 'Check push values' : 'Retry push setup'}
          variant="secondary"
          loading={state.busy}
          disabled={state.busy || !state.online}
          onPress={() => void controller.reconcile()}
        />
      </View>
    </Surface>
  );
}
