import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch as NativeSwitch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Button } from './controls';
import {
  elevation,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from './theme';

export function Surface({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={[
        styles.surface,
        elevation.surface,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      {children}
    </View>
  );
}
export function Separator() {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }}
    />
  );
}
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const stacked =
    Boolean(trailing) &&
    rowWidth > 0 &&
    rowWidth / Math.max(fontScale, 1) < 250;
  const content = (
    <>
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[typography.strong, { color: c.text }]}>{title}</Text>
        {subtitle && (
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {subtitle}
          </Text>
        )}
      </View>
    </>
  );
  const style = [styles.row, { opacity: disabled ? 0.55 : 1 }];
  return (
    <View
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      style={{
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'stretch' : 'center',
        gap: spacing.sm,
      }}
    >
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)
          }
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={({ pressed }) => [
            style,
            {
              flex: stacked ? undefined : 1,
              minWidth: 0,
              borderWidth: 2,
              borderRadius: radius.control,
              borderColor: focused ? c.focus : 'transparent',
              opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
            },
          ]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={[style, { flex: stacked ? undefined : 1, minWidth: 0 }]}>
          {content}
        </View>
      )}
      {trailing && (
        <View style={stacked ? { alignSelf: 'flex-end' } : undefined}>
          {trailing}
        </View>
      )}
    </View>
  );
}
export function StatTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  const c = useTheme();
  return (
    <Surface>
      {icon}
      <Text style={[typography.display, typography.numeric, { color: c.text }]}>
        {value}
      </Text>
      <Text style={[typography.body, { color: c.textSecondary }]}>{label}</Text>
    </Surface>
  );
}
export function BoardTile({
  title,
  subtitle,
  artwork,
  trailing,
}: {
  title: string;
  subtitle?: string;
  artwork?: ReactNode;
  trailing?: ReactNode;
}) {
  const c = useTheme();
  return (
    <Surface>
      {artwork}
      <Text style={[typography.strong, { color: c.text }]}>{title}</Text>
      {subtitle && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          {subtitle}
        </Text>
      )}
      {trailing}
    </Surface>
  );
}
export const BoardRow = ListRow;
export const TaskRow = ListRow;
export const NotificationRow = ListRow;
export function CardPreview({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const c = useTheme();
  return (
    <Surface>
      <Text style={[typography.strong, { color: c.text }]}>{title}</Text>
      {children}
    </Surface>
  );
}
export function Skeleton({
  width = '100%',
  height = 16,
  label = 'Loading',
}: {
  width?: number | `${number}%`;
  height?: number;
  label?: string;
}) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={{
        width,
        height,
        borderRadius: radius.small,
        backgroundColor: c.border,
      }}
    />
  );
}
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={styles.state}
    >
      <ActivityIndicator color={c.primary} />
      <Text style={[typography.body, { color: c.textSecondary }]}>{label}</Text>
    </View>
  );
}
export function MessageState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.state}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text, textAlign: 'center' }]}
      >
        {title}
      </Text>
      {description && (
        <Text
          style={[
            typography.body,
            { color: c.textSecondary, textAlign: 'center' },
          ]}
        >
          {description}
        </Text>
      )}
      {action}
    </View>
  );
}
export const EmptyState = MessageState;
export const ErrorState = MessageState;
export const OfflineState = MessageState;
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
}: {
  options: { label: string; value: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState<string | null>(null);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{
            checked: value === option.value,
            disabled: option.disabled,
          }}
          disabled={option.disabled}
          onPress={() => onChange(option.value)}
          onFocus={() => setFocused(option.value)}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => ({
            minHeight: sizes.touch,
            paddingHorizontal: spacing.lg,
            justifyContent: 'center',
            borderRadius: radius.control,
            borderWidth: 2,
            borderColor: focused === option.value ? c.focus : 'transparent',
            opacity: option.disabled ? 0.55 : pressed ? 0.75 : 1,
            backgroundColor: value === option.value ? c.primary : c.surfaceSoft,
          })}
        >
          <Text
            style={[
              typography.strong,
              { color: value === option.value ? c.onPrimary : c.text },
            ]}
          >
            {value === option.value ? `✓ ${option.label}` : option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Checkbox({
  label,
  checked,
  onValueChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!checked)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.row,
        {
          borderWidth: 2,
          borderRadius: radius.control,
          borderColor: focused ? c.focus : 'transparent',
          opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <View
        style={{
          width: sizes.iconLarge,
          height: sizes.iconLarge,
          borderWidth: 1,
          borderRadius: radius.small,
          borderColor: checked ? c.primary : c.controlBorder,
          backgroundColor: checked ? c.primary : c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked && (
          <Text
            allowFontScaling={false}
            style={{ color: c.onPrimary, fontSize: 16, fontWeight: '700' }}
          >
            ✓
          </Text>
        )}
      </View>
      <Text style={[typography.body, { color: c.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
export function ProgressBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const c = useTheme();
  const progress = Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: progress }}
      style={{
        height: spacing.sm,
        backgroundColor: c.progressTrack,
        borderRadius: radius.pill,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${progress}%`,
          height: '100%',
          backgroundColor: c.primary,
          backgroundImage: [
            {
              type: 'linear-gradient',
              direction: '90deg',
              colorStops: [{ color: c.primary }, { color: c.progressEnd }],
            },
          ],
        }}
      />
    </View>
  );
}
export function PreferenceSwitch({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.body, { color: c.text, flex: 1 }]}>{label}</Text>
      <NativeSwitch
        accessibilityLabel={label}
        value={value}
        onValueChange={(nextValue) => {
          if (!disabled) onValueChange(nextValue);
        }}
        disabled={disabled}
        trackColor={{ false: c.controlBorder, true: c.primary }}
      />
    </View>
  );
}
export function FormFooter({
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  loading,
  disabled,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Button
        label={primaryLabel}
        onPress={onPrimary}
        loading={loading}
        disabled={disabled}
      />
      {secondaryLabel && onSecondary && (
        <Button
          variant="secondary"
          label={secondaryLabel}
          onPress={onSecondary}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  surface: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    minHeight: sizes.touch,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  state: { padding: spacing.xxl, gap: spacing.md, alignItems: 'center' },
});
