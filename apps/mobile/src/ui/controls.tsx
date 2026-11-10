import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import logo from '../../assets/brand/kanvexa-logo-v1.png';
import { radius, sizes, spacing, typography, useTheme } from './theme';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'icon';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const filled = variant === 'primary' || variant === 'destructive';
  const backgroundColor =
    variant === 'primary'
      ? c.primary
      : variant === 'destructive'
        ? c.danger
        : c.surface;
  const foreground =
    variant === 'primary'
      ? c.onPrimary
      : variant === 'destructive'
        ? c.surface
        : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            pressed && variant === 'primary'
              ? c.primaryPressed
              : backgroundColor,
          borderColor: focused
            ? c.focus
            : variant === 'secondary'
              ? c.border
              : 'transparent',
          opacity: blocked ? 0.55 : pressed && !filled ? 0.75 : 1,
        },
        variant === 'icon' && styles.iconButton,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          {icon}
          {variant !== 'icon' && (
            <Text
              style={[
                typography.strong,
                { color: foreground, textAlign: 'center', flexShrink: 1 },
              ]}
            >
              {label}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
};
export function TextField({ label, error, hint, style, ...props }: FieldProps) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[typography.strong, { color: c.text }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={error || hint || props.accessibilityHint}
        accessibilityState={{ disabled: props.editable === false }}
        placeholderTextColor={c.textMuted}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          typography.body,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: error ? c.danger : focused ? c.focus : c.border,
          },
          style,
        ]}
      />
      {(error || hint) && (
        <Text
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          style={[
            typography.supporting,
            { color: error ? c.danger : c.textSecondary },
          ]}
        >
          {error || hint}
        </Text>
      )}
    </View>
  );
}
export function SearchField(props: FieldProps) {
  return (
    <TextField {...props} returnKeyType={props.returnKeyType ?? 'search'} />
  );
}
export function PasswordField(props: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <TextField {...props} secureTextEntry={!visible} />
      <View style={styles.passwordAction}>
        <Button
          variant="secondary"
          label={visible ? 'Hide password' : 'Show password'}
          onPress={() => setVisible(!visible)}
        />
      </View>
    </View>
  );
}
export function Avatar({
  name,
  source,
  size = 40,
}: {
  name: string;
  source?: ImageSourcePropType;
  size?: number;
}) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase();
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.primaryTint,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {source && !failed ? (
        <Image
          source={source}
          onError={() => setFailed(true)}
          style={{ width: size, height: size }}
        />
      ) : (
        <Text style={[typography.caption, { color: c.text }]}>
          {initials || '?'}
        </Text>
      )}
    </View>
  );
}
export function AvatarStack({
  people,
}: {
  people: { name: string; source?: ImageSourcePropType }[];
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${people.length} people: ${people.map((person) => person.name).join(', ')}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
    >
      {people.map((person, i) => (
        <Avatar key={`${person.name}-${i}`} {...person} size={32} />
      ))}
    </View>
  );
}
export function Chip({
  label,
  selected,
  onPress,
  tone = 'neutral',
  colors,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  colors?: { foreground: string; background: string; border: string };
  disabled?: boolean;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const color = colors?.foreground ?? (tone === 'neutral' ? c.text : c[tone]);
  const content = (
    <Text style={[typography.caption, { color, flexShrink: 1 }]}>{label}</Text>
  );
  const style: ViewStyle = {
    minHeight: onPress ? sizes.touch : 28,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: focused || selected ? c.focus : (colors?.border ?? c.border),
    backgroundColor:
      colors?.background ?? (selected ? c.primaryTint : c.surfaceSoft),
    justifyContent: 'center',
    alignItems: 'center',
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        style,
        {
          borderWidth: focused ? 2 : 1,
          opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}
export const LabelChip = Chip;
export const DueChip = Chip;
export const StatusChip = Chip;
export const FilterChip = Chip;
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.header}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text, flexShrink: 1 }]}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}
export function ScreenHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.header}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={[typography.title, { color: c.text }]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={[typography.body, { color: c.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}
export function AppHeader({
  subtitle,
  trailing,
}: {
  subtitle?: string;
  trailing?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.header}>
      <Image
        source={logo}
        accessibilityLabel="Kanvexa logo"
        resizeMode="contain"
        style={{ width: 44, height: 44 }}
      />
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={[typography.section, { color: c.text }]}
        >
          Kanvexa
        </Text>
        {subtitle && (
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: sizes.touch,
    minWidth: sizes.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    borderWidth: 2,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: { paddingHorizontal: spacing.sm },
  field: { gap: spacing.xs },
  input: {
    minHeight: sizes.touch,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  passwordAction: { alignSelf: 'flex-end', marginTop: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
