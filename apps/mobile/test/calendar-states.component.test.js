/* global jest, test, expect */
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CalendarAgendaCard } from '../src/features/calendar/CalendarAgenda';
import { ThemeContext, palettes } from '../src/ui';
import { StyleSheet } from 'react-native';
import { card } from './workspaces/kanban-fixtures';

test.each(['light', 'dark'])(
  'agenda %s: long text, authorized metadata only, due label and focus',
  async (theme) => {
    const title = 'A long authorized Card title '.repeat(8);
    const onOpen = jest.fn();
    const value = {
      ...card(1),
      title,
      dueDate: '2026-11-17T09:00:00.000Z',
      assignees: [{ userId: 'private-id' }],
    };
    await render(
      <ThemeContext.Provider value={theme}>
        <CalendarAgendaCard
          card={value}
          boardName="Board"
          column="Column"
          preferences={{ timeZone: 'UTC', dateFormat: 'YYYY-MM-DD' }}
          now={Date.parse('2026-11-17T00:00Z')}
          labels={[]}
          members={[]}
          onOpen={onOpen}
        />
      </ThemeContext.Provider>,
    );
    expect(screen.getByText(title).props.numberOfLines).toBeUndefined();
    expect(screen.queryByText(/private-id/)).toBeNull();
    expect(screen.queryByText(/Assigned to/)).toBeNull();
    expect(screen.getByText('2026-11-17 · 09:00')).toBeTruthy();
    const row = screen.getByRole('button', { name: `Open card: ${title}` });
    expect(StyleSheet.flatten(row.props.style).minHeight).toBe(48);
    expect(StyleSheet.flatten(row.props.style).backgroundColor).toBe(
      palettes[theme].surface,
    );
    await fireEvent(row, 'focus');
    expect(
      StyleSheet.flatten(
        screen.getByRole('button', { name: `Open card: ${title}` }).props.style,
      ).borderColor,
    ).toBe(palettes[theme].focus);
    await fireEvent.press(row);
    expect(onOpen).toHaveBeenCalledWith(value);
  },
);
