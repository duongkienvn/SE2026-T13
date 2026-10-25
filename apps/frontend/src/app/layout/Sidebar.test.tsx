import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderIcon, SettingsIcon } from '../../components/icons';
import { Sidebar } from './Sidebar';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

function renderSidebar() {
  return render(
    <Sidebar
      primaryItems={[{ id: 'boards', label: 'Boards', icon: FolderIcon }]}
      secondaryItems={[]}
    />,
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
    expect(
      (
        screen.getByRole('button', {
          name: 'Expand sidebar',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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

  it('shows labels on desktop and toggles the labelled rail', () => {
    render(
      <Sidebar
        primaryItems={[{ id: 'boards', label: 'Boards', icon: FolderIcon }]}
        secondaryItems={[]}
        activeItemId="boards"
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById(toggle.getAttribute('aria-controls')!),
    ).toBeTruthy();
    expect(screen.getByText('Boards')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Boards')).toBeNull();
    expect(screen.getByRole('button', { name: 'Boards' }).title).toBe('Boards');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByText('Boards')).toBeTruthy();
    expect(screen.getByRole('navigation').querySelectorAll('ul')).toHaveLength(
      1,
    );
  });

  it('never marks the current page as coming soon', () => {
    render(
      <Sidebar
        primaryItems={[{ id: 'boards', label: 'Boards', icon: FolderIcon }]}
        secondaryItems={[]}
        activeItemId="boards"
      />,
    );

    const boards = screen.getByRole('button', { name: 'Boards' });
    expect(boards.getAttribute('aria-current')).toBe('page');
    expect(boards.getAttribute('aria-disabled')).toBeNull();
  });

  it('enables items with a handler and highlights the active item', () => {
    const onSelect = vi.fn();
    render(
      <Sidebar
        primaryItems={[
          { id: 'boards', label: 'Boards', icon: FolderIcon, onSelect },
        ]}
        secondaryItems={[
          { id: 'settings', label: 'Settings', icon: SettingsIcon },
        ]}
        activeItemId="boards"
      />,
    );

    const boards = screen.getByRole('button', { name: 'Boards' });
    expect(boards.getAttribute('aria-current')).toBe('page');
    expect(boards.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(boards);
    expect(onSelect).toHaveBeenCalledOnce();

    const settings = screen.getByRole('button', {
      name: 'Settings (coming soon)',
    });
    expect(settings.getAttribute('aria-disabled')).toBe('true');
  });
});
