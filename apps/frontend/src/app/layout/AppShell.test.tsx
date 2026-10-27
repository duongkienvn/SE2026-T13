import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

const renderInRouter = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AppShell', () => {
  it('renders header slots and page content', () => {
    renderInRouter(
      <AppShell
        headerContext={<span>Sprint board</span>}
        headerActions={<button type="button">Account</button>}
      >
        <p>Page body</p>
      </AppShell>,
    );

    const header = screen.getByRole('banner');
    // The brand lives once, in the sidebar; the header carries page context.
    expect(within(header).queryByText(/Kanvexa|Kanban/)).toBeNull();
    // Only phones (no rail) show the logo in the header.
    const headerLogos = header.querySelectorAll('img');
    expect(headerLogos).toHaveLength(1);
    expect(headerLogos[0].parentElement?.className).toContain('md:hidden');
    const logo = within(screen.getByRole('navigation', { name: 'Primary' }))
      .getByRole('link', { name: 'Kanvexa landing page' })
      .querySelector('img')!;
    expect(logo.getAttribute('src')).toBe('/branding/kanvexa-logo-v1.png');
    expect(within(header).getByText('Sprint board')).toBeTruthy();
    expect(
      within(header).getByRole('button', { name: 'Account' }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('main')).getByText('Page body'),
    ).toBeTruthy();
  });

  it('reserves Search and Notifications slots without fake behavior', () => {
    renderInRouter(
      <AppShell headerActions={<button type="button">Account</button>}>
        <p>Page body</p>
      </AppShell>,
    );

    const header = screen.getByRole('banner');
    expect(within(header).getByText('Search, coming soon')).toBeTruthy();
    expect(within(header).getByText('Notifications, coming soon')).toBeTruthy();
    expect(within(header).queryByRole('searchbox')).toBeNull();
    expect(within(header).queryByRole('textbox')).toBeNull();
    expect(
      within(header)
        .getByRole('link', { name: 'Kanvexa landing page' })
        .getAttribute('href'),
    ).toBe('/');
    // Only the drawer opener and the real account action are interactive;
    // no unread count or shortcut.
    expect(
      within(header)
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
    ).toEqual(['Open navigation', 'Account']);
    expect(header.querySelector('[tabindex], input, kbd')).toBeNull();
    expect(header.textContent).not.toMatch(/\d|ctrl|⌘/i);
  });

  it('highlights the active navigation item', () => {
    renderInRouter(
      <AppShell activeNavItemId="boards">
        <p>Page body</p>
      </AppShell>,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getByRole('link', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('offers a skip link to the main content', () => {
    renderInRouter(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('main').id).toBe('main-content');
  });
});
