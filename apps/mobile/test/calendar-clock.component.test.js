/* global jest, test, expect */
import { Text, AppState } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { useCalendarClock } from '../src/features/calendar/useCalendarClock';
import { calendarToday } from '../src/features/calendar/due-groups';

function Clock({ active, zone, onBoundary }) {
  const now = useCalendarClock(active, onBoundary);
  return <Text>{calendarToday(zone, now)}</Text>;
}

test('foreground clock crosses account midnight, pauses background and resamples wake without leaking timers', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-17T16:59:59Z'));
  const boundary = jest.fn();
  const original = AppState.addEventListener.getMockImplementation();
  let listener;
  const remove = jest.fn();
  AppState.addEventListener.mockImplementation((_, callback) => {
    listener = callback;
    return { remove };
  });
  try {
    const mounted = await render(
      <Clock active zone="Asia/Bangkok" onBoundary={boundary} />,
    );
    await act(() => listener('active'));
    expect(screen.getByText('2026-11-17')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1000));
    expect(screen.getByText('2026-11-18')).toBeTruthy();
    await act(() => listener('background'));
    const before = boundary.mock.calls.length;
    jest.setSystemTime(new Date('2026-11-20T00:00:00Z'));
    await act(() => jest.advanceTimersByTime(60_000));
    expect(boundary).toHaveBeenCalledTimes(before);
    expect(screen.getByText('2026-11-18')).toBeTruthy();
    await act(() => listener('active'));
    expect(screen.getByText('2026-11-20')).toBeTruthy();
    await mounted.unmount();
    expect(remove).toHaveBeenCalled();
    const stopped = boundary.mock.calls.length;
    await act(() => jest.advanceTimersByTime(120_000));
    expect(boundary).toHaveBeenCalledTimes(stopped);
  } finally {
    AppState.addEventListener.mockImplementation(original);
    jest.useRealTimers();
  }
});

test.each([
  ['2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z'],
  ['2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z'],
])(
  'clock through New York DST %s stays on its civil day',
  async (before, after) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(before));
    const mounted = await render(<Clock active zone="America/New_York" />);
    try {
      const day = calendarToday('America/New_York', Date.parse(before));
      jest.setSystemTime(new Date(after));
      await act(() => jest.advanceTimersByTime(60_000));
      expect(screen.getByText(day)).toBeTruthy();
    } finally {
      await mounted.unmount();
      jest.useRealTimers();
    }
  },
);
