import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ScreenHeader, spacing, useTheme } from '../../ui';
export default function Settings() {
  const router = useRouter(),
    c = useTheme();
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
      >
        <ScreenHeader title="Settings" />
        <Button
          label="Notification preferences"
          variant="secondary"
          onPress={() => router.push('/notification-preferences')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
