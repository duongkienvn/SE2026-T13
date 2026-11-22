import {
  wallTime,
  formatWallTime,
  formatOffset,
} from '../cards/metadata/dates.ts';
import { weekDays } from '../calendar/week.ts';
import { validZone, type Preferences } from './model.ts';
export function listTimeZones(include: string[] = []): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    /* Hermes versions without enumeration still support explicit valid zones. */
  }
  return [...new Set(['UTC', ...zones, ...include])].filter(validZone);
}
export function deviceTimeZone(): string | null {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validZone(value) ? value : null;
  } catch {
    return null;
  }
}
export function regionalPreview(p: Preferences, now: number) {
  const instant = new Date(now).toISOString(),
    wall = wallTime(now, p.timeZone);
  const formatted = formatWallTime(wall, p.dateFormat);
  return {
    date: formatted.date,
    time: `${formatted.time} (${formatOffset(instant, p.timeZone)})`,
    weekStart: weekDays(
      formatWallTime(wall, 'YYYY-MM-DD').date,
      p.weekStartsOn,
    )[0]!,
  };
}
