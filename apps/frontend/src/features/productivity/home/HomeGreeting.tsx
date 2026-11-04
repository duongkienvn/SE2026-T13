import { formatInstantDate } from '../../settings/format';
import type { DateFormat } from '../../settings/types';

/** Hour of day for `now` in the user's saved IANA time zone. */
export function hourIn(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

export function greetingFor(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First word of the display name; the whole name when it has no spaces. */
export function firstName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed.split(/\s+/u)[0] : undefined;
}

export function HomeGreeting({
  name,
  timeZone,
  dateFormat,
  now = new Date(),
}: {
  name: string | undefined;
  timeZone: string | undefined;
  dateFormat: DateFormat | undefined;
  now?: Date;
}) {
  const first = firstName(name);
  const greeting = timeZone ? greetingFor(hourIn(now, timeZone)) : 'Welcome';
  return (
    <header className="home-header">
      <div className="min-w-0">
        <h1>
          {greeting}
          {first ? `, ${first}` : ''}!{' '}
          <span aria-hidden="true" className="home-wave">
            👋
          </span>
        </h1>
        <p>Here&apos;s what&apos;s happening with your work today.</p>
      </div>
      {timeZone && dateFormat && (
        <p className="home-date">
          <time dateTime={now.toISOString()}>
            {new Intl.DateTimeFormat('en-US', {
              timeZone,
              weekday: 'short',
            }).format(now)}
            , {formatInstantDate(now, dateFormat, timeZone)}
          </time>
        </p>
      )}
    </header>
  );
}
