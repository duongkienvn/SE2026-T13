import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import backIcon from 'expo-router/assets/react-navigation/elements/back-icon.png';
import { useState } from 'react';
import { Button, radius, spacing, typography, useTheme } from '../../ui';
import {
  dayCaption,
  monthCaption,
  monthDays,
  type WeekStart,
} from './month-grid';

export function MonthGrid({
  selected,
  today,
  weekStartsOn,
  counts,
  onSelect,
  onPrevious,
  onNext,
  onToday,
}: {
  selected: string;
  today: string;
  weekStartsOn: WeekStart;
  counts?: ReadonlyMap<string, number>;
  onSelect: (day: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const c = useTheme();
  const { fontScale } = useWindowDimensions();
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const month = selected.slice(0, 7);
  const days = monthDays(month, weekStartsOn);
  const weekdays =
    weekStartsOn === 'monday'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <View style={styles.calendar}>
      <View style={styles.tools}>
        <View style={styles.views} accessibilityRole="tablist">
          <View
            accessible
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
            style={[styles.segment, { backgroundColor: c.primary }]}
          >
            <Text style={[typography.strong, { color: c.onPrimary }]}>
              Month
            </Text>
          </View>
          <View
            accessible
            accessibilityRole="tab"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Week unavailable, coming in MOB-36"
            style={[styles.segment, { backgroundColor: c.surfaceSoft }]}
          >
            <Text style={[typography.supporting, { color: c.textMuted }]}>
              Week · Soon
            </Text>
          </View>
        </View>
        <Button label="Today" variant="secondary" onPress={onToday} />
      </View>
      <View style={styles.caption}>
        <Button
          label="Previous month"
          variant="icon"
          icon={
            <Image
              source={backIcon}
              style={{ width: 16, height: 20, tintColor: c.textSecondary }}
            />
          }
          onPress={onPrevious}
        />
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={[typography.section, styles.month, { color: c.text }]}
        >
          {monthCaption(month)}
        </Text>
        <Button
          label="Next month"
          variant="icon"
          icon={
            <Image
              source={backIcon}
              style={{
                width: 16,
                height: 20,
                tintColor: c.textSecondary,
                transform: [{ rotate: '180deg' }],
              }}
            />
          }
          onPress={onNext}
        />
      </View>
      <View style={styles.week}>
        {weekdays.map((day) => (
          <Text
            key={day}
            accessibilityLabel={day}
            style={[
              typography.caption,
              styles.weekday,
              { color: c.textSecondary },
            ]}
          >
            {fontScale >= 1.5 ? day.slice(0, 1) : day}
          </Text>
        ))}
      </View>
      {Array.from({ length: days.length / 7 }, (_, row) => (
        <View key={row} style={styles.week}>
          {days.slice(row * 7, row * 7 + 7).map((day) => {
            const chosen = selected === day;
            const count = counts?.get(day) ?? 0;
            const adjacent = day.slice(0, 7) !== month;
            return (
              <Pressable
                key={day}
                testID={`calendar-day-${day}`}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                accessibilityLabel={`${dayCaption(day)}, ${counts ? `${count} due ${count === 1 ? 'Card' : 'Cards'}` : 'counts unavailable'}${day === today ? ', Today' : ''}${chosen ? ', selected' : ''}`}
                onPress={() => onSelect(day)}
                onFocus={() => setFocusedDay(day)}
                onBlur={() => setFocusedDay(null)}
                style={({ pressed }) => [
                  styles.day,
                  {
                    minHeight: 48 * Math.max(1, fontScale),
                    backgroundColor: chosen
                      ? c.primary
                      : pressed
                        ? c.primaryTint
                        : 'transparent',
                    borderColor:
                      focusedDay === day
                        ? c.focus
                        : day === today
                          ? c.primaryBorder
                          : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    typography.strong,
                    typography.numeric,
                    {
                      color: chosen
                        ? c.onPrimary
                        : adjacent
                          ? c.textMuted
                          : c.text,
                    },
                  ]}
                >
                  {Number(day.slice(-2))}
                </Text>
                {counts && count > 0 && (
                  <View
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.markers}
                  >
                    {count <= 3 ? (
                      Array.from({ length: count }, (_, index) => (
                        <View
                          key={index}
                          style={[
                            styles.dot,
                            {
                              backgroundColor: chosen ? c.onPrimary : c.primary,
                            },
                          ]}
                        />
                      ))
                    ) : (
                      <Text
                        style={[
                          typography.caption,
                          typography.numeric,
                          { color: chosen ? c.onPrimary : c.primaryPressed },
                        ]}
                      >
                        {count > 99 ? '99+' : count}
                      </Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.sm },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  segment: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.control,
    borderCurve: 'continuous',
    justifyContent: 'center',
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  month: { flex: 1, textAlign: 'center' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, minWidth: 0, textAlign: 'center' },
  day: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: radius.control,
    borderCurve: 'continuous',
    paddingVertical: spacing.xs,
  },
  markers: {
    minHeight: 8,
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 4, height: 4, borderRadius: radius.pill },
});
