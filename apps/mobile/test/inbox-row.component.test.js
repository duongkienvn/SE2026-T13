/* global jest, test, expect */
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  NotificationRow,
  notificationLabels,
} from '../src/features/notifications/NotificationRow';
import { ThemeContext } from '../src/ui';
import { notification } from './notifications/fixtures';
const preferences = { timeZone: 'UTC', dateFormat: 'YYYY-MM-DD' };
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
