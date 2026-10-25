import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

function sectionsNav() {
  // The desktop nav is the first "Sections" nav; the menu copy is hidden until opened.
  return screen.getAllByRole('navigation', { name: 'Sections' })[0];
}

describe('LandingPage', () => {
  it('shows guests the landing page with sign-up and log-in actions', async () => {
    const calls = mockApi({});
    const { router } = renderApp('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: /Organize work/ }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
    expect(document.title).toBe('Kanvexa · Collaborative Kanban boards');
    expect(calls).toHaveLength(0);

    const header = screen.getByRole('banner');
    expect(
      within(header).getByRole('link', { name: 'Log in' }).getAttribute('href'),
    ).toBe('/login');
    expect(
      within(header)
        .getByRole('link', { name: 'Get Started' })
        .getAttribute('href'),
    ).toBe('/register');
    expect(
      within(header).queryByRole('link', { name: 'Go to Boards' }),
    ).toBeNull();
  });

  it('points the hero actions at sign-up and the features section', () => {
    mockApi({});
    renderApp('/');

    const hero = screen
      .getByRole('heading', { level: 1 })
      .closest('section') as HTMLElement;
    expect(
      within(hero)
        .getByRole('link', { name: 'Get started' })
        .getAttribute('href'),
    ).toBe('/register');
    expect(
      within(hero)
        .getByRole('link', { name: 'Learn more' })
        .getAttribute('href'),
    ).toBe('#features');
    expect(
      within(hero).getByRole('img', { name: /Preview of a Kanvexa board/ }),
    ).toBeTruthy();
  });

  it('sends signed-in users from the hero to their boards', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    renderApp('/');

    const hero = screen
      .getByRole('heading', { level: 1 })
      .closest('section') as HTMLElement;
    expect(
      (
        await within(hero).findByRole('link', { name: 'Go to your boards' })
      ).getAttribute('href'),
    ).toBe('/boards');
    expect(
      within(hero).queryByRole('link', { name: 'Get started' }),
    ).toBeNull();
  });

  it('lists the four features and the three how-it-works steps', () => {
    mockApi({});
    renderApp('/');

    const features = document.getElementById('features')!;
    expect(
      within(features)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Visual boards',
      'Real-time collaboration',
      'Team management',
      'Activity history',
    ]);

    const steps = within(document.getElementById('how-it-works')!);
    expect(steps.getByRole('heading', { level: 2 }).textContent).toBe(
      'How it works',
    );
    expect(
      steps.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      'Step 1: Create a board',
      'Step 2: Organize tasks',
      'Step 3: Collaborate in real time',
    ]);
  });

  it('makes the product showcase the Why Kanvexa section', () => {
    mockApi({});
    renderApp('/');

    const why = within(document.getElementById('why-kanvexa')!);
    expect(why.getByRole('heading', { level: 2 }).textContent).toBe(
      'A better way to manage your work',
    );
    expect(why.getByRole('img', { name: /boards list/ })).toBeTruthy();
    expect(why.getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });

  it('never promises invitations, which Kanvexa does not send', () => {
    mockApi({});
    renderApp('/');

    expect(document.body.textContent).not.toMatch(/invit/i);
  });

  it('links the three header anchors to three distinct sections', () => {
    mockApi({});
    renderApp('/');

    const links = within(sectionsNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Features',
      'How it works',
      'Why Kanvexa',
    ]);
    for (const link of links) {
      const id = link.getAttribute('href')!.slice(1);
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(document.getElementById(id)!.tagName).toBe('SECTION');
    }
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#features',
      '#how-it-works',
      '#why-kanvexa',
    ]);
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });

  it('offers signed-in users their boards instead of sign-up', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    renderApp('/');

    const header = screen.getByRole('banner');
    expect(
      (
        await within(header).findByRole('link', { name: 'Go to Boards' })
      ).getAttribute('href'),
    ).toBe('/boards');
    expect(within(header).queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(
      within(header).queryByRole('link', { name: 'Get Started' }),
    ).toBeNull();
    expect(within(sectionsNav()).getAllByRole('link')).toHaveLength(3);
  });

  it('renders the page while the stored session is still being checked', async () => {
    storeSession();
    let respond!: (response: MockResponse) => void;
    mockApi({
      'GET /users/me': () => new Promise<MockResponse>((r) => (respond = r)),
    });
    renderApp('/');

    expect(
      screen.getByRole('heading', { level: 1, name: /Organize work/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Checking your session…')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get Started' })).toBeNull();

    await act(async () => respond(ok(testUser)));
    expect(
      await screen.findAllByRole('link', { name: 'Go to Boards' }),
    ).not.toHaveLength(0);
  });

  it('still offers Boards when the session check fails on the server', async () => {
    storeSession();
    mockApi({ 'GET /users/me': fail(500, 'INTERNAL_SERVER_ERROR') });
    renderApp('/');

    expect(
      await within(screen.getByRole('banner')).findByRole('link', {
        name: 'Go to Boards',
      }),
    ).toBeTruthy();
  });

  it('opens the mobile menu and closes it on anchor click or Escape', () => {
    mockApi({});
    renderApp('/');

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    const menu = document.getElementById('landing-menu')!;
    expect(menu.hidden).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    fireEvent.click(within(menu).getByRole('link', { name: 'How it works' }));
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Open menu');

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.hidden).toBe(true);
  });
});
