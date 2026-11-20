/* global jest, test, expect */
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  NotificationRow,
  notificationLabels,
} from '../src/features/notifications/NotificationRow';
import { ThemeContext } from '../src/ui';
import { notification } from './notifications/fixtures';
const preferences = { timeZone: 'UTC', dateFormat: 'YYYY-MM-DD' };
let mockMetrics = { width: 390, height: 844, fontScale: 1, scale: 3 };
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  return Object.create(Object.getPrototypeOf(native), {
    ...Object.getOwnPropertyDescriptors(native),
    useWindowDimensions: { value: () => mockMetrics },
  });
});
test.each([320, 390, 768])(
  'long native rows retain accessible actions at width %s and large font scale',
  async (width) => {
    mockMetrics = { ...mockMetrics, width, fontScale: 2 };
    const item = notification(1, { summary: '長い通知 😀 '.repeat(60) });
    const mark = jest.fn();
    await render(
      <NotificationRow
        item={item}
        preferences={preferences}
        onOpen={jest.fn()}
        onRead={mark}
        disabled={false}
      />,
    );
    expect(screen.getByText(item.summary)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Mark as read: ' + item.summary }),
    );
    expect(mark).toHaveBeenCalledWith(item);
    mockMetrics = { ...mockMetrics, fontScale: 1 };
  },
);
test('an actionable row exposes the exact absolute server instant to screen readers', async () => {
  const item = notification(1, { createdAt: '2026-11-19T01:00:12.345Z' });
  await render(
    <NotificationRow
      item={item}
      preferences={preferences}
      onOpen={jest.fn()}
      onRead={jest.fn()}
      disabled={false}
    />,
  );
  expect(
    screen.getByRole('button', { name: /Open notification:/ }).props
      .accessibilityLabel,
  ).toContain(item.createdAt);
});
test.each(['light', 'dark'])(
  'all six native kinds and plain Unicode summaries are accessible in %s',
  async (theme) => {
    const open = jest.fn(),
      mark = jest.fn();
    await render(
      <ThemeContext.Provider value={theme}>
        {Object.entries(notificationLabels).map(([kind], index) => (
          <NotificationRow
            key={kind}
            item={notification(index + 1, {
              kind,
              summary: 'カード 😀 <b>literal</b>',
            })}
            preferences={preferences}
            onOpen={open}
            onRead={mark}
            disabled={false}
          />
        ))}
      </ThemeContext.Provider>,
    );
    for (const label of Object.values(notificationLabels))
      expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText('カード 😀 <b>literal</b>')).toHaveLength(6);
    await fireEvent.press(
      screen.getAllByRole('button', { name: /Open notification:/ })[0],
    );
    expect(open).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getAllByRole('button', { name: /Mark as read:/ })[0],
    );
    expect(mark).toHaveBeenCalledTimes(1);
  },
);
test('unavailable/null targets never navigate and unavailable rows hide leaked actor/context', async () => {
  const open = jest.fn(),
    mark = jest.fn();
  await render(
    <>
      <NotificationRow
        item={notification(1, { isUnavailable: true })}
        preferences={preferences}
        onOpen={open}
        onRead={mark}
        disabled={false}
      />
      <NotificationRow
        item={notification(2, { actor: null, target: null })}
        preferences={preferences}
        onOpen={open}
        onRead={mark}
        disabled={false}
      />
    </>,
  );
  expect(screen.getByText('No longer available')).toBeTruthy();
  expect(screen.queryByText('Teammate')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Open notification:/ }),
  ).toBeNull();
  expect(screen.getAllByRole('button', { name: /Mark as read:/ })).toHaveLength(
    2,
  );
});
