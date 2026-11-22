import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AppHeader,
  Button,
  ScreenHeader,
  spacing,
  typography,
  useTheme,
} from '../../ui';
export function PreferencesPage({
  title,
  pending,
  children,
}: {
  title: string;
  pending: boolean;
  children: ReactNode;
}) {
  const c = useTheme(),
    router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
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
          title={title}
          leading={
            <Button
              label="Back"
              variant="link"
              disabled={pending}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/settings')
              }
            />
          }
        />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Note({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[typography.body, { color: error ? c.danger : c.textSecondary }]}
    >
      {children}
    </Text>
  );
}
export function Choice({
  label,
  detail,
  selected,
  disabled,
  onPress,
  icon,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
  icon?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ selected, checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        padding: spacing.lg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primaryTint : c.surface,
        opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Text style={[typography.strong, { color: c.text, flexShrink: 1 }]}>
          {icon ? `${icon}  ` : ''}
          {label}
        </Text>
        {selected && (
          <Text accessibilityElementsHidden style={{ color: c.primary }}>
            ✓
          </Text>
        )}
      </View>
      {detail && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          {detail}
        </Text>
      )}
    </Pressable>
  );
}
