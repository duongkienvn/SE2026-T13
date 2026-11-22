import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import {
  AppHeader,
  Button,
  ScreenHeader,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { ExportPanel } from './ExportPanel';
import { useExport } from './useExport';

/** Minimal MOB-40 entry; MOB-41 completes Data & Privacy around this engine. */
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
      </ScrollView>
    </SafeAreaView>
  );
}
