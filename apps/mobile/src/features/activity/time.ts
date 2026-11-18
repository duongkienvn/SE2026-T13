import {
  describeCardDate,
  type DatePreferences,
} from '../cards/metadata/dates.ts';

export function activityTime(
  createdAt: string,
  preferences: DatePreferences,
  now = Date.now(),
  locale?: string,
) {
  const seconds = (Date.parse(createdAt) - now) / 1_000;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const unit =
    Math.abs(seconds) < 60
      ? 'second'
      : Math.abs(seconds) < 3_600
        ? 'minute'
        : Math.abs(seconds) < 86_400
          ? 'hour'
          : undefined;
  const value =
    seconds / (unit === 'hour' ? 3_600 : unit === 'minute' ? 60 : 1);
  const exact = describeCardDate(createdAt, preferences);
  return {
    relative: unit ? relative.format(Math.trunc(value), unit) : exact.short,
    exact: `${exact.absolute}; ${createdAt}`,
  };
}
