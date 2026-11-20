import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import {
  BottomSheet,
  Button,
  ListRow,
  spacing,
  typography,
  useTheme,
  palettes,
} from '../../../ui';
import { clockPattern, timeChoices } from './model';
/** A fixed UTC carrier transports wall-clock digits, never an account instant. */
export function TimeSelector({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false),
    [fallback, setFallback] = useState(false);
  const nativeOpen = useRef(false);
  const latest = useRef({ disabled, onChange });
  latest.current = { disabled, onChange };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const c = useTheme();
  const carrier = new Date(`2000-01-01T${value}:00.000Z`);
  const pick = (date: Date) => {
    if (!alive.current || latest.current.disabled) return;
    const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
    // Older native runtimes can ignore minuteInterval. Reject, never silently round.
    if (clockPattern.test(time)) latest.current.onChange(time);
    else {
      setFallback(true);
      setOpen(true);
    }
  };
  useEffect(() => {
    if (disabled && nativeOpen.current) {
      nativeOpen.current = false;
      void DateTimePickerAndroid.dismiss('time').catch(() => undefined);
    }
    return () => {
      if (nativeOpen.current) {
        nativeOpen.current = false;
        void DateTimePickerAndroid.dismiss('time').catch(() => undefined);
      }
    };
  }, [disabled]);
  const show = () => {
    setFallback(false);
    if (Platform.OS !== 'android') {
      setOpen(true);
      return;
    }
    nativeOpen.current = true;
    DateTimePickerAndroid.open({
      value: carrier,
      mode: 'time',
      display: 'spinner',
      minuteInterval: 15,
      timeZoneName: 'UTC',
      is24Hour: true,
      onValueChange: (_event, date) => {
        nativeOpen.current = false;
        if (!disabled) pick(date);
      },
      onDismiss: () => {
        nativeOpen.current = false;
      },
      onError: () => {
        nativeOpen.current = false;
        setFallback(true);
        setOpen(true);
      },
    });
  };
  return (
    <>
      <ListRow
        title={label}
        subtitle={value}
        accessibilityLabel={`${label}, ${value}`}
        disabled={disabled}
        onPress={show}
      />
      {open && !disabled && (
        <BottomSheet
          visible
          onDismiss={() => setOpen(false)}
          title={`Choose ${label.toLowerCase()}`}
          respectReducedMotion
          showHandle
        >
          <Text style={[typography.body, { color: c.textSecondary }]}>
            24-hour time · 15-minute steps
          </Text>
          {fallback || Platform.OS !== 'ios' ? (
            <View style={{ gap: spacing.sm }}>
              {timeChoices.map((time) => (
                <Button
                  key={time}
                  label={time}
                  accessibilityLabel={`${label} ${time}${time === value ? ', selected' : ''}`}
                  variant={time === value ? 'primary' : 'secondary'}
                  onPress={() => {
                    onChange(time);
                    setOpen(false);
                  }}
                />
              ))}
            </View>
          ) : (
            <DateTimePicker
              value={carrier}
              mode="time"
              display="spinner"
              minuteInterval={15}
              timeZoneName="UTC"
              is24Hour
              themeVariant={c === palettes.dark ? 'dark' : 'light'}
              accessibilityLabel={label}
              onValueChange={(_event, date) => {
                if (!disabled) pick(date);
              }}
            />
          )}
          <Button
            label="Close time selector"
            variant="link"
            onPress={() => setOpen(false)}
          />
        </BottomSheet>
      )}
    </>
  );
}
