/* global jest, test, expect */
import { useState } from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { accountDay } from '../src/features/preferences/temporal';
import { useTemporalReconciler } from '../src/features/preferences/useTemporalReconciler';

function Probe({ active, zone, initialFetchedAt, onStale }) {
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const now = useTemporalReconciler({
    active,
    fetchedAt,
    signature: (at) => (zone ? accountDay(at, zone) : null),
    onStale: () => {
      onStale();
      // A successful refresh moves the classification instant forward.
      setFetchedAt(Date.now());
    },
  });
  return (
    <>
      <Text>{zone ? accountDay(now, zone) : 'unknown'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="fail refresh"
        onPress={() => setFetchedAt(initialFetchedAt)}
      />
    </>
  );
}

function withAppState(run) {
  return async () => {
    jest.useFakeTimers();
    const original = AppState.addEventListener.getMockImplementation();
    const state = { listener: undefined, remove: jest.fn() };
    AppState.addEventListener.mockImplementation((_, callback) => {
      state.listener = callback;
      return { remove: state.remove };
    });
    try {
      await run(state);
    } finally {
      AppState.addEventListener.mockImplementation(original);
      jest.useRealTimers();
    }
  };
}

test(
  'reconciles exactly once at the saved account midnight, then stays quiet',
  withAppState(async (app) => {
    jest.setSystemTime(new Date('2026-11-27T16:59:58Z')); // 23:59:58 Bangkok
    const stale = jest.fn();
    const view = await render(
      <Probe
        active
        zone="Asia/Bangkok"
        initialFetchedAt={Date.now()}
        onStale={stale}
      />,
    );
    await act(() => app.listener('active'));
    expect(screen.getByText('2026-11-27')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1_000));
    expect(stale).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1_500));
    expect(screen.getByText('2026-11-28')).toBeTruthy();
    expect(stale).toHaveBeenCalledTimes(1);
    // An hour of foreground ticks is local only: no further reconciliation.
    await act(() => jest.advanceTimersByTime(3_600_000));
    expect(stale).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(app.remove).toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(86_400_000));
    expect(stale).toHaveBeenCalledTimes(1);
  }),
);

test(
  'background and blur cancel timers; resume after a missed midnight reconciles once',
  withAppState(async (app) => {
    jest.setSystemTime(new Date('2026-11-27T12:00:00Z'));
    const stale = jest.fn();
    const props = {
      zone: 'Asia/Bangkok',
      initialFetchedAt: Date.now(),
      onStale: stale,
    };
    const view = await render(<Probe active {...props} />);
    await act(() => app.listener('active'));
    await act(() => app.listener('background'));
    jest.setSystemTime(new Date('2026-11-28T03:00:00Z'));
    await act(() => jest.advanceTimersByTime(600_000));
    expect(stale).not.toHaveBeenCalled();
    await act(() => app.listener('active'));
    expect(stale).toHaveBeenCalledTimes(1);
    // Blurred screens never reconcile, even across another day.
    await view.rerender(<Probe active={false} {...props} />);
    jest.setSystemTime(new Date('2026-11-30T03:00:00Z'));
    await act(() => jest.advanceTimersByTime(600_000));
    expect(stale).toHaveBeenCalledTimes(1);
    await view.unmount();
  }),
);

test(
  'unknown timezone or no fetched data never requests; a failed refresh retries at most once a minute',
  withAppState(async (app) => {
    jest.setSystemTime(new Date('2026-11-27T16:59:00Z'));
    const unknown = jest.fn();
    const first = await render(
      <Probe
        active
        zone={null}
        initialFetchedAt={Date.now()}
        onStale={unknown}
      />,
    );
    await act(() => app.listener('active'));
    await act(() => jest.advanceTimersByTime(7_200_000));
    expect(unknown).not.toHaveBeenCalled();
    await first.unmount();

    const empty = jest.fn();
    const second = await render(
      <Probe
        active
        zone="Asia/Bangkok"
        initialFetchedAt={undefined}
        onStale={empty}
      />,
    );
    await act(() => app.listener('active'));
    await act(() => jest.advanceTimersByTime(7_200_000));
    expect(empty).not.toHaveBeenCalled();
    await second.unmount();

    jest.setSystemTime(new Date('2026-11-28T16:59:00Z'));
    const failing = jest.fn();
    const third = await render(
      <Probe
        active
        zone="Asia/Bangkok"
        initialFetchedAt={Date.now()}
        onStale={failing}
      />,
    );
    await act(() => app.listener('active'));
    await act(() => jest.advanceTimersByTime(60_000));
    expect(failing).toHaveBeenCalledTimes(1);
    // Simulate the refresh failing: data still belongs to the previous day.
    await fireEvent.press(screen.getByRole('button', { name: 'fail refresh' }));
    await act(() => jest.advanceTimersByTime(59_000));
    expect(failing).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1_000));
    expect(failing).toHaveBeenCalledTimes(2);
    await third.unmount();
  }),
);
