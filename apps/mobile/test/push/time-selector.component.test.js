/* global jest, test, expect, afterEach */
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TimeSelector } from '../../src/features/push/schedule/TimeSelector';
import { ThemeContext } from '../../src/ui';
let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
const mockOpen = jest.fn(),
  mockDismiss = jest.fn(async () => {});
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: {
    open: (...args) => mockOpen(...args),
    dismiss: (...args) => mockDismiss(...args),
  },
}));
afterEach(() => {
  jest.restoreAllMocks();
  mockOpen.mockClear();
  mockDismiss.mockClear();
  mockFocused = true;
});
test('Android blur dismisses a mounted picker and ignores late native callbacks', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onChange = jest.fn();
  const tree = () => (
    <TimeSelector
      label="Start time"
      value="22:00"
      disabled={false}
      onChange={onChange}
    />
  );
  const view = await render(tree());
  try {
    await fireEvent.press(
      screen.getByRole('button', { name: 'Start time, 22:00' }),
    );
    const options = mockOpen.mock.calls[0][0];
    mockFocused = false;
    await view.rerender(tree());
    expect(mockDismiss).toHaveBeenCalledWith('time');
    await act(() =>
      options.onValueChange({}, new Date('2000-01-01T23:45:00Z')),
    );
    await act(() => options.onError());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Choose start time')).toBeNull();
    mockFocused = true;
    await view.rerender(tree());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Start time, 22:00' }),
    );
    expect(mockOpen).toHaveBeenCalledTimes(2);
  } finally {
    await view.unmount();
  }
});
test('Android uses UTC digit carrier, native quarter-hour spinner, fences delayed callbacks, cleans up on unmount', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onChange = jest.fn();
  const tree = (disabled) => (
    <ThemeContext.Provider value="dark">
      <TimeSelector
        label="Start time"
        value="22:00"
        disabled={disabled}
        onChange={onChange}
      />
    </ThemeContext.Provider>
  );
  const view = await render(tree(false));
  try {
    await fireEvent.press(
      screen.getByRole('button', { name: 'Start time, 22:00' }),
    );
    const options = mockOpen.mock.calls[0][0];
    expect(options).toMatchObject({
      mode: 'time',
      display: 'spinner',
      minuteInterval: 15,
      timeZoneName: 'UTC',
      is24Hour: true,
    });
    expect(options.value.toISOString()).toBe('2000-01-01T22:00:00.000Z');
    await act(() =>
      options.onValueChange({}, new Date('2000-01-01T23:45:00Z')),
    );
    expect(onChange).toHaveBeenCalledWith('23:45');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Start time, 22:00' }),
    );
    const late = mockOpen.mock.calls[1][0];
    await view.rerender(tree(true));
    expect(mockDismiss).toHaveBeenCalledWith('time');
    await act(() => late.onValueChange({}, new Date('2000-01-01T08:00:00Z')));
    expect(onChange).toHaveBeenCalledTimes(1);
  } finally {
    await view.unmount();
  }
});
test('unsupported native minute interval fails safely into exact 96-choice fallback, no rounding', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const onChange = jest.fn();
  const view = await render(
    <TimeSelector
      label="End time"
      value="07:00"
      disabled={false}
      onChange={onChange}
    />,
  );
  try {
    await fireEvent.press(
      screen.getByRole('button', { name: 'End time, 07:00' }),
    );
    await act(() =>
      mockOpen.mock.calls[0][0].onValueChange(
        {},
        new Date('2000-01-01T08:07:00Z'),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'End time 08:15' }),
    );
    expect(onChange).toHaveBeenCalledWith('08:15');
  } finally {
    await view.unmount();
  }
});
