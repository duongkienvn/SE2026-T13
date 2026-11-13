import {
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type ComponentRef,
} from 'react';
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

export type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
} & (
  | { variant: 'icon'; icon: ReactElement }
  | {
      variant?: 'primary' | 'secondary' | 'destructive' | 'link';
      icon?: ReactNode;
    }
);

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
}: ButtonProps) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const backgroundColor =
    variant === 'primary'
      ? c.primary
      : variant === 'destructive'
        ? c.danger
        : variant === 'link'
          ? 'transparent'
          : c.surface;
  const foreground =
    variant === 'primary'
      ? c.onPrimary
      : variant === 'destructive'
        ? c.surface
        : variant === 'link'
          ? c.primaryPressed
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
              ? c.controlBorder
              : 'transparent',
          opacity: blocked ? 0.55 : pressed && variant !== 'primary' ? 0.75 : 1,
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
  ref?: Ref<ComponentRef<typeof TextInput>>;
  label: string;
  error?: string;
  hint?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
};
export function TextField({
  label,
  error,
  hint,
  leading,
  trailing,
  style,
  ...props
}: FieldProps) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[typography.strong, { color: c.text }]}>{label}</Text>
      <View
        style={[
          styles.inputFrame,
          {
            backgroundColor: c.surface,
            borderColor: focused ? c.focus : error ? c.danger : c.controlBorder,
          },
        ]}
      >
        {leading}
        <TextInput
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityHint={error || hint || props.accessibilityHint}
          accessibilityState={{
            ...props.accessibilityState,
            disabled: props.editable === false,
          }}
          placeholderTextColor={c.textMuted}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[styles.input, typography.body, { color: c.text }, style]}
        />
        {trailing}
      </View>
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
export function PasswordField({
  showPasswordLabel = 'Show password',
  hidePasswordLabel = 'Hide password',
  inlineToggle,
  ...props
}: FieldProps & {
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
  inlineToggle?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const c = useTheme();
  const toggle = (
    <Button
      variant="icon"
      label={visible ? hidePasswordLabel : showPasswordLabel}
      onPress={() => setVisible(!visible)}
      icon={
        <View
          accessible={false}
          style={{
            width: 22,
            height: 14,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: c.textSecondary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: c.textSecondary,
            }}
          />
          {visible && (
            <View
              style={{
                position: 'absolute',
                width: 24,
                height: 2,
                backgroundColor: c.textSecondary,
                transform: [{ rotate: '-40deg' }],
              }}
            />
          )}
        </View>
      }
    />
  );
  if (inlineToggle)
    return (
      <TextField {...props} secureTextEntry={!visible} trailing={toggle} />
    );
  return (
    <View>
      <TextField {...props} secureTextEntry={!visible} />
      <View style={styles.passwordAction}>
        <Button
          variant="secondary"
          label={visible ? hidePasswordLabel : showPasswordLabel}
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
  const [failedSource, setFailedSource] = useState<ImageSourcePropType>();
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
      {source && source !== failedSource ? (
        <Image
          source={source}
          onError={() => setFailedSource(source)}
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
  accessibilityLabel,
}: {
  people: { name: string; source?: ImageSourcePropType }[];
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={
        accessibilityLabel ??
        `${people.length} people: ${people.map((person) => person.name).join(', ')}`
      }
      style={{ flexDirection: 'row', flexWrap: 'wrap' }}
    >
      {people.map((person, i) => (
        <View
          key={`${person.name}-${i}`}
          style={{
            borderWidth: 2,
            borderColor: c.surface,
            borderRadius: radius.pill,
            marginRight: i < people.length - 1 ? -spacing.sm : 0,
          }}
        >
          <Avatar {...person} size={32} />
        </View>
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
    <Text style={[typography.caption, { color, flexShrink: 1 }]}>
      {selected ? `✓ ${label}` : label}
    </Text>
  );
  const style: ViewStyle = {
    minHeight: onPress ? sizes.touch : 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor:
      focused || selected
        ? c.focus
        : (colors?.border ?? (onPress ? c.controlBorder : c.border)),
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
  inputFrame: {
    minHeight: sizes.touch,
    borderWidth: 1,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.touch - 2,
    paddingVertical: spacing.sm,
  },
  passwordAction: { alignSelf: 'flex-end', marginTop: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
