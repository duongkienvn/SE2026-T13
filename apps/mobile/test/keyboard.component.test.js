/* global jest, test, expect */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { BottomSheet, Button } from '../src/ui';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.KeyboardAvoidingView = {
    configurable: true,
    enumerable: true,
    value: ({ children, ...props }) =>
      React.createElement(
        native.View,
        { ...props, testID: 'keyboard-container' },
        children,
      ),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

test('sheet gives keyboard avoidance the full modal and keeps actions reachable', async () => {
  const close = jest.fn();
  await render(
    <BottomSheet visible title="Example" onDismiss={close}>
      <Button label="Save" onPress={close} />
    </BottomSheet>,
  );
  const container = screen.getByTestId('keyboard-container');
  expect(container.props.behavior).toBe(
    Platform.OS === 'ios' ? 'padding' : 'height',
  );
  expect(StyleSheet.flatten(container.props.style).flex).toBe(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(close).toHaveBeenCalledTimes(1);
});
