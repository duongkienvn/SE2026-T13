/* global jest, test, expect */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SearchSections } from '../src/features/search/SearchSections';
import { scrollList } from './virtual-list';
import { ThemeContext } from '../src/ui';
import { results, cardHit } from './search/fixtures';

test('group sections expose true totals, View all, and guest-safe plain text rows', async () => {
  const value = results();
  value.groups.cards.total = 17;
  value.groups.cards.hasMore = true;
  const open = jest.fn();
  const viewAll = jest.fn();
  await render(
    <ThemeContext.Provider value="dark">
      <SearchSections
        pages={[value]}
        type="all"
        open={open}
        viewAll={viewAll}
        disabled={false}
      />
    </ThemeContext.Provider>,
  );
  expect(screen.getByRole('header', { name: 'Cards · 17' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View all Cards' }));
  expect(viewAll).toHaveBeenCalledWith('cards');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open Design card, Design board' }),
  );
  expect(open).toHaveBeenCalledWith(cardHit);
  expect(
    screen.getByRole('button', { name: 'Open Design card, Design board' }).props
      .accessibilityHint,
  ).toBe('A plain snippet');
  expect(screen.queryByText(/Guest workspace|Unknown workspace/)).toBeNull();
  expect(screen.queryByText(/labels|due date/)).toBeNull();
});
test('specific type renders long Unicode text and 50 ordered rows without All shortcuts', async () => {
  const value = results('cards');
  value.groups.cards.items = Array.from({ length: 50 }, (_, i) => ({
    ...cardHit,
    id: String(i),
    title: `カード 😀 ${i}`,
    subtitle: '<b>literal</b> _% \\',
  }));
  value.groups.cards.total = 50;
  const open = jest.fn();
  await render(
    <SearchSections
      pages={[value]}
      type="cards"
      open={open}
      viewAll={jest.fn()}
      disabled
    />,
  );
  // 50 retained rows, about one page mounted, in server order (P01).
  const labels = () =>
    screen.getAllByRole('button').map((row) => row.props.accessibilityLabel);
  const order = (label) => Number(/ (\d+),/.exec(label)[1]);
  const first = labels();
  expect(first.length).toBeLessThanOrEqual(20);
  expect(first.map(order)).toEqual(first.map((_, i) => i));
  await scrollList('search-scroll');
  await screen.findByRole('button', {
    name: 'Open カード 😀 49, Design board',
  });
  const later = labels()
    .map(order)
    .filter((n) => n >= first.length);
  expect(later).toEqual(later.map((_, i) => 50 - later.length + i));
  expect(screen.getAllByText(/^<b>literal<\/b>/)).toHaveLength(labels().length);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Open カード 😀 49, Design board' }),
  );
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /View all/ })).toBeNull();
  expect(screen.queryByRole('header', { name: /Workspaces/ })).toBeNull();
});
