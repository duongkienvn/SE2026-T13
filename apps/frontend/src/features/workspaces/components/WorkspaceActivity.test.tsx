import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceActivity } from './WorkspaceActivity';
import { useWorkspaceActivity } from '../hooks';

vi.mock('../hooks', () => ({ useWorkspaceActivity: vi.fn() }));
const mocked = vi.mocked(useWorkspaceActivity);
const types = [
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'POLICY_UPDATED',
  'MEMBER_JOINED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'INVITATION_REQUESTED',
  'INVITATION_REVOKED',
  'INVITATION_DECLINED',
  'BOARD_MOVED',
  'UNRECOGNIZED',
];
const rows = types.map((eventType, i) => ({
  id: String(i),
  eventType,
  createdAt: '2026-01-01T12:00:00.000Z',
  actor:
    i === 0
      ? null
      : { id: 'u', displayName: 'A long member name', avatarUrl: null },
  board: i === 10 ? { id: 'allowed', name: 'Allowed board' } : null,
}));
const refetch = vi.fn();
function page(items = rows, total = items.length, totalPages = 1) {
  return { items, meta: { page: 1, limit: 20, total, totalPages } };
}
function mount() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/w']}>
      <Routes>
        <Route
          path="/workspaces/:workspaceId"
          element={<WorkspaceActivity state="ready" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  mocked.mockImplementation(
    (_id, _page, limit) =>
      ({
        pageData: limit === 5 ? page(rows.slice(0, 5), 12, 3) : page(),
        isError: false,
        refetch,
      }) as never,
  );
});
describe('Workspace activity', () => {
  it('renders the server summary and accessible history without exposing unknown payloads', () => {
    mount();
    expect(screen.getByText('Unknown user')).toBeTruthy();
    expect(screen.queryByText('Allowed board')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    const dialog = screen.getByRole('dialog', { name: 'Workspace activity' });
    expect(within(dialog).getByText('Allowed board').getAttribute('href')).toBe(
      '/boards/allowed',
    );
    expect(
      within(dialog).getByText(/performed a workspace action/),
    ).toBeTruthy();
    for (const label of [
      'created the workspace',
      'updated the workspace',
      'updated workspace policies',
      'joined the workspace',
      'changed a member role',
      'removed a member',
      'left the workspace',
      'requested an invitation',
      'revoked an invitation',
      'declined an invitation',
      'moved a board into the workspace',
    ]) {
      expect(within(dialog).getByText(new RegExp(label))).toBeTruthy();
    }
    expect(within(dialog).queryByText('UNRECOGNIZED')).toBeNull();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(12);
    expect(dialog.querySelector('time')?.getAttribute('datetime')).toBe(
      rows[0].createdAt,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('provides an empty state and disables history', () => {
    mocked.mockReturnValue({
      pageData: page([], 0, 0),
      isError: false,
      refetch,
    } as never);
    mount();
    expect(screen.getByText(/Activity will appear/)).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: /view all/i })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
  it('exposes a retry on failure', () => {
    mocked.mockReturnValue({
      pageData: undefined,
      isError: true,
      refetch,
    } as never);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
  it('uses the server total and requests the selected history page', () => {
    mocked.mockImplementation(
      (_id, currentPage, limit) =>
        ({
          pageData:
            limit === 5
              ? page(rows.slice(0, 5), 21, 5)
              : {
                  ...page(rows.slice(0, 1), 21, 2),
                  meta: {
                    page: currentPage,
                    limit: 20,
                    total: 21,
                    totalPages: 2,
                  },
                },
          isError: false,
          refetch,
        }) as never,
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    expect(screen.getByText('21 events')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(mocked).toHaveBeenCalledWith('w', 2, 20, true);
  });
  it('returns to the last page when the server total shrinks', () => {
    mocked.mockImplementation(
      (_id, currentPage, limit) =>
        ({
          pageData:
            limit === 5
              ? page(rows.slice(0, 5), 21, 5)
              : currentPage === 1
                ? page(rows.slice(0, 1), 21, 2)
                : {
                    ...page([], 1, 1),
                    meta: { page: 2, limit: 20, total: 1, totalPages: 1 },
                  },
          isError: false,
          refetch,
        }) as never,
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(mocked).toHaveBeenLastCalledWith('w', 1, 20, true);
  });
});
