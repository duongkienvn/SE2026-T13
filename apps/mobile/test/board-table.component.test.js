/* global jest, test, expect */
import { AppState, FlatList, StyleSheet, Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { BoardTable } from '../src/features/boards/table/BoardTable';
import { ThemeContext, palettes } from '../src/ui';
import { card, column, preview } from './workspaces/kanban-fixtures';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => ({ width: 320, height: 240, scale: 3, fontScale: 1.6 }),
  };
  descriptors.useColorScheme = {
    configurable: true,
    enumerable: true,
    value: () => 'dark',
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

const props = () => ({
  cards: [card(1)],
  columns: [column(1)],
  previews: new Map(),
  labels: [],
  members: [],
  ready: true,
  complete: true,
  loading: false,
  scroll: { y: 0 },
  active: true,
  header: <Text>Board context</Text>,
  footer: <Text>Server total</Text>,
  onOpen: jest.fn(),
});

test('320dp landscape and 160% text: real metadata has no line caps, actions remain separate, and system theme is semantic', async () => {
  const input = props();
  input.cards[0].title = 'A long real card title '.repeat(5);
  const actions = jest.fn();
  await render(
    <ThemeContext.Provider value="system">
      <BoardTable {...input} onActions={actions} />
    </ThemeContext.Provider>,
  );
  const open = screen.getByRole('button', {
    name: `Open card: ${input.cards[0].title}`,
  });
  expect(StyleSheet.flatten(open.props.style).minHeight).toBe(48);
  expect(StyleSheet.flatten(open.props.style).backgroundColor).toBe(
    palettes.dark.surface,
  );
  expect(
    screen.getByText(input.cards[0].title).props.numberOfLines,
  ).toBeUndefined();
  expect(screen.getByText('Labels unavailable')).toBeTruthy();
  expect(screen.getByText('Checklist unavailable')).toBeTruthy();
  expect(screen.queryByText('0/0')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', {
      name: `Card actions for ${input.cards[0].title}`,
    }),
  );
  expect(actions).toHaveBeenCalledWith(input.cards[0]);
  expect(input.onOpen).not.toHaveBeenCalled();
  await fireEvent.press(open);
  expect(input.onOpen).toHaveBeenCalledWith(input.cards[0]);
  expect(screen.getByTestId('board-table').props.horizontal).toBeFalsy();
});

test('authoritative empty preview differs from an unavailable preview and unknown Column', async () => {
  const input = props();
  input.columns = [];
  input.previews.set(input.cards[0].id, {
    ...preview(input.cards[0].id),
    checklist: { checkedItems: 0, totalItems: 0 },
  });
  await render(<BoardTable {...input} />);
  expect(screen.getByText('Column: Details unavailable')).toBeTruthy();
  expect(screen.getByText('No labels')).toBeTruthy();
  expect(screen.getByText('No checklist items')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('restores Table offset after a remount and clamps it only when the final layout settles', async () => {
  const input = props();
  input.scroll.y = 900;
  const rendered = jest.spyOn(FlatList.prototype, 'render');
  const scrollTo = jest
    .spyOn(FlatList.prototype, 'scrollToOffset')
    .mockImplementation(() => {});
  const mounted = await render(
    <BoardTable {...input} complete={false} loading />,
  );
  try {
    const list = rendered.mock.contexts.find(
      (item) => item.props.testID === 'board-table',
    );
    await act(() => {
      list.props.onLayout({ nativeEvent: { layout: { height: 240 } } });
      list.props.onContentSizeChange(320, 400);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    await act(() => list.props.onContentSizeChange(320, 1400));
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ offset: 900, animated: false }),
    );
    await act(() => list.props.onScrollBeginDrag());
    await act(() =>
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 500 } } }),
    );
    expect(input.scroll.y).toBe(500);
  } finally {
    await mounted.unmount();
    rendered.mockRestore();
    scrollTo.mockRestore();
  }
});

test('one Table clock updates the due boundary, pauses in background and removes its listener', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
  const input = props();
  input.cards[0].dueDate = '2026-11-16T10:00:01.000Z';
  input.preferences = { timeZone: 'Asia/Bangkok', dateFormat: 'YYYY-MM-DD' };
  const boundary = jest.fn();
  const remove = jest.fn();
  let onState;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_, callback) => {
      onState = callback;
      return { remove };
    });
  const mounted = await render(
    <BoardTable
      {...input}
      dueStatus="DUE_TODAY"
      fetchedAt={Date.now()}
      onDueBoundary={boundary}
    />,
  );
  try {
    await act(() => onState('active'));
    expect(screen.getByText('Due today')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1002));
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(boundary).toHaveBeenCalledTimes(1);
    // The refreshed result is current again: minute ticks stay local.
    await mounted.rerender(
      <BoardTable
        {...input}
        dueStatus="DUE_TODAY"
        fetchedAt={Date.now()}
        onDueBoundary={boundary}
      />,
    );
    await act(() => jest.advanceTimersByTime(600_000));
    expect(boundary).toHaveBeenCalledTimes(1);
    await act(() => onState('background'));
    await act(() => jest.advanceTimersByTime(120000));
    expect(boundary).toHaveBeenCalledTimes(1);
  } finally {
    await mounted.unmount();
    expect(remove).toHaveBeenCalled();
    listener.mockRestore();
    jest.useRealTimers();
  }
});
