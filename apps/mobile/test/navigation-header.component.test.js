/* global jest, test, expect */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Scaffold } from '../src/navigation/scaffold';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

test.each(['Home', 'My Tasks', 'Boards'])(
  '%s header opens the search route',
  async (title) => {
    mockPush.mockClear();
    await render(<Scaffold title={title} tab />);
    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    expect(mockPush).toHaveBeenCalledWith('/search');
  },
);

test('Inbox uses its settings action instead of a search action', async () => {
  mockPush.mockClear();
  await render(<Scaffold title="Inbox" tab tabAction="settings" />);
  expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  expect(mockPush).toHaveBeenCalledWith('/settings');
});

test('the account fallback opens settings without inventing a user profile', async () => {
  mockPush.mockClear();
  await render(<Scaffold title="Home" tab />);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Account settings' }),
  );
  expect(mockPush).toHaveBeenCalledWith('/settings');
});
