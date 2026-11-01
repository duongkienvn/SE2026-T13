import { CardDueStatus } from '@kanban/shared';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../../../components/Alert';
import { Button } from '../../../../components/Button';
import { TextField } from '../../../../components/TextField';
import { PencilIcon } from '../../../../components/icons';
import { toFormErrors } from '../../../../lib/form-errors';
import { isApiError } from '../../../../lib/api-client';
import { DEFAULT_PREFERENCES } from '../../../settings/format';
import { usePreferences } from '../../../settings/hooks';
import {
  cardDueStatus,
  DUE_STATUS_LABELS,
  formatCardInstant,
  offsetLabel,
  resolveWallClock,
  wallClockOf,
  type WallClock,
} from '../../card-dates';
import {
  isFieldDirty,
  type CardDraft,
  type DatesValue,
} from '../../card-draft';
import { useUpdateCard } from '../../hooks';
import type { Card, UpdateCardRequest } from '../../types';
import { CardRailGroup, sectionActionClass } from './CardDetailSection';

type Which = 'start' | 'due';
const DEFAULT_TIME: Record<Which, string> = { start: '09:00', due: '17:00' };
const NAMES: Record<Which, string> = { start: 'Start', due: 'Due' };

const empty: WallClock = { date: '', time: '' };
const clockOf = (instant: string | null, timeZone: string): WallClock =>
  instant ? wallClockOf(instant, timeZone) : empty;

const STATUS_CLASSES: Record<CardDueStatus, string> = {
  NO_DUE_DATE: 'bg-app text-muted',
  OVERDUE: 'bg-danger-solid text-white',
  DUE_TODAY: 'bg-danger/10 text-danger',
  UPCOMING: 'bg-primary-soft text-primary',
};

/** Due-state chip from the shared P3-03 rule; reusable by Board previews. */
export function DueStatusBadge({
  dueDate,
  timeZone,
  now = Date.now(),
}: {
  dueDate: string | null;
  timeZone: string;
  now?: number;
}) {
  const status = cardDueStatus(dueDate, now, timeZone);
  if (!status || status === CardDueStatus.NO_DUE_DATE) return null;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {DUE_STATUS_LABELS[status]}
    </span>
  );
}

/** The user's saved zone and date format; UTC defaults until they load. */
export function useDatePreferences() {
  const preferences = usePreferences();
  const data = preferences.data ?? DEFAULT_PREFERENCES;
  return {
    timeZone: data.timeZone,
    dateFormat: data.dateFormat,
    loading: preferences.isPending && !preferences.isError,
  };
}

interface Resolved {
  /** `undefined`: unchanged; `null`: cleared. */
  value?: string | null;
  error?: string;
  /** Both readings of a time the clock showed twice. */
  choices?: [string, string];
}

function resolve(
  which: Which,
  value: WallClock,
  initial: WallClock,
  timeZone: string,
  choice: number | undefined,
): Resolved {
  if (value.date === initial.date && value.time === initial.time) return {};
  if (!value.date) return { value: null };
  if (!value.time)
    return { error: `Choose a ${NAMES[which].toLowerCase()} time.` };
  const result = resolveWallClock(value, timeZone);
  if (result.kind === 'invalid')
    return { error: 'Enter a valid date and time.' };
  if (result.kind === 'nonexistent')
    return {
      error: `${value.time} does not exist on that day in ${timeZone} because the clocks move forward. Choose another time.`,
    };
  if (result.kind === 'ambiguous')
    return choice === undefined
      ? { choices: result.instants }
      : { value: result.instants[choice], choices: result.instants };
  return { value: result.instant };
}

