/* global jest, test, expect */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BoardFiltersSheet } from '../src/features/boards/BoardFiltersSheet';

// Catalogs are collapsed: the sheet only needs their current read state here.
const catalogs = { labels: {}, members: {}, labelItems: [], memberItems: [] };

test.each([true, false])(
  'inherited NO_DUE_DATE is removed only for Calendar (calendar=%s)',
  async (calendar) => {
    const apply = jest.fn();
    await render(
      <BoardFiltersSheet
        calendar={calendar}
        initial={{ dueStatus: 'NO_DUE_DATE', q: 'release' }}
        startWithLabels={false}
        catalogs={catalogs}
        online
        onCancel={jest.fn()}
        onApply={apply}
      />,
    );
    const count = calendar ? 1 : 2;
    expect(
      screen.getByRole('button', { name: 'Any time' }).props.accessibilityState
        .selected,
    ).toBe(calendar);
    expect(screen.queryByRole('button', { name: 'No due date' }) === null).toBe(
      calendar,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: `Apply filters (${count})` }),
    );
    expect(apply.mock.calls[0][0].dueStatus).toBe(
      calendar ? undefined : 'NO_DUE_DATE',
    );
    expect(apply.mock.calls[0][0].q).toBe('release');
  },
);
