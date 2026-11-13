import type { ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import logo from '../../../assets/brand/kanvexa-logo-v1.png';
import { Button, radius, spacing, typography, useTheme } from '../../ui';

export function AuthText({
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
export function AuthLink({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="link"
      label={label}
      onPress={onPress}
      disabled={disabled}
    />
  );
}
export function AuthIcon({
  kind,
}: {
  kind: 'mail' | 'lock' | 'person' | 'check';
}) {
  const c = useTheme();
  const border = { borderColor: c.textSecondary, borderWidth: 1.5 };
  return (
    <View
      accessible={false}
      style={{
        width: 24,
        height: 24,
        marginRight: spacing.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {kind === 'mail' ? (
        <View
          style={[
            border,
            { width: 20, height: 15, borderRadius: 3, overflow: 'hidden' },
          ]}
        >
          <View
            style={[
              border,
              {
                position: 'absolute',
                width: 14,
                height: 14,
                top: -9,
                left: 1.5,
                transform: [{ rotate: '45deg' }],
              },
            ]}
          />
        </View>
      ) : kind === 'check' ? (
        <Text style={{ color: c.primary, fontSize: 24 }}>✓</Text>
      ) : (
        <>
          <View
            style={[
              border,
              {
                position: 'absolute',
                width: kind === 'person' ? 9 : 10,
                height: 10,
                borderRadius: kind === 'person' ? 5 : 6,
                top: 1,
                ...(kind === 'lock'
                  ? {
                      borderBottomWidth: 0,
                      borderBottomLeftRadius: 0,
                      borderBottomRightRadius: 0,
                    }
                  : {}),
              },
            ]}
          />
          <View
            style={[
              border,
              {
                width: kind === 'person' ? 19 : 17,
                height: 12,
                borderRadius: kind === 'person' ? 7 : 3,
                marginTop: 10,
                backgroundColor: c.surface,
              },
            ]}
          />
        </>
      )}
    </View>
  );
}
export function AuthFrame({
  title,
  subtitle,
  children,
  back,
  illustration = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  back?: () => void;
  illustration?: boolean;
}) {
  const c = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={['top', 'bottom', 'left', 'right']}
    >
      <View
        pointerEvents="none"
        accessible={false}
        style={{
          position: 'absolute',
          bottom: -120,
          left: '-25%',
          width: '150%',
          height: 200,
          backgroundColor: c.primaryTint,
          borderTopLeftRadius: 220,
          borderTopRightRadius: 140,
          transform: [{ rotate: '-8deg' }],
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.scroll}
        >
          <View style={styles.content}>
            {back && (
              <View style={{ alignSelf: 'flex-start' }}>
                <AuthLink label="Back to sign in" onPress={back} />
              </View>
            )}
            <View
              style={[
                styles.brand,
                { marginTop: back ? spacing.sm : spacing.xxxl },
              ]}
            >
              <Image
                source={logo}
                accessibilityLabel="Kanvexa logo"
                resizeMode="contain"
                style={{ width: 52, height: 52 }}
              />
              <Text style={[typography.display, { color: c.text }]}>
                Kanvexa
              </Text>
            </View>
            {illustration && (
              <View
                accessible={false}
                style={{
                  alignSelf: 'center',
                  width: 110,
                  height: 100,
                  borderRadius: radius.surface,
                  backgroundColor: c.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ transform: [{ scale: 3 }] }}>
                  <AuthIcon kind="mail" />
                </View>
              </View>
            )}
            <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
              <Text
                accessibilityRole="header"
                style={[typography.display, { color: c.text }]}
              >
                {title}
              </Text>
              <AuthText>{subtitle}</AuthText>
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.xxl, paddingBottom: spacing.huge },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.xxxl,
  },
});
