import { useRouter } from 'expo-router';
import { Image, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import searchIcon from 'expo-router/assets/react-navigation/elements/search-icon.png';
import accountIcon from '../../assets/navigation/account.png';
import settingsIcon from '../../assets/navigation/settings.png';
import { AppHeader, Button, sizes, spacing, typography, useTheme } from '../ui';

function TabHeader({ search }: { search: boolean }) {
  const router = useRouter();
  const colors = useTheme();
  return (
    <AppHeader
      subtitle="Your workspace, in sync."
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button
            label={search ? 'Search' : 'Settings'}
            variant="icon"
            onPress={() => router.push(search ? '/search' : '/settings')}
            icon={
              <Image
                source={search ? searchIcon : settingsIcon}
                style={{
                  width: sizes.iconLarge,
                  height: sizes.iconLarge,
                  tintColor: colors.textSecondary,
                }}
              />
            }
          />
          <Button
            label="Account settings"
            variant="icon"
            onPress={() => router.push('/settings')}
            icon={
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Image
                  source={accountIcon}
                  style={{
                    width: sizes.iconLarge,
                    height: sizes.iconLarge,
                    tintColor: colors.textSecondary,
                  }}
                />
              </View>
            }
          />
        </View>
      }
    />
  );
}

/** Route owners replace these data-free surfaces when their features are implemented. */
export function Scaffold({
  title,
  tab = false,
  tabAction = 'search',
  header = false,
  message = 'This feature is coming soon.',
}: {
  title: string;
  tab?: boolean;
  tabAction?: 'search' | 'settings';
  header?: boolean;
  message?: string;
}) {
  const c = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={
        header
          ? ['left', 'right', 'bottom']
          : ['top', 'left', 'right', 'bottom']
      }
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}
      >
        {tab && <TabHeader search={tabAction === 'search'} />}
        <Text
          accessibilityRole="header"
          style={[typography.title, { color: c.text }]}
        >
          {title}
        </Text>
        <Text style={[typography.body, { color: c.textSecondary }]}>
          {message}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
