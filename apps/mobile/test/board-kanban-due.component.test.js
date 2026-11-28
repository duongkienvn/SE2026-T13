/* global jest, test, expect */
import { AppState, StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { BoardKanban } from '../src/features/boards/BoardKanban';
import { ThemeContext, palettes } from '../src/ui';
import { card, column } from './workspaces/kanban-fixtures';

function kanban(cards, extra = {}) {
  return (
    <ThemeContext.Provider value="light">
      <BoardKanban
        columns={[column(1)]}
        columnsComplete
        groups={new Map([[column(1).id, cards]])}
        cardsReady
        cardsComplete
        cardsLoading={false}
        previews={new Map()}
        labels={[]}
        members={[]}
        timeZone="Asia/Bangkok"
        scroll={{ x: 0, cards: new Map() }}
        onOpen={() => {}}
        {...extra}
      />
    </ThemeContext.Provider>
  );
}

const dueColor = () =>
  StyleSheet.flatten(screen.getByText(/^Due /).props.style).color;

async function withForeground(run) {
  jest.useFakeTimers();
  const original = AppState.addEventListener.getMockImplementation();
  const state = AppState.currentState;
  const listeners = new Set();
  AppState.addEventListener.mockImplementation((_, callback) => {
    listeners.add(callback);
    return { remove: () => listeners.delete(callback) };
  });
  const app = (next) => {
    AppState.currentState = next;
    listeners.forEach((callback) => callback(next));
  };
  try {
    await run(app, listeners);
  } finally {
    AppState.addEventListener.mockImplementation(original);
    AppState.currentState = state;
    jest.useRealTimers();
  }
}

test('F02: an open Kanban flips the due badge at the instant without a refresh request', () =>
  withForeground(async (app) => {
    jest.setSystemTime(new Date('2026-11-27T10:00:00.000Z'));
    const item = { ...card(1), dueDate: '2026-11-27T10:00:01.000Z' };
    const boundary = jest.fn();
    // No due filter: the badge changes but nothing needs reconciliation.
    const view = await render(
      kanban([item], { fetchedAt: Date.now(), onDueBoundary: undefined }),
    );
    await act(() => app('active'));
    expect(dueColor()).toBe(palettes.light.info);
    await act(() => jest.advanceTimersByTime(1_002));
    expect(dueColor()).toBe(palettes.light.danger);
    await view.rerender(
      kanban([item], { fetchedAt: Date.now(), onDueBoundary: boundary }),
    );
    await act(() => jest.advanceTimersByTime(3_600_000));
    expect(boundary).not.toHaveBeenCalled();
    await view.unmount();
  }));

test('F02: an active DUE_TODAY filter reconciles at a loaded instant and at account midnight only', () =>
  withForeground(async (app, listeners) => {
    jest.setSystemTime(new Date('2026-11-27T16:58:00.000Z')); // 23:58 Bangkok
    const item = { ...card(1), dueDate: '2026-11-27T16:59:00.000Z' };
    const boundary = jest.fn();
    const props = (fetchedAt) => ({
      dueStatus: 'DUE_TODAY',
      fetchedAt,
      onDueBoundary: boundary,
    });
    const view = await render(kanban([item], props(Date.now())));
    await act(() => app('active'));
    await act(() => jest.advanceTimersByTime(30_000));
    expect(boundary).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(30_001));
    expect(boundary).toHaveBeenCalledTimes(1);
    // The refreshed server page no longer contains the overdue Card.
    await view.rerender(kanban([], props(Date.now())));
    await act(() => jest.advanceTimersByTime(59_000));
    expect(boundary).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1_000)); // 00:00 Bangkok
    expect(boundary).toHaveBeenCalledTimes(2);
    await view.rerender(kanban([], props(Date.now())));
    await act(() => jest.advanceTimersByTime(3_600_000));
    expect(boundary).toHaveBeenCalledTimes(2);
    // Blur stops timers and unsubscribes.
    await view.rerender(kanban([], { ...props(Date.now()), active: false }));
    expect(listeners.size).toBe(0);
    await act(() => jest.advanceTimersByTime(86_400_000));
    expect(boundary).toHaveBeenCalledTimes(2);
    await view.unmount();
  }));

test('F02: OVERDUE keeps Web’s bounded minute cadence; NO_DUE_DATE never reconciles', () =>
  withForeground(async (app) => {
    jest.setSystemTime(new Date('2026-11-27T10:00:30.000Z'));
    const boundary = jest.fn();
    const view = await render(
      kanban([], {
        dueStatus: 'NO_DUE_DATE',
        fetchedAt: Date.now(),
        onDueBoundary: boundary,
      }),
    );
    await act(() => app('active'));
    await act(() => jest.advanceTimersByTime(3_600_000));
    expect(boundary).not.toHaveBeenCalled();
    await view.unmount();
    const overdue = await render(
      kanban([], {
        dueStatus: 'OVERDUE',
        fetchedAt: Date.now(),
        onDueBoundary: boundary,
      }),
    );
    await act(() => app('active'));
    await act(() => jest.advanceTimersByTime(30_000));
    expect(boundary).toHaveBeenCalledTimes(1);
    // Without a refresh landing, it retries at most once per minute.
    await act(() => jest.advanceTimersByTime(59_000));
    expect(boundary).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1_000));
    expect(boundary).toHaveBeenCalledTimes(2);
    await overdue.unmount();
  }));
