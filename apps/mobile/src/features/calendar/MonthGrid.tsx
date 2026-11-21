import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import backIcon from 'expo-router/assets/react-navigation/elements/back-icon.png';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Button,
  SegmentedControl,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { weekCaption, weekDays } from './week';
import {
  dayCaption,
  monthCaption,
  monthDays,
  type WeekStart,
} from './month-grid';

export function MonthGrid({
  view = 'month',
  onViewChange,
  selected,
  today,
  weekStartsOn,
  counts,
  onSelect,
  onPrevious,
  onNext,
  onToday,
}: {
  view?: 'month' | 'week';
  onViewChange?: (view: 'month' | 'week') => void;
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
  const { fontScale, width } = useWindowDimensions();
  const week = view === 'week';
  const [focusedDay, setFocusedDay] = useState<string | null>(null);
  const month = selected.slice(0, 7);
  const days = week
    ? weekDays(selected, weekStartsOn)
    : monthDays(month, weekStartsOn);
  const strip = useRef<ComponentRef<typeof ScrollView>>(null);
  const cellWidth = Math.max(48 * Math.max(1, fontScale), width / 7);
  const revealSelected = () => {
    if (week)
      strip.current?.scrollTo({
        x: Math.max(
          0,
          days.indexOf(selected) * cellWidth - (width - cellWidth) / 2,
        ),
        animated: false,
      });
  };
  useEffect(revealSelected, [selected, week, weekStartsOn, width, fontScale]);
  const weekdays =
    weekStartsOn === 'monday'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rows = (
    <>
      {Array.from({ length: days.length / 7 }, (_, row) => (
        <View key={row} style={styles.week}>
          {days.slice(row * 7, row * 7 + 7).map((day, index) => {
            const chosen = selected === day;
            const count = counts?.get(day) ?? 0;
            const adjacent = !week && day.slice(0, 7) !== month;
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
                    minHeight: (week ? 76 : 48) * Math.max(1, fontScale),
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
                {week && (
                  <Text
                    style={[
                      typography.caption,
                      { color: chosen ? c.onPrimary : c.textSecondary },
                    ]}
                  >
                    {fontScale >= 1.5 || width < 360
                      ? weekdays[index]!.slice(0, 1)
                      : weekdays[index]}
                  </Text>
                )}
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
    </>
  );
  return (
    <View style={styles.calendar}>
      <View style={styles.tools}>
        {onViewChange && (
          <SegmentedControl
            label="Calendar view"
            value={view}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
            ]}
            onChange={(next) => {
              if (next === 'month' || next === 'week') onViewChange(next);
            }}
          />
        )}
        <Button label="Today" variant="secondary" onPress={onToday} />
      </View>
      <View style={styles.caption}>
        <Button
          label={week ? 'Previous week' : 'Previous month'}
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
          {week ? weekCaption(days) : monthCaption(month)}
        </Text>
        <Button
          label={week ? 'Next week' : 'Next month'}
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
      {!week && (
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
      )}
      {week ? (
        <ScrollView
          ref={strip}
          onContentSizeChange={revealSelected}
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View style={{ flex: 1, minWidth: 7 * 48 * Math.max(1, fontScale) }}>
            {rows}
          </View>
        </ScrollView>
      ) : (
        rows
      )}
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
