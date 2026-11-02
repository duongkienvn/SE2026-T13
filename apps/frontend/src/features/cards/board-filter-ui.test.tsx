import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardFilter } from './board-filter';

const labelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('Board filter draft', () => {
  it('discards drafts on cancel and applies selected server facets', () => {
    const apply = vi.fn();
    render(
      <BoardFilter
        filters={{ q: 'saved' }}
        apply={apply}
        labels={[
          {
            id: labelId,
            boardId: 'board',
            name: 'Bug',
            color: '#FF0000',
            createdAt: '',
            updatedAt: '',
          },
        ]}
        members={[]}
        labelsPending={false}
        labelsError={false}
        membersPending={false}
        membersError={false}
        retryLabels={() => undefined}
        retryMembers={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter (1)' }));
    fireEvent.change(screen.getByLabelText('Keyword'), {
      target: { value: 'draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Filter (1)' }));
    expect((screen.getByLabelText('Keyword') as HTMLInputElement).value).toBe(
      'saved',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(apply).toHaveBeenCalledWith({ q: 'saved', labelIds: [labelId] });
  });
  it('preserves seconds and milliseconds in an unchanged due bound', () => {
    const apply = vi.fn();
    render(
      <BoardFilter
        filters={{ dueFrom: '2026-05-01T10:15:45.123Z' }}
        apply={apply}
        labels={[]}
        members={[]}
        labelsPending={false}
        labelsError={false}
        membersPending={false}
        membersError={false}
        retryLabels={() => undefined}
        retryMembers={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(apply).toHaveBeenCalledWith({ dueFrom: '2026-05-01T10:15:45.123Z' });
  });
});
