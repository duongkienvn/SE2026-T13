import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FolderIcon, SettingsIcon } from '../../components/icons';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
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
