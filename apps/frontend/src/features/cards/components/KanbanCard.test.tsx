import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { makeCard, makeMember } from '../../../test/board-fixtures';
import { formatCardPreviewDate } from '../card-dates';
import { PreviewContext } from './preview-context';
import { KanbanCard } from './KanbanCard';

it('renders authorized preview metadata together without inventing Card completion', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const member = makeMember().user;
  const card = makeCard({
    title: 'Implement board filter',
    startDate: '2026-11-04T09:00:00Z',
    dueDate: '2026-11-19T10:00:00Z',
    assignees: [{ userId: member.id, assignedById: null, createdAt: '' }],
  });
  const open = vi.fn();
  render(
    <PreviewContext.Provider
      value={{
        summaries: new Map([
          [
            card.id,
            {
              cardId: card.id,
              labelIds: ['label'],
              checklist: { checkedItems: 3, totalItems: 3 },
              attachmentCount: 2,
              commentCount: 4,
            },
          ],
        ]),
        labels: [
          {
            id: 'label',
            boardId: card.boardId,
            name: 'Feature',
            color: '#615CF7',
            createdAt: '',
            updatedAt: '',
          },
        ],
        timeZone: 'Asia/Bangkok',
        dateFormat: 'DD/MM/YYYY',
        now,
      }}
    >
      <KanbanCard
        card={card}
        members={new Map([[member.id, member]])}
        onOpen={open}
        dragHandle={<button aria-label="Drag card">Drag</button>}
      />
    </PreviewContext.Provider>,
  );
  expect(screen.getByText('Upcoming')).toBeTruthy();
  expect(
    screen.getByRole('group', { name: /Starts .*Due .*Asia\/Bangkok/ }),
  ).toBeTruthy();
  expect(screen.queryByText('Done')).toBeNull();
  expect(screen.getByText('4 Nov')).toBeTruthy();
  expect(screen.getByText('19 Nov').getAttribute('title')).toContain(
    '19/11/2026 17:00',
  );
  expect(
    screen
      .getByRole('progressbar', { name: 'Checklist progress' })
      .getAttribute('aria-valuenow'),
  ).toBe('3');
  const footer = screen.getByRole('progressbar').closest('footer')!;
  expect(footer.textContent).toContain('Attachments 2');
  expect(footer.textContent).toContain('Comments 4');
  expect(footer.querySelector('ul')?.getAttribute('aria-label')).toContain(
    member.displayName,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Drag card' }));
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: card.title }));
  expect(open).toHaveBeenCalledWith(card);
});

it('keeps cards without dates, summaries or assignees minimal', () => {
  const { container } = render(
    <KanbanCard card={makeCard({ description: null })} members={new Map()} />,
  );
  expect(container.querySelector('footer')).toBeNull();
  expect(container.querySelector('time')).toBeNull();
});

it('formats compact preview dates in the saved zone and day/month order', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const instant = '2026-11-19T01:00:00Z';
  expect(
    formatCardPreviewDate(instant, 'MM/DD/YYYY', 'America/Los_Angeles', now),
  ).toBe('Nov 18');
  expect(
    formatCardPreviewDate(instant, 'DD/MM/YYYY', 'Asia/Bangkok', now),
  ).toBe('19 Nov');
  expect(
    formatCardPreviewDate('2027-01-01T00:00:00Z', 'YYYY-MM-DD', 'UTC', now),
  ).toBe('Jan 1, 2027');
});
