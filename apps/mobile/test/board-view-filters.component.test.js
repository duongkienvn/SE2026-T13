/* global test, expect */
import { useState } from 'react';
import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  BoardViewFiltersProvider,
  useBoardViewFilters,
  useCalendarViewState,
} from '../src/features/boards/BoardViewFilters';
import { Button } from '../src/ui';

function View({ name, boardId }) {
  const [filters, setFilters] = useBoardViewFilters(boardId);
  return (
    <>
      <Text>{`${name}: ${filters.q ?? 'none'}`}</Text>
      <Button
        label={`Filter ${name}`}
        onPress={() => setFilters({ q: name })}
      />
    </>
  );
}

test('Board/Table/Calendar share compatible filters only for same Board and private session', async () => {
  const tree = (key) => (
    <BoardViewFiltersProvider key={key}>
      <View name="Board" boardId="a" />
      <View name="Table" boardId="a" />
      <View name="Calendar" boardId="a" />
      <View name="Other Board" boardId="b" />
    </BoardViewFiltersProvider>
  );
  const mounted = await render(tree('session-a'));
  await fireEvent.press(screen.getByRole('button', { name: 'Filter Board' }));
  expect(screen.getByText('Calendar: Board')).toBeTruthy();
  expect(screen.getByText('Table: Board')).toBeTruthy();
  expect(screen.getByText('Other Board: none')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Filter Calendar' }),
  );
  expect(screen.getByText('Board: Calendar')).toBeTruthy();
  await mounted.rerender(tree('session-b'));
  expect(screen.getByText('Calendar: none')).toBeTruthy();
  expect(screen.getByText('Board: none')).toBeTruthy();
});

function CalendarState({ scope }) {
  const value = useCalendarViewState(scope);
  const [, rerender] = useState(0);
  return (
    <>
      <Text>{`${scope}: ${value.view}, ${value.selectedDay ?? 'today'}, ${value.scroll.week}`}</Text>
      <Button
        label="Select week"
        onPress={() => {
          value.view = 'week';
          value.selectedDay = '2026-12-30';
          value.scroll.week = 420;
          rerender((n) => n + 1);
        }}
      />
    </>
  );
}
test('Calendar restoration isolates Board/session and survives only a same-owner route remount', async () => {
  const tree = (session, scope, visible = true) => (
    <BoardViewFiltersProvider key={session}>
      {visible && <CalendarState key={scope} scope={scope} />}
    </BoardViewFiltersProvider>
  );
  const mounted = await render(tree('a', 'a:1:board-a'));
  await fireEvent.press(screen.getByRole('button', { name: 'Select week' }));
  await mounted.rerender(tree('a', 'a:1:board-b'));
  expect(screen.getByText('a:1:board-b: month, today, 0')).toBeTruthy();
  await mounted.rerender(tree('a', 'a:1:board-a', false));
  await mounted.rerender(tree('a', 'a:1:board-a'));
  expect(screen.getByText('a:1:board-a: week, 2026-12-30, 420')).toBeTruthy();
  await mounted.rerender(tree('b', 'b:2:board-a'));
  expect(screen.getByText('b:2:board-a: month, today, 0')).toBeTruthy();
});
