import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderIcon, StarIcon } from '../../components/icons';
import type { NavGroup } from './navigation';
import { Sidebar } from './Sidebar';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

const groups: NavGroup[] = [
  {
    id: 'personal',
    label: 'Personal',
    items: [
      {
        id: 'boards',
        label: 'Boards',
        icon: FolderIcon,
        availability: 'available',
        path: '/boards',
      },
      { id: 'starred', label: 'Starred', icon: StarIcon, availability: 'soon' },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    emptyText: 'Workspaces are coming soon.',
    items: [],
  },
];

function renderSidebar(activeItemId?: string) {
  return render(
    <MemoryRouter>
      <Sidebar groups={groups} activeItemId={activeItemId} />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('restores the desktop preference after remounting', () => {
    const first = renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('kanvexa.sidebar.expanded')).toBe('false');
    first.unmount();
    renderSidebar();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it('keeps the desktop preference across responsive changes', () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_event: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        listeners.delete(listener),
    }));
    renderSidebar();
    const resize = (wide: boolean) =>
      act(() => {
        matches = wide;
        listeners.forEach((listener) => listener());
      });
    resize(false);
    // Tablet rails stay compact; the header menu opens the drawer instead.
    expect(screen.queryByRole('button', { name: /sidebar/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Boards' }).title).toBe('Boards');
    expect(localStorage.getItem('kanvexa.sidebar.expanded')).toBeNull();
    resize(true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    resize(false);
    resize(true);
    expect(
      screen
        .getByRole('button', { name: 'Expand sidebar' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    resize(false);
    resize(true);
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeTruthy();
  });

  it('falls back safely when storage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeTruthy();
  });

  it('renders labelled groups with the empty workspace state', () => {
    renderSidebar();
    expect(screen.getByRole('group', { name: 'Personal' })).toBeTruthy();
    const workspaces = screen.getByRole('group', { name: 'Workspaces' });
    expect(
      within(workspaces).getByText('Workspaces are coming soon.'),
    ).toBeTruthy();
  });

  it('renders available items as links with route-aware active state', () => {
    renderSidebar('boards');
    const boards = screen.getByRole('link', { name: 'Boards' });
    expect(boards.getAttribute('href')).toBe('/boards');
    expect(boards.getAttribute('aria-current')).toBe('page');
  });

  it('renders coming-soon items as unfocusable status text, never as controls', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: /Starred/ })).toBeNull();
    expect(within(nav).queryByRole('button', { name: /Starred/ })).toBeNull();
    const starred = within(nav).getByText('Starred').closest('li')!;
    expect(starred.textContent).toContain('Soon');
    expect(starred.textContent).toContain('coming soon');
    expect(starred.querySelector('a, button, [tabindex]')).toBeNull();
    expect(starred.title).toBe('Starred — coming soon');
  });

  it('reserves the workspace switcher slot without inventing a workspace or plan', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const slot = within(nav)
      .getByText('Coming soon')
      .closest<HTMLElement>('[title]')!;
    expect(slot.title).toBe('Workspace switcher — coming soon');
    expect(slot.querySelector('a, button, [tabindex]')).toBeNull();
    expect(nav.textContent).not.toMatch(/free plan|pro|upgrade|pricing/i);
  });

  it('keeps accessible names for icon-only items when collapsed', () => {
    renderSidebar('boards');
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById(toggle.getAttribute('aria-controls')!),
    ).toBeTruthy();
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(toggle.closest('a')).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Kanvexa landing page' })
        .getAttribute('href'),
    ).toBe('/');
    const boards = screen.getByRole('link', { name: 'Boards' });
    expect(boards.title).toBe('Boards');
    expect(boards.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Starred, coming soon')).toBeTruthy();
    expect(screen.queryByText('Workspaces are coming soon.')).toBeNull();
    expect(screen.getByRole('group', { name: 'Workspaces' })).toBeTruthy();
  });
});
