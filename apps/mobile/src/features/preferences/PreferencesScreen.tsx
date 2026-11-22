import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { ApiError } from '../../infrastructure/api/errors';
import { useDraftNavigation } from '../../navigation/useDraftNavigation';
import {
  Button,
  Surface,
  TextField,
  UnsavedChangesPrompt,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { dateFormats, weekStarts, validZone } from './model';
import { listTimeZones, deviceTimeZone, regionalPreview } from './format';
import { Choice, Note, PreferencesPage } from './components';
import { preferencesError } from './usePreferences';
import { useRegionalPreferences } from './useRegionalPreferences';
export function PreferencesScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <Regional
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function Regional({ identity }: { identity: SessionIdentity }) {
  const p = useRegionalPreferences(identity),
    c = useTheme(),
    navigation = useDraftNavigation(p, '/preferences');
  const [selectingZone, setSelectingZone] = useState(false);
  const [search, setSearch] = useState(''),
    [limit, setLimit] = useState(10),
    [now, setNow] = useState(Date.now);
  const searchRef = useRef<ComponentRef<typeof TextInput>>(null);
  const draft = p.form?.draft,
    device = deviceTimeZone();
  const zones = useMemo(
    () =>
      listTimeZones([p.form?.saved.timeZone ?? 'UTC', device ?? '', search]),
    [p.form?.saved.timeZone, device, search],
  );
  const matches = zones.filter((zone) =>
    zone
      .toLowerCase()
      .replaceAll('_', ' ')
      .includes(search.toLowerCase().replaceAll('_', ' ')),
  );
  const preview = draft ? regionalPreview(draft, now) : null;
  const editable = !p.pending && !p.state.uncertain;
  useEffect(() => {
    if (!p.eligible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [p.eligible]);
  useEffect(() => {
    if (p.state.error instanceof ApiError && p.state.error.status === 400)
      setSelectingZone(true);
  }, [p.state.error]);
  useEffect(() => {
    if (selectingZone) searchRef.current?.focus();
  }, [selectingZone]);
  const heading = (text: string) => (
    <Text
      accessibilityRole="header"
      style={[typography.section, { color: c.text }]}
    >
      {text}
    </Text>
  );
  return (
    <>
      <PreferencesPage title="Preferences" pending={p.pending}>
        <Note>Choose how dates and times are shown across Kanvexa.</Note>
        {!p.online && (
          <Note>You’re offline. Your draft is kept; reconnect to save.</Note>
        )}
        {!p.form && !p.query.isError && <Note>Loading preferences…</Note>}
        {(p.query.isError || p.state.error !== null) && (
          <Note error>{preferencesError(p.state.error ?? p.query.error)}</Note>
        )}
        {p.state.uncertain && (
          <Note error>
            The earlier save is unconfirmed and may still finish. Your draft is
            kept. Further saves remain blocked even after checking server
            values.
          </Note>
        )}
        {p.form && draft && preview && !p.denied && (
          <>
            <Surface>
              {heading('Time zone')}
              <Text style={[typography.strong, { color: c.text }]}>
                {draft.timeZone}
              </Text>
              <Button
                label={
                  selectingZone ? 'Close time zone list' : 'Choose time zone'
                }
                variant="secondary"
                disabled={!editable}
                onPress={() => setSelectingZone((v) => !v)}
              />
              {selectingZone && (
                <>
                  <TextField
                    ref={searchRef}
                    label="Search time zones"
                    error={
                      p.state.error instanceof ApiError &&
                      p.state.error.status === 400
                        ? 'Choose a time zone supported by the server.'
                        : undefined
                    }
                    value={search}
                    editable={editable}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(text) => {
                      setSearch(text);
                      setLimit(10);
                    }}
                    hint="Search supported zones or enter a named IANA zone, such as America/New_York."
                  />
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Time zone"
                    style={{ gap: spacing.sm }}
                  >
                    {matches.slice(0, limit).map((zone) => (
                      <Choice
                        key={zone}
                        label={zone}
                        detail={zone.replaceAll('_', ' ')}
                        selected={zone === draft.timeZone}
                        disabled={!editable}
                        onPress={() => {
                          p.edit({ timeZone: zone });
                          setSelectingZone(false);
                        }}
                      />
                    ))}
                  </View>
                  {!matches.length && (
                    <Note>
                      No supported zone found. Enter a valid named IANA zone.
                    </Note>
                  )}
                  {matches.length > limit && (
                    <Button
                      label="Show more time zones"
                      variant="secondary"
                      onPress={() => setLimit((v) => v + 10)}
                    />
                  )}
                </>
              )}
              {device && device !== draft.timeZone && (
                <Button
                  label="Use device time zone"
                  variant="secondary"
                  disabled={!editable}
                  onPress={() => p.edit({ timeZone: device })}
                />
              )}
              <Note>Current time in selected zone: {preview.time}</Note>
              <Note>
                Your saved zone will not change automatically when you travel.
              </Note>
            </Surface>
            <Surface>
              {heading('Date format')}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Date format"
                style={{ gap: spacing.sm }}
              >
                {dateFormats.map((format) => (
                  <Choice
                    key={format}
                    label={format}
                    detail={
                      regionalPreview({ ...draft, dateFormat: format }, now)
                        .date
                    }
                    selected={format === draft.dateFormat}
                    disabled={!editable}
                    onPress={() => p.edit({ dateFormat: format })}
                  />
                ))}
              </View>
            </Surface>
            <Surface>
              {heading('Week starts on')}
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Week starts on"
                style={{ gap: spacing.sm }}
              >
                {weekStarts.map((day) => (
                  <Choice
                    key={day}
                    label={day === 'monday' ? 'Monday' : 'Sunday'}
                    selected={day === draft.weekStartsOn}
                    disabled={!editable}
                    onPress={() => p.edit({ weekStartsOn: day })}
                  />
                ))}
              </View>
              <Note>Start of current week: {preview.weekStart}</Note>
            </Surface>
            <Surface>
              {heading('Preview')}
              <Note>
                {preview.date} · {preview.time} in {draft.timeZone}
              </Note>
              <Note>
                Preview only until Save. Stored Card dates and quiet-hour times
                stay unchanged.
              </Note>
            </Surface>
            {p.form.conflict && (
              <>
                <Note error>
                  Preferences changed elsewhere. Review the latest values before
                  saving your edits.
                </Note>
                <Note>
                  Latest saved: {p.form.saved.timeZone},{' '}
                  {p.form.saved.dateFormat}, {p.form.saved.weekStartsOn}.
                </Note>
                <Button
                  label="Keep my edits after review"
                  disabled={p.pending}
                  variant="secondary"
                  onPress={p.acknowledge}
                />
              </>
            )}
            {!!p.notice && <Note>{p.notice}</Note>}
            <Button
              label="Cancel"
              variant="secondary"
              disabled={!p.dirty || p.pending}
              onPress={p.cancel}
            />
            <Button
              label="Save changes"
              loading={p.pending}
              disabled={!p.canSave || !validZone(draft.timeZone)}
              onPress={() => void p.save()}
            />
          </>
        )}
        <Button
          label="Try again"
          variant="secondary"
          disabled={!p.canRefresh}
          onPress={() => void p.refresh()}
        />
      </PreferencesPage>
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
        message="Your preference changes have not been saved."
      />
    </>
  );
}
