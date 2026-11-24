import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ScreenHeader,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { ExportPanel } from './ExportPanel';
import { useExport } from './useExport';

/** Account tools share the existing private export lifecycle. */
export function DataPrivacyScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <DataPrivacyContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function DataPrivacyContent({ identity }: { identity: SessionIdentity }) {
  const exporter = useExport(identity),
    router = useRouter(),
    c = useTheme();
  const [pendingDestination, setPendingDestination] = useState<
    '/change-email' | '/delete-account' | null
  >(null);
  function navigate(path: '/change-email' | '/delete-account') {
    if (exporter.busy) return;
    if (exporter.remove()) router.push(path);
    else setPendingDestination(path);
  }
  const text = (value: string) => (
    <Text style={[typography.body, { color: c.textSecondary }]}>{value}</Text>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
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
          title="Data & Privacy"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={exporter.busy}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings')
              }
            />
          }
        />
        <Surface>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.text }]}
          >
            Your privacy
          </Text>
          {text(
            'Your profile photo and exports are private and require an authenticated session. Only authorized members can access protected board data.',
          )}
          {text(
            'Account exports include account information, preferences, sign-in methods and memberships. They do not include board contents or uploaded files. Board exports require an explicit Board OWNER role, even for Workspace admins.',
          )}
          {text(
            'Kanvexa attempts to remove temporary export files when you leave this screen or end your session. If cleanup fails, restart the app to retry. Copies handed to another app are outside Kanvexa’s control.',
          )}
        </Surface>
        <Surface>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.text }]}
          >
            Your email address
          </Text>
          {text(
            'Change your email using password or linked Google verification. Your current email remains active until the secure Web confirmation completes.',
          )}
          <Button
            label="Change email"
            variant="secondary"
            disabled={exporter.busy}
            onPress={() => navigate('/change-email')}
          />
        </Surface>
        <Surface>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.text }]}
          >
            Export my data
          </Text>
          {text(
            'Downloads a JSON file with your account information, settings, sign-in methods and memberships. Board contents and uploaded files aren’t included.',
          )}
          {text(
            'Board owners can export a board as JSON or CSV from that board’s settings.',
          )}
          {text(
            'The file may contain private information. When you share it, the app you choose can keep a copy.',
          )}
          <ExportPanel
            exporter={exporter}
            label="Export my data (JSON)"
            onStart={() => void exporter.start({ kind: 'account' })}
          />
        </Surface>
        <Surface>
          <Text
            accessibilityRole="header"
            style={[typography.section, { color: c.danger }]}
          >
            Delete account
          </Text>
          {text(
            'Permanently removes your identity, profile, preferences, memberships and personal notifications. There is no undo period.',
          )}
          {text(
            'Shared collaborative content remains with Deleted user attribution. Creating a new account does not restore previous memberships. Ownership and workspace requirements may need to be resolved first.',
          )}
          {text(
            'Export your data before continuing. Deletion requires the exact DELETE confirmation and fresh identity verification.',
          )}
          <Button
            label="Delete account"
            variant="destructive"
            disabled={exporter.busy}
            onPress={() => navigate('/delete-account')}
          />
        </Surface>
      </ScrollView>
      <ConfirmDialog
        visible={pendingDestination !== null}
        title="Private file could not be removed"
        message="The private export may still be on this device. Restart the app to retry cleanup before exporting again. You can stay here or acknowledge this warning and continue. Copies shared with other apps are not affected."
        confirmLabel="I understand, continue"
        cancelLabel="Stay here"
        onCancel={() => setPendingDestination(null)}
        onConfirm={() => {
          const path = pendingDestination;
          setPendingDestination(null);
          if (path) router.push(path);
        }}
      />
    </SafeAreaView>
  );
}