export function CardDates({
  card,
  draft,
  onDraft,
  readOnly,
}: {
  card: Card;
  draft: CardDraft['dates'];
  onDraft: (value: CardDraft['dates']) => void;
  readOnly: boolean;
}) {
  const { timeZone, dateFormat } = useDatePreferences();
  const update = useUpdateCard(card.boardId, card.id);
  const [choice, setChoice] = useState<Record<Which, number | undefined>>({
    start: undefined,
    due: undefined,
  });
  const [errors, setErrors] = useState<Partial<Record<Which, string>>>({});
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const editing = !!draft && !readOnly;

  const start = () => {
    const initial: DatesValue = {
      start: clockOf(card.startDate, timeZone),
      due: clockOf(card.dueDate, timeZone),
    };
    setErrors({});
    setFormError(undefined);
    setNotice(undefined);
    setChoice({ start: undefined, due: undefined });
    onDraft({
      base: { startDate: card.startDate, dueDate: card.dueDate },
      timeZone,
      initial,
      value: initial,
    });
  };

  const change = (which: Which, next: WallClock) => {
    if (!draft) return;
    // Picking a day first fills a sensible time instead of failing.
    const value =
      next.date && !next.time && !draft.value[which].time
        ? { ...next, time: DEFAULT_TIME[which] }
        : next;
    setChoice((current) => ({ ...current, [which]: undefined }));
    onDraft({ ...draft, value: { ...draft.value, [which]: value } });
  };

  const resolved = draft
    ? {
        start: resolve(
          'start',
          draft.value.start,
          draft.initial.start,
          draft.timeZone,
          choice.start,
        ),
        due: resolve(
          'due',
          draft.value.due,
          draft.initial.due,
          draft.timeZone,
          choice.due,
        ),
      }
    : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !resolved || update.isPending) return;
    const nextErrors: Partial<Record<Which, string>> = {};
    for (const which of ['start', 'due'] as const) {
      const item = resolved[which];
      if (item.error) nextErrors[which] = item.error;
      else if (item.choices && item.value === undefined)
        nextErrors[which] = 'Choose which of the two times you mean.';
    }
    const startDate =
      resolved.start.value === undefined
        ? draft.base.startDate
        : resolved.start.value;
    const dueDate =
      resolved.due.value === undefined
        ? draft.base.dueDate
        : resolved.due.value;
    if (
      !nextErrors.start &&
      !nextErrors.due &&
      startDate &&
      dueDate &&
      new Date(startDate).getTime() > new Date(dueDate).getTime()
    )
      nextErrors.due = 'The due date must be on or after the start date.';
    setErrors(nextErrors);
    setFormError(undefined);
    if (nextErrors.start || nextErrors.due) return;

    // One PATCH carries both dates, so the pair is never saved half-changed.
    const patch: UpdateCardRequest = {};
    if (resolved.start.value !== undefined && startDate !== card.startDate)
      patch.startDate = startDate;
    if (resolved.due.value !== undefined && dueDate !== card.dueDate)
      patch.dueDate = dueDate;
    if (Object.keys(patch).length === 0) {
      onDraft(undefined);
      return;
    }
    try {
      await update.mutateAsync(patch);
      onDraft(undefined);
      setNotice('Dates saved.');
    } catch (failure) {
      if (isApiError(failure) && failure.code === 'CARD_DATE_RANGE_INVALID') {
        setErrors({ due: 'The due date must be on or after the start date.' });
        return;
      }
      const result = toFormErrors(failure, {
        startDate: 'Start date',
        dueDate: 'Due date',
      });
      setErrors({
        start: result.fieldErrors.startDate,
        due: result.fieldErrors.dueDate,
      });
      setFormError(result.formError);
    }
  };

  const remoteChanged =
    !!draft &&
    (draft.base.startDate !== card.startDate ||
      draft.base.dueDate !== card.dueDate);

  return (
    <CardRailGroup title="Dates">
      {editing && resolved ? (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="space-y-3"
        >
          {remoteChanged && (
            <Alert variant="error">
              <p>Someone else changed these dates while you were editing.</p>
              <button
                type="button"
                className="mt-1 font-medium text-primary underline"
                onClick={start}
              >
                Discard mine and load theirs
              </button>
            </Alert>
          )}
          {(['start', 'due'] as const).map((which) => (
            <fieldset key={which} className="space-y-2">
              <legend className="sr-only">{NAMES[which]}</legend>
              {/* Side by side only while the dates span the full width. */}
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                <TextField
                  label={`${NAMES[which]} date`}
                  type="date"
                  value={draft.value[which].date}
                  onChange={(event) =>
                    change(which, {
                      ...draft.value[which],
                      date: event.currentTarget.value,
                    })
                  }
                />
                <TextField
                  label={`${NAMES[which]} time`}
                  type="time"
                  value={draft.value[which].time}
                  disabled={!draft.value[which].date}
                  onChange={(event) =>
                    change(which, {
                      ...draft.value[which],
                      time: event.currentTarget.value,
                    })
                  }
                />
              </div>
              {resolved[which].choices && (
                <div
                  role="radiogroup"
                  aria-label={`Which ${draft.value[which].time} do you mean?`}
                  className="space-y-1 rounded-lg border border-line p-2 text-sm"
                >
                  <p className="text-[13px] text-muted">
                    The clocks go back that night, so this time happens twice.
                  </p>
                  {resolved[which].choices.map((instant, index) => (
                    <label key={instant} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${which}-offset`}
                        checked={choice[which] === index}
                        onChange={() =>
                          setChoice((current) => ({
                            ...current,
                            [which]: index,
                          }))
                        }
                      />
                      {index === 0 ? 'First' : 'Second'} (
                      {offsetLabel(instant, draft.timeZone)})
                    </label>
                  ))}
                </div>
              )}
              {draft.value[which].date && (
                <button
                  type="button"
                  className="text-[13px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => change(which, empty)}
                >
                  Clear {NAMES[which].toLowerCase()} date
                </button>
              )}
              {errors[which] && (
                <p role="alert" className="text-[13px] text-danger">
                  {errors[which]}
                </p>
              )}
            </fieldset>
          ))}
          <p className="text-[13px] text-muted">Times in {draft.timeZone}.</p>
          {formError && <Alert variant="error">{formError}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save dates'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={update.isPending}
              onClick={() => onDraft(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          {draft && isFieldDirty({ dates: draft }, 'dates') && (
            <Alert variant="error">
              This card can no longer be changed, so your unsaved dates were not
              saved.{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => onDraft(undefined)}
              >
                Dismiss
              </button>
            </Alert>
          )}
          <dl className="space-y-1.5 text-sm">
            {(['start', 'due'] as const).map((which) => {
              const value = which === 'start' ? card.startDate : card.dueDate;
              return (
                <div
                  key={which}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <dt className="w-10 text-muted">{NAMES[which]}</dt>
                  <dd className="text-ink">
                    {value ? (
                      <time dateTime={value}>
                        {formatCardInstant(value, dateFormat, timeZone)}
                      </time>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </dd>
                  {which === 'due' && (
                    <dd>
                      <DueStatusBadge dueDate={value} timeZone={timeZone} />
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
          {(card.startDate || card.dueDate) && (
            <p className="text-[13px] text-muted">Times in {timeZone}.</p>
          )}
          {notice && <Alert variant="success">{notice}</Alert>}
          {!readOnly && (
            <button
              type="button"
              className={sectionActionClass}
              onClick={start}
            >
              <PencilIcon aria-hidden="true" className="size-4" />
              Edit dates
            </button>
          )}
        </div>
      )}
    </CardRailGroup>
  );
}
