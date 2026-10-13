import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FolderIcon, SettingsIcon } from '../../components/icons';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

describe('Sidebar', () => {
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
