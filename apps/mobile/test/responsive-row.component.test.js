/* global jest, test, expect */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, ListRow } from '../src/ui';

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => ({ width: 320, height: 700, scale: 3, fontScale: 1.6 }),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

function findLayout(node) {
  if (typeof node !== 'object' || node === null) return undefined;
  if (typeof node.props?.onLayout === 'function') return node;
  return node.children.map(findLayout).find(Boolean);
}

test('row stacks the secondary action when available width is small for the font size', async () => {
  const open = jest.fn();
  const more = jest.fn();
  const { container } = await render(
    <ListRow
      title="A long localized title"
      onPress={open}
      trailing={<Button label="More" variant="secondary" onPress={more} />}
    />,
  );
  const row = findLayout(container);
  await fireEvent(row, 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 80 } },
  });
  expect(
    StyleSheet.flatten(findLayout(container).props.style).flexDirection,
  ).toBe('row');
  await fireEvent(findLayout(container), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 288, height: 80 } },
  });
  expect(
    StyleSheet.flatten(findLayout(container).props.style).flexDirection,
  ).toBe('column');
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});
