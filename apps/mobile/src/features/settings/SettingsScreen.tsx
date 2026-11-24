import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useSessionManager,
  useSessionSnapshot,
} from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import type { DestinationPath } from '../../navigation/routes';
import {
  AppHeader,
  Button,
  ConfirmDialog,
  ListRow,
  ScreenHeader,
  Separator,
  Skeleton,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { profileOptions } from '../profile/api';
import { PrivateAvatar } from '../profile/PrivateAvatar';
import { useAccountEnvironment } from '../profile/environment';
import { profileError } from '../profile/status';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
} from '../workspaces/status';

const sections: readonly {
  title: string;
  items: readonly {
    label: string;
    subtitle: string;
    path: DestinationPath;
    icon: string;
  }[];
}[] = [
  {
    title: 'Account',
    items: [
      {
        label: 'Profile',
        subtitle: 'Your name and private photo',
        path: '/profile',
        icon: '○',
      },
      {
        label: 'Change email',
        subtitle: 'Verify a new email address',
        path: '/change-email',
        icon: '@',
      },
      {
        label: 'Notification preferences',
        subtitle: 'In-app, push and quiet hours',
        path: '/notification-preferences',
        icon: '◉',
      },
    ],
  },
  {
    title: 'Preferences',
    items: [
      {
        label: 'Appearance',
        subtitle: 'Light, dark or match system',
        path: '/appearance',
        icon: '◐',
      },
      {
        label: 'Preferences',
        subtitle: 'Timezone, dates and week start',
        path: '/preferences',
        icon: '▦',
      },
    ],
  },
  {
    title: 'Security & Data',
    items: [
      {
        label: 'Security',
        subtitle: 'Password and account protection',
        path: '/security',
        icon: '◇',
      },
      {
        label: 'Connected accounts',
        subtitle: 'Your linked Google account',
        path: '/connected-accounts',
        icon: '↔',
      },
      {
        label: 'Data & Privacy',
        subtitle: 'Export, privacy and account deletion',
        path: '/data-privacy',
        icon: '▤',
      },
    ],
  },
];
export function SettingsScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <SettingsContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function SettingsContent({ identity }: { identity: SessionIdentity }) {
  const data = useMobileData(),
    manager = useSessionManager(),
    router = useRouter(),
    c = useTheme();
  const { eligible, online } = useAccountEnvironment();
  const query = useQuery({
    ...profileOptions(data, identity),
    enabled: eligible,
    retry: false,
    refetchOnWindowFocus: (q) =>
      canRetryWorkspace(q.state.error, q.state.errorUpdatedAt),
    refetchOnReconnect: (q) =>
      canRetryWorkspace(q.state.error, q.state.errorUpdatedAt),
  });
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const [confirm, setConfirm] = useState(false),
    [signingOut, setSigningOut] = useState(false);
  const refresh = () => {
    if (online && retryReady) void query.refetch();
  };
  const status = (text: string) => (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: c.textSecondary }]}
    >
      {text}
    </Text>
  );
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: spacing.xl,
          gap: spacing.xl,
          width: '100%',
          maxWidth: 640,
          alignSelf: 'center',
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={refresh}
            tintColor={c.primary}
          />
        }
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader title="Profile & Settings" />
        {!online &&
          status(
            'You’re offline. Previously loaded details may be out of date.',
          )}
        {!query.data && !query.isError && (
          <>
            <Skeleton height={160} />
            {status('Loading profile…')}
          </>
        )}
        {query.isError && (
          <>
            {status(profileError(query.error))}
            <Button
              label="Retry profile"
              variant="secondary"
              disabled={!online || !retryReady || query.isFetching}
              onPress={refresh}
            />
          </>
        )}
        {query.data && (
          <Surface>
            <ListRow
              title={query.data.displayName}
              subtitle={query.data.email}
              accessibilityLabel={`${query.data.displayName}, ${query.data.email}, Edit profile`}
              disabled={signingOut}
              onPress={() => router.push('/profile')}
              leading={
                <PrivateAvatar
                  profile={query.data}
                  identity={identity}
                  size={64}
                  refreshKey={query.dataUpdatedAt}
                />
              }
              trailing={
                <Text
                  accessible={false}
                  style={{ color: c.textMuted, fontSize: 24 }}
                >
                  ›
                </Text>
              }
            />
          </Surface>
        )}
        {sections.map((section) => (
          <View key={section.title} style={{ gap: spacing.sm }}>
            <Text
              accessibilityRole="header"
              style={[
                typography.section,
                { color: c.textSecondary, paddingHorizontal: spacing.sm },
              ]}
            >
              {section.title}
            </Text>
            <Surface compact>
              {section.items.map((item, index) => (
                <View key={item.path}>
                  {index > 0 && <Separator />}
                  <ListRow
                    title={item.label}
                    subtitle={item.subtitle}
                    accessibilityLabel={item.label}
                    disabled={signingOut}
                    onPress={() => router.push(item.path)}
                    leading={
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: c.primaryTint,
                        }}
                      >
                        <Text style={{ color: c.primary, fontSize: 22 }}>
                          {item.icon}
                        </Text>
                      </View>
                    }
                    trailing={
                      <Text
                        accessible={false}
                        style={{ color: c.textMuted, fontSize: 24 }}
                      >
                        ›
                      </Text>
                    }
                  />
                </View>
              ))}
            </Surface>
          </View>
        ))}
        <Surface>
          <Button
            label="Sign out"
            variant="destructive"
            onPress={() => setConfirm(true)}
            disabled={signingOut}
          />
        </Surface>
      </ScrollView>
      <ConfirmDialog
        visible={confirm}
        title="Sign out?"
        message="Private account data and temporary files will be removed from this device."
        confirmLabel="Sign out of this device"
        destructive
        loading={signingOut}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (signingOut) return;
          setSigningOut(true);
          void manager.logout();
        }}
      />
    </SafeAreaView>
  );
}
