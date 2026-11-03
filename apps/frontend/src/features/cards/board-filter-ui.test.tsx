import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardFilter } from './board-filter';

const labelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('Board filter draft', () => {
  it('replaces the empty hint with applied facets and clears them', () => {
    const props = {
      apply: vi.fn(),
      labels: [],
      members: [],
      labelsPending: false,
      labelsError: false,
      membersPending: false,
      membersError: false,
      retryLabels: vi.fn(),
      retryMembers: vi.fn(),
    };
    const { rerender } = render(<BoardFilter {...props} filters={{}} />);
    const toolbar = within(
      screen.getByRole('group', { name: 'Board filters' }),
    );
    expect(toolbar.getByText('No filters applied')).toBeTruthy();
    expect(toolbar.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    rerender(
      <BoardFilter
        {...props}
        filters={{ q: 'release', dueStatus: 'UPCOMING' }}
      />,
    );
    expect(toolbar.queryByText('No filters applied')).toBeNull();
    expect(toolbar.getByRole('button', { name: 'Filter (2)' })).toBeTruthy();
    expect(toolbar.getByText('Keyword: release')).toBeTruthy();
    expect(toolbar.getByText('UPCOMING')).toBeTruthy();
    fireEvent.click(toolbar.getByRole('button', { name: 'Clear filters' }));
    expect(props.apply).toHaveBeenCalledWith({});
    rerender(<BoardFilter {...props} filters={{}} />);
    expect(toolbar.getByText('No filters applied')).toBeTruthy();
  });

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
    fireEvent.click(screen.getByText('Labels', { exact: true }));
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
