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
          label="Profile"
          variant="secondary"
          onPress={() => router.push('/profile')}
        />
        <Button
          label="Change email"
          variant="secondary"
          onPress={() => router.push('/change-email')}
        />
        <Button
          label="Notification preferences"
          variant="secondary"
          onPress={() => router.push('/notification-preferences')}
        />
        <Button
          label="Appearance"
          variant="secondary"
          onPress={() => router.push('/appearance')}
        />
        <Button
          label="Preferences"
          variant="secondary"
          onPress={() => router.push('/preferences')}
        />
        <Button
          label="Data & Privacy"
          variant="secondary"
          onPress={() => router.push('/data-privacy')}
        />
        <Button
          label="Security"
          variant="secondary"
          onPress={() => router.push('/security')}
        />
        <Button
          label="Connected accounts"
          variant="secondary"
          onPress={() => router.push('/connected-accounts')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
