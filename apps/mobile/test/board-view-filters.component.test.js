/* global test, expect */
import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  BoardViewFiltersProvider,
  useBoardViewFilters,
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
