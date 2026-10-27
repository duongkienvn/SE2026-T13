import { useMemo, useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { PageHeader } from '../../../components/PageHeader';
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { toFormErrors } from '../../../lib/form-errors';
import { useAuthSession } from '../../auth/auth-session-context';
import {
  deviceTimeZone,
  formatInstantDate,
  formatTimeIn,
  listTimeZones,
  WEEK_START_LABELS,
} from '../format';
import { usePreferences, useUpdatePreferences } from '../hooks';
import {
  DATE_FORMATS,
  WEEK_STARTS,
  type UpdatePreferencesRequest,
  type UserPreferences,
} from '../types';

type Draft = Pick<UserPreferences, 'timeZone' | 'dateFormat' | 'weekStartsOn'>;
const FIELD_LABELS = {
  timeZone: 'Time zone',
  dateFormat: 'Date format',
  weekStartsOn: 'Week start',
};
type Field = keyof typeof FIELD_LABELS;

const cardClass =
  'max-w-4xl rounded-xl border border-line bg-surface p-5 shadow-card md:p-6';

/** Only fields that differ from the saved preferences; `{}` means unchanged. */
function buildPatch(saved: Draft, draft: Draft): UpdatePreferencesRequest {
  const patch: UpdatePreferencesRequest = {};
  for (const key of Object.keys(FIELD_LABELS) as Field[]) {
    if (draft[key] !== saved[key]) Object.assign(patch, { [key]: draft[key] });
  }
  return patch;
}

export function PreferencesPage() {
  usePageTitle('Preferences');
  const preferences = usePreferences();
  const { generation } = useAuthSession();

  return (
    <>
      <PageHeader
        title="Preferences"
        description="How dates and times are shown to you across Kanvexa."
      />
      {preferences.isPending && (
        <p className="mt-6 text-sm text-muted">Loading your preferences…</p>
      )}
      {preferences.isError && (
        <div className={`mt-6 space-y-3 ${cardClass}`}>
          <Alert variant="error">Could not load your preferences.</Alert>
          <Button
            variant="secondary"
            onClick={() => void preferences.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {preferences.data && (
        <PreferencesForm key={generation} saved={preferences.data} />
      )}
    </>
  );
}

function PreferencesForm({ saved }: { saved: UserPreferences }) {
  const update = useUpdatePreferences();
  const [draft, setDraft] = useState<Draft>({
    timeZone: saved.timeZone,
    dateFormat: saved.dateFormat,
    weekStartsOn: saved.weekStartsOn,
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [savedNotice, setSavedNotice] = useState(false);

  const zones = useMemo(
    () => listTimeZones([saved.timeZone]),
    [saved.timeZone],
  );
  const device = useMemo(deviceTimeZone, []);
  const patch = buildPatch(saved, draft);
  const isDirty = Object.keys(patch).length > 0;
  const now = new Date();

  const change = <K extends Field>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setSavedNotice(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || update.isPending) return;
    setFormError(undefined);
    setSavedNotice(false);
    update.save(patch, {
      onSuccess: (result) => {
        setDraft({
          timeZone: result.timeZone,
          dateFormat: result.dateFormat,
          weekStartsOn: result.weekStartsOn,
        });
        setSavedNotice(true);
      },
      onError: (error) => {
        const result = toFormErrors(error, FIELD_LABELS);
        setFieldErrors(result.fieldErrors);
        setFormError(result.formError);
      },
    });
  };

  return (
    <form noValidate onSubmit={handleSubmit} className={`mt-6 ${cardClass}`}>
      <div className="space-y-4">
        {savedNotice && !isDirty && (
          <Alert variant="success">Preferences saved.</Alert>
        )}
        {formError && <Alert variant="error">{formError}</Alert>}

        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <label
              htmlFor="preferences-time-zone"
              className="block text-sm font-medium text-ink"
            >
              Time zone
            </label>
            <select
              id="preferences-time-zone"
              value={draft.timeZone}
              onChange={(event) => change('timeZone', event.target.value)}
              aria-invalid={fieldErrors.timeZone ? true : undefined}
              aria-describedby="preferences-time-zone-hint"
              className={`mt-1.5 h-11 w-full rounded-lg border bg-surface px-3 text-sm text-ink focus:ring-3 focus:ring-primary/15 focus:outline-none ${
                fieldErrors.timeZone
                  ? 'border-danger focus:border-danger'
                  : 'border-line focus:border-primary'
              }`}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p
              id="preferences-time-zone-hint"
              className={`mt-1 text-[13px] ${fieldErrors.timeZone ? 'text-danger' : 'text-muted'}`}
            >
              {fieldErrors.timeZone ??
                `Now ${formatTimeIn(now, draft.timeZone)} there.`}
              {!fieldErrors.timeZone && device && device !== draft.timeZone && (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => change('timeZone', device)}
                    className="font-medium text-primary underline hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Use device time zone ({device.replace(/_/g, ' ')})
                  </button>
                </>
              )}
            </p>
          </div>

          <ChoiceGroup
            legend="Week starts on"
            name="weekStartsOn"
            value={draft.weekStartsOn}
            options={WEEK_STARTS.map((value) => ({
              value,
              label: WEEK_START_LABELS[value],
            }))}
            onChange={(value) => change('weekStartsOn', value)}
            error={fieldErrors.weekStartsOn}
          />

          <ChoiceGroup
            legend="Date format"
            name="dateFormat"
            value={draft.dateFormat}
            options={DATE_FORMATS.map((value) => ({
              value,
              label: value,
              detail: formatInstantDate(now, value, draft.timeZone),
            }))}
            onChange={(value) => change('dateFormat', value)}
            error={fieldErrors.dateFormat}
          />

          <div className="rounded-lg border border-line bg-app px-4 py-3 text-sm">
            <p className="font-medium text-ink">Preview</p>
            <p className="mt-1 text-muted">
              Today is{' '}
              <span className="font-medium text-ink">
                {formatInstantDate(now, draft.dateFormat, draft.timeZone)}
              </span>{' '}
              in {draft.timeZone.replace(/_/g, ' ')}. Weeks start on{' '}
              {WEEK_START_LABELS[draft.weekStartsOn]}.
            </p>
            <p className="mt-1 text-xs text-muted">
              Dates are stored unchanged; this only affects how they are shown.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <Button
          variant="secondary"
          disabled={!isDirty || update.isPending}
          onClick={() => {
            setDraft({
              timeZone: saved.timeZone,
              dateFormat: saved.dateFormat,
              weekStartsOn: saved.weekStartsOn,
            });
            setFieldErrors({});
            setFormError(undefined);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!isDirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      <UnsavedChangesGuard
        when={isDirty && !update.isPending}
        description="Your preference changes have not been saved."
      />
    </form>
  );
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; detail?: string }[];
  onChange: (value: T) => void;
  error?: string;
}

function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  error,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div
        className={`mt-1.5 grid gap-2 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border px-1.5 py-1.5 text-center text-[13px] whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
                selected
                  ? 'border-primary bg-primary-soft font-semibold text-primary'
                  : 'border-line text-ink hover:bg-app'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
              {option.detail && (
                <span className="text-xs font-normal text-muted">
                  {option.detail}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && <p className="mt-1 text-[13px] text-danger">{error}</p>}
    </fieldset>
  );
}
