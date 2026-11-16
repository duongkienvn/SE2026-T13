import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Chip,
  ListRow,
  palettes,
  spacing,
  useTheme,
} from '../../../ui';
import {
  applyPickerValue,
  dateRangeError,
  formatOffset,
  formatWallTime,
  resolveWallTime,
  wallTime,
  type DateField,
  type DatePreferences,
} from './dates';
import type { MetadataCommand } from './mutations';
import {
  dateTitles,
  DiscardMetadataActions,
  MetadataMessage,
} from './presentation';

export function DateEditor({
  field,
  original,
  current,
  counterpart,
  preferences,
  disabled,
  pending,
  error,
  close,
  save,
}: {
  field: DateField;
  original: string | null;
  current: string | null;
  counterpart: string | null;
  preferences: DatePreferences;
  disabled: boolean;
  pending: boolean;
  error?: string;
  close: () => void;
  save: (command: MetadataCommand) => void;
}) {
  const c = useTheme();
  const [zone] = useState(preferences.timeZone);
  const [wall, setWall] = useState(() =>
    wallTime(original ?? Date.now(), zone),
  );
  const [edited, setEdited] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [choice, setChoice] = useState<string>();
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pickerError, setPickerError] = useState(false);
  const nativePicker = useRef<'date' | 'time' | null>(null);
  const zoneChanged = zone !== preferences.timeZone;
  const choices = edited && !cleared ? resolveWallTime(wall, zone) : [];
  const selection = choices.length === 1 ? choices[0] : choice;
  const sameMinute = !!(
    selection &&
    original &&
    Math.floor(Date.parse(selection) / 60_000) ===
      Math.floor(Date.parse(original) / 60_000)
  );
  const value = cleared ? null : !edited || sameMinute ? original : selection;
  const warning = zoneChanged
    ? 'Your time zone changed. Close and reopen to edit in the new time zone.'
    : current !== original && current !== value
      ? 'This date changed. Close and reopen to review it.'
      : edited && !cleared && !choices.length
        ? 'This time does not exist in this time zone. Choose another time.'
        : value !== undefined
          ? dateRangeError(field, value, counterpart)
          : undefined;
  const blocked = disabled || pending || zoneChanged;
  const formatted = formatWallTime(wall, preferences.dateFormat);

  useEffect(
    () => () => {
      if (nativePicker.current)
        void DateTimePickerAndroid.dismiss(nativePicker.current).catch(
          () => undefined,
        );
    },
    [],
  );

  const pick = (mode: 'date' | 'time', selected: Date) => {
    const next = applyPickerValue(wall, selected, mode);
    const previous = new Date(wall);
    previous.setUTCSeconds(0, 0);
    if (
      !cleared &&
      (original || edited) &&
      next.getTime() === previous.getTime()
    )
      return;
    setWall(next);
    setChoice(undefined);
    setCleared(false);
    setEdited(true);
  };

  const openPicker = (mode: 'date' | 'time') => {
    if (blocked || nativePicker.current) return;
    setPickerError(false);
    if (Platform.OS === 'android') {
      nativePicker.current = mode;
      DateTimePickerAndroid.open({
        value: wall,
        mode,
        timeZoneName: 'UTC',
        is24Hour: true,
        onValueChange: (_event, selected) => {
          nativePicker.current = null;
          pick(mode, selected);
        },
        onDismiss: () => {
          nativePicker.current = null;
        },
        onError: () => {
          nativePicker.current = null;
          setPickerError(true);
        },
      });
    } else setPicker(mode);
  };

  const dismiss = () => {
    if (discarding) setDiscarding(false);
    else if (value !== original) setDiscarding(true);
    else close();
  };

  return (
    <BottomSheet
      visible
      title={
        discarding
          ? 'Discard date changes?'
          : `Edit ${dateTitles[field].toLowerCase()}`
      }
      onDismiss={dismiss}
      dismissible={!pending}
      dismissLabel="Dismiss date editor"
      showHandle
      respectReducedMotion
      footer={
        discarding ? (
          <DiscardMetadataActions
            keepEditing={() => setDiscarding(false)}
            discard={close}
          />
        ) : (
          <View testID="card-date-actions" style={{ gap: spacing.sm }}>
            <Button
              label="Save"
              loading={pending}
              disabled={blocked || !!warning || value === undefined}
              onPress={() => {
                if (value === undefined || warning || blocked) return;
                if (value === current) close();
                else save({ kind: 'date', field, value, original, zone });
              }}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={pending}
              onPress={close}
            />
          </View>
        )
      }
    >
      {discarding ? (
        <MetadataMessage>Your date changes haven’t been saved.</MetadataMessage>
      ) : (
        <>
          <MetadataMessage>{zone}</MetadataMessage>
          <ListRow
            title="Date"
            subtitle={cleared ? 'Not set' : formatted.date}
            accessibilityLabel="Choose date"
            disabled={blocked}
            onPress={() => openPicker('date')}
          />
          <ListRow
            title="Time"
            subtitle={cleared ? 'Not set' : formatted.time}
            accessibilityLabel="Choose time"
            disabled={blocked}
            onPress={() => openPicker('time')}
          />
          {Platform.OS === 'ios' && picker && !blocked && (
            <DateTimePicker
              key={picker}
              display="spinner"
              mode={picker}
              value={wall}
              timeZoneName="UTC"
              locale="en_GB"
              themeVariant={c === palettes.dark ? 'dark' : 'light'}
              onValueChange={(_event, selected) => pick(picker, selected)}
              accessibilityLabel={
                picker === 'date' ? 'Date picker' : 'Time picker'
              }
            />
          )}
          {choices.length > 1 && (
            <View style={{ gap: spacing.sm }}>
              <MetadataMessage>
                This time occurs twice. Choose its UTC offset.
              </MetadataMessage>
              {choices.map((instant) => (
                <Chip
                  key={instant}
                  label={formatOffset(instant, zone)}
                  selected={choice === instant}
                  disabled={blocked}
                  onPress={() => setChoice(instant)}
                />
              ))}
            </View>
          )}
          {warning && <MetadataMessage error>{warning}</MetadataMessage>}
          {pickerError && (
            <MetadataMessage error>
              Couldn’t open the system picker. Try again.
            </MetadataMessage>
          )}
          {error && <MetadataMessage error>{error}</MetadataMessage>}
          <Button
            label="Clear"
            variant="link"
            disabled={blocked || cleared || (!original && !edited)}
            onPress={() => {
              setPicker(null);
              setCleared(true);
            }}
          />
        </>
      )}
    </BottomSheet>
  );
}
