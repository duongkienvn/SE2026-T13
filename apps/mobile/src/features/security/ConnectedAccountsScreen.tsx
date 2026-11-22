import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  AppHeader,
  Button,
  PasswordField,
  ScreenHeader,
  Skeleton,
  StatusChip,
  Surface,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { StatusText } from './SecurityScreen';
import { useGoogleLink } from './useAccountSecurity';

export function ConnectedAccountsScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <ConnectedAccountsContent
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function StatusLine({
  label,
  value,
  on,
}: {
  label: string;
  value: string;
  on: boolean;
}) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        minHeight: 48,
      }}
    >
      <Text style={[typography.strong, { color: c.text }]}>{label}</Text>
      <StatusChip label={value} tone={on ? 'success' : 'neutral'} />
    </View>
  );
}

function ConnectedAccountsContent({ identity }: { identity: SessionIdentity }) {
  const link = useGoogleLink(identity),
    router = useRouter(),
    c = useTheme(),
    navigation = useDraftNavigation(link, '/connected-accounts');
  const query = link.providers.query,
    status = link.status;
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
            refreshing={query.isRefetching}
            onRefresh={() => void link.providers.refresh()}
            tintColor={c.primary}
          />
        }
      >
        <AppHeader subtitle="Your account" />
        <ScreenHeader
          title="Connected accounts"
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={link.pending}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings')
              }
            />
          }
        />
        <StatusText>
          Sign-in methods connected to your Kanvexa account.
        </StatusText>
        {!link.providers.online && (
          <StatusText>
            You’re offline. Status may be out of date; reconnect to refresh or
            connect Google.
          </StatusText>
        )}
        {query.isPending && !query.isError && (
          <>
            <Skeleton height={100} />
            <StatusText>Checking connected accounts…</StatusText>
          </>
        )}
        {query.isError && !status && (
          <>
            <StatusText>
              Could not check your connected accounts. Please try again.
            </StatusText>
            <Button
              label="Retry status"
              variant="secondary"
              disabled={link.pending || !link.providers.online}
              onPress={() => void link.providers.refresh()}
            />
          </>
        )}
        {status && (
          <Surface>
            <StatusLine
              label="Google"
              value={status.googleLinked ? 'Connected' : 'Not connected'}
              on={status.googleLinked}
            />
            <StatusLine
              label="Password"
              value={status.hasPassword ? 'Set' : 'Not set'}
              on={status.hasPassword}
            />
          </Surface>
        )}
        {status?.googleLinked && (
          <StatusText>
            Google is connected. You can sign in with Google or, if set, your
            password. Removing the connection isn’t available in this version.
          </StatusText>
        )}
        {status && !status.googleLinked && !status.hasPassword && (
          <StatusText>
            Connecting Google needs your current Kanvexa password. Set a
            password first from Security using password recovery.
          </StatusText>
        )}
        {status &&
          !status.googleLinked &&
          status.hasPassword &&
          !link.configured && (
            <StatusText>
              Google sign-in isn’t available in this build. Use Kanvexa Web or a
              configured native build to connect Google.
            </StatusText>
          )}
        {link.eligible && (
          <Surface>
            <Text
              accessibilityRole="header"
              style={[typography.strong, { color: c.text }]}
            >
              Connect Google
            </Text>
            <StatusText>
              Confirm your current password, then choose the Google account with
              the same verified email as Kanvexa.
            </StatusText>
            <PasswordField
              label="Current password"
              value={link.password}
              onChangeText={link.passwordText}
              autoComplete="current-password"
              textContentType="password"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={128}
              editable={!link.pending}
            />
            <Button
              label="Connect Google"
              loading={link.pending}
              disabled={link.blocked || !link.valid}
              onPress={() => void link.submit()}
            />
          </Surface>
        )}
        {link.pending && (
          <StatusText>Connecting Google… Please wait.</StatusText>
        )}
        {!!link.error && <StatusText>{link.error}</StatusText>}
        {link.linked && status?.googleLinked && (
          <StatusText>Google connected. You’re still signed in.</StatusText>
        )}
        {link.linked && !status?.googleLinked && (
          <StatusText>
            The server accepted the connection. Refreshing status…
          </StatusText>
        )}
        {!!link.cooldown && (
          <StatusText>{`You can try again in ${link.cooldown} seconds.`}</StatusText>
        )}
        <Button
          label="Security"
          variant="link"
          disabled={link.pending}
          onPress={() => router.push('/security')}
        />
      </ScrollView>
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="The password you entered will be cleared."
      />
    </SafeAreaView>
  );
}
