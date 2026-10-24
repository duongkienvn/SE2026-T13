import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders header slots and page content', () => {
    render(
      <AppShell
        headerContext={<span>Sprint board</span>}
        headerActions={<button type="button">Account</button>}
      >
        <p>Page body</p>
      </AppShell>,
    );

    const header = screen.getByRole('banner');
    expect(within(header).getByText('Kanvexa')).toBeTruthy();
    expect(within(header).queryByText('Kanban')).toBeNull();
    // Check the DOM too: a decorative duplicate has alt="" and is excluded
    // from accessible image queries.
    expect(header.querySelector('img')).toBeNull();
    const logo = within(
      screen.getByRole('navigation', { name: 'Primary' }),
    ).getByRole('img', { name: 'Kanvexa' });
    expect(logo.getAttribute('src')).toBe('/branding/kanvexa-logo-v1.png');
    expect(within(header).getByText('Sprint board')).toBeTruthy();
    expect(
      within(header).getByRole('button', { name: 'Account' }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('main')).getByText('Page body'),
    ).toBeTruthy();
  });

  it('highlights the active navigation item', () => {
    render(
      <AppShell activeNavItemId="boards">
        <p>Page body</p>
      </AppShell>,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getByRole('button', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('offers a skip link to the main content', () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('main').id).toBe('main-content');
  });
});
