/* global test, expect */
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { VirtualSections } from '../src/ui/sections';
import { scrollList } from './virtual-list';

test('P01: 1,000 retained rows mount about one page, keep order/keys, and later rows mount on scroll', async () => {
  const data = Array.from({ length: 1000 }, (_, i) => 'Row ' + i);
  await render(
    <VirtualSections
      testID="list"
      sections={[
        { key: 'first', header: <Text>First</Text>, data: data.slice(0, 500) },
        {
          key: 'second',
          header: <Text>Second</Text>,
          data: data.slice(500),
          footer: <Text>Second footer</Text>,
        },
      ]}
      keyExtractor={(row) => row}
      renderItem={(row) => <Text>{row}</Text>}
      header={<Text>Screen header</Text>}
      footer={<Text>1000 loaded</Text>}
    />,
  );
  expect(screen.getByText('Screen header')).toBeTruthy();
  expect(screen.getByText('First')).toBeTruthy();
  const initial = screen
    .queryAllByText(/^Row /)
    .map((node) => node.props.children);
  expect(initial).toEqual(data.slice(0, initial.length));
  expect(initial.length).toBeLessThanOrEqual(20);
  await scrollList('list', 1000 * 50, 50);
  await screen.findByText('Row 999');
  expect(screen.getByText('Second footer')).toBeTruthy();
  expect(screen.getByText('1000 loaded')).toBeTruthy();
  const mounted = screen
    .queryAllByText(/^Row /)
    .map((node) => node.props.children);
  expect(mounted.length).toBeLessThan(100);
  // RN keeps the initial rows for scroll-to-top; the rest is one contiguous,
  // ordered window ending at the last retained row.
  const tail = mounted.filter((row) => Number(row.slice(4)) >= initial.length);
  expect(tail).toEqual(data.slice(1000 - tail.length));
});
