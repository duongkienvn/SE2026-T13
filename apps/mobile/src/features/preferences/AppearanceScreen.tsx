import { Text, View, useColorScheme } from 'react-native';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import {
  Button,
  Surface,
  spacing,
  typography,
  useTheme,
  resolveTheme,
} from '../../ui';
import { themes } from './model';
import { usePreferences, preferencesError } from './usePreferences';
import { PreferencesPage, Choice, Note } from './components';
export function AppearanceScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <Appearance
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function Appearance({ identity }: { identity: SessionIdentity }) {
  const p = usePreferences(identity),
    system = useColorScheme(),
    c = useTheme();
  const mode = p.state.preview ?? p.query.data?.theme;
  return (
    <PreferencesPage title="Appearance" pending={p.state.pending}>
      <Note>
        Customize how Kanvexa looks. Your choice is saved to your account.
      </Note>
      {!p.online && (
        <Note>You’re offline. Reconnect to change your theme.</Note>
      )}
      {!p.query.data && !p.query.isError && <Note>Loading appearance…</Note>}
      {(p.query.isError || p.state.error !== null) && (
        <Note error>{preferencesError(p.state.error ?? p.query.error)}</Note>
      )}
      {p.state.uncertain && (
        <Note error>
          The earlier save is unconfirmed and may still finish. Further saves
          are blocked; checking server values does not confirm settlement.
        </Note>
      )}
      {mode && !p.denied && (
        <Surface>
          <Text style={[typography.section, { color: c.text }]}>Theme</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Theme"
            style={{ gap: spacing.sm }}
          >
            {themes.map((value) => (
              <Choice
                key={value}
                label={
                  { light: 'Light', dark: 'Dark', system: 'Match System' }[
                    value
                  ]
                }
                icon={{ light: '☀', dark: '☾', system: '◐' }[value]}
                selected={mode === value}
                disabled={!p.writable}
                onPress={() => void p.commands.chooseTheme(value)}
              />
            ))}
          </View>
          {mode === 'system' ? (
            <Note>
              Following device:{' '}
              {resolveTheme(mode, system) === 'dark' ? 'Dark' : 'Light'}
            </Note>
          ) : (
            <Note>Active mode: {mode === 'dark' ? 'Dark' : 'Light'}</Note>
          )}
          <Note>
            {p.state.pending || p.state.preview
              ? 'Saving…'
              : p.state.saved
                ? 'Saved'
                : ''}
          </Note>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              padding: spacing.lg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.background,
              gap: spacing.md,
            }}
          >
            <Text style={[typography.strong, { color: c.text }]}>Kanvexa</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {[0, 1].map((i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 80,
                    padding: spacing.sm,
                    gap: spacing.sm,
                    backgroundColor: c.surface,
                    borderRadius: 12,
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      width: '60%',
                      backgroundColor: c.border,
                      borderRadius: 4,
                    }}
                  />
                  <View
                    style={{
                      height: 28,
                      backgroundColor: c.primaryTint,
                      borderColor: c.primaryBorder,
                      borderWidth: 1,
                      borderRadius: 8,
                    }}
                  />
                </View>
              ))}
            </View>
          </View>
          <Note>Preview of Kanvexa in the selected theme.</Note>
        </Surface>
      )}
      <Button
        label="Try again"
        variant="secondary"
        disabled={!p.canRefresh}
        onPress={() => void p.refresh()}
      />
    </PreferencesPage>
  );
}
