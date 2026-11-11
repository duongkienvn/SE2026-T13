/* global jest, test, expect */
import React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Button, ProgressBar, ThemeContext, palettes } from '../src/ui';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useColorScheme = {
    configurable: true,
    enumerable: true,
    value: jest.fn(),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

test('components follow system theme changes and respect explicit overrides', async () => {
  const component = (mode) => (
    <ThemeContext.Provider value={mode}>
      <Button label="Continue" onPress={() => {}} />
      <ProgressBar label="Progress" value={50} />
    </ThemeContext.Provider>
  );
  const background = () =>
    StyleSheet.flatten(
      screen.getByRole('button', { name: 'Continue' }).props.style,
    ).backgroundColor;

  useColorScheme.mockReturnValue('light');
  const { rerender } = await render(component('system'));
  expect(background()).toBe(palettes.light.primary);
  expect(
    StyleSheet.flatten(screen.getByRole('progressbar').props.style)
      .backgroundColor,
  ).toBe(palettes.light.progressTrack);
  expect(
    StyleSheet.flatten(screen.getByRole('progressbar').children[0].props.style)
      .backgroundImage[0].colorStops,
  ).toEqual([
    { color: palettes.light.primary },
    { color: palettes.light.progressEnd },
  ]);
  useColorScheme.mockReturnValue('dark');
  await rerender(component('system'));
  expect(background()).toBe(palettes.dark.primary);
  expect(
    StyleSheet.flatten(screen.getByRole('progressbar').props.style)
      .backgroundColor,
  ).toBe(palettes.dark.progressTrack);
  expect(
    StyleSheet.flatten(screen.getByRole('progressbar').children[0].props.style)
      .backgroundImage[0].colorStops,
  ).toEqual([
    { color: palettes.dark.primary },
    { color: palettes.dark.progressEnd },
  ]);
  await rerender(component('light'));
  expect(background()).toBe(palettes.light.primary);
  useColorScheme.mockReturnValue('light');
  await rerender(component('dark'));
  expect(background()).toBe(palettes.dark.primary);
});
