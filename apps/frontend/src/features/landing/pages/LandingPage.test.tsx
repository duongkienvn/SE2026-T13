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
      await screen.findByRole('heading', { level: 1, name: /Turn ideas into/ }),
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
        .getByRole('link', { name: 'Get started free' })
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
        .getByRole('link', { name: 'Get started free' })
        .getAttribute('href'),
    ).toBe('/register');
    expect(
      within(hero)
        .getByRole('link', { name: 'Explore features' })
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
      within(hero).queryByRole('link', { name: 'Get started free' }),
    ).toBeNull();
  });

  it('lists all six features and three workspace steps', () => {
    mockApi({});
    renderApp('/');

    const features = document.getElementById('features')!;
    expect(
      within(features)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'Visual boards',
      'Realtime collaboration',
      'Workspaces & permissions',
      'Checklists',
      'Labels & dates',
      'Attachments',
    ]);

    const steps = within(document.getElementById('how-it-works')!);
    expect(steps.getByRole('heading', { level: 2 }).textContent).toBe(
      'Get your team up and running in minutes',
    );
    expect(steps.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    for (const name of [
      'Step 1: Create a workspace',
      'Step 2: Organize your boards',
      'Step 3: Collaborate in real time',
    ]) {
      expect(steps.getByRole('heading', { level: 3, name })).toBeTruthy();
    }
  });

  it('makes the product showcase the Why Kanvexa section', () => {
    mockApi({});
    renderApp('/');

    const why = within(document.getElementById('why-kanvexa')!);
    expect(why.getByRole('heading', { level: 2 }).textContent).toBe(
      'A better way to manage your work',
    );
    expect(why.getByRole('img', { name: /Card Detail/ })).toBeTruthy();
    expect(why.getAllByRole('listitem')).toHaveLength(5);
  });

  it('explains invitations without implying access to private Boards', () => {
    mockApi({});
    renderApp('/');

    expect(
      screen.getByText(/Private boards keep their own membership/),
    ).toBeTruthy();
  });

  it('ends with a sign-up call to action and a footer of real links', () => {
    mockApi({});
    renderApp('/');

    const cta = screen
      .getByRole('heading', { name: "Ready to streamline your team's work?" })
      .closest('section') as HTMLElement;
    expect(
      within(cta)
        .getByRole('link', { name: 'Get started free' })
        .getAttribute('href'),
    ).toBe('/register');
    const footer = within(screen.getByRole('contentinfo'));
    for (const link of footer.getAllByRole('link')) {
      const href = link.getAttribute('href')!;
      expect(href).toMatch(
        /^(#(features|how-it-works|why-kanvexa|faq)|\/(login|register)?$|https:\/\/github\.com\/duongkienvn\/SE2026-T13)/,
      );
    }
    for (const github of footer.getAllByRole('link', { name: /GitHub/ })) {
      expect(github.getAttribute('target')).toBe('_blank');
      expect(github.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('points the closing call to action and footer at Boards once signed in', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    renderApp('/');

    const cta = (
      await screen.findByRole('heading', {
        name: "Ready to streamline your team's work?",
      })
    ).closest('section') as HTMLElement;
    expect(
      (
        await within(cta).findByRole('link', { name: 'Go to your boards' })
      ).getAttribute('href'),
    ).toBe('/boards');
    expect(within(cta).queryByRole('link', { name: 'Log in' })).toBeNull();

    const footer = within(screen.getByRole('contentinfo'));
    expect(
      footer.getByRole('link', { name: 'Your boards' }).getAttribute('href'),
    ).toBe('/boards');
    expect(footer.queryByRole('link', { name: 'Sign up' })).toBeNull();
  });

  it('links all four header anchors to distinct sections', () => {
    mockApi({});
    renderApp('/');

    const links = within(sectionsNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Features',
      'How it works',
      'Why Kanvexa',
      'FAQ',
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
      '#faq',
    ]);
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });

  it('keeps all six FAQ answers available as native disclosure content', () => {
    mockApi({});
    renderApp('/');
    const faq = document.getElementById('faq')!;
    const disclosures = faq.querySelectorAll('details');
    expect(disclosures).toHaveLength(6);
    for (const details of disclosures) {
      expect(details.querySelector('summary')?.textContent).toBeTruthy();
      expect(details.querySelector('p')?.textContent).toBeTruthy();
      expect(details.open).toBe(false);
    }
  });

  it('keeps product illustrations static, labelled and free of interactive controls', () => {
    const calls = mockApi({});
    renderApp('/');
    const artwork = document.querySelectorAll('[data-ui]');
    expect(artwork).toHaveLength(6);
    for (const art of artwork) {
      expect(art.getAttribute('role')).toBe('img');
      expect(art.getAttribute('aria-label')).toBeTruthy();
      expect(
        art.querySelector('a,button,input,select,textarea,[tabindex]'),
      ).toBeNull();
      expect(art.textContent).not.toMatch(
        /Coming soon|Product preview|\bSoon\b/i,
      );
    }
    expect(calls).toHaveLength(0);
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
      within(header).queryByRole('link', { name: 'Get started free' }),
    ).toBeNull();
    expect(within(sectionsNav()).getAllByRole('link')).toHaveLength(4);
  });

  it('renders the page while the stored session is still being checked', async () => {
    storeSession();
    let respond!: (response: MockResponse) => void;
    mockApi({
      'GET /users/me': () => new Promise<MockResponse>((r) => (respond = r)),
    });
    renderApp('/');

    expect(
      screen.getByRole('heading', { level: 1, name: /Turn ideas into/ }),
    ).toBeTruthy();
    expect(screen.queryByText('Checking your session…')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Get started free' })).toBeNull();

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
    expect(document.activeElement).toBe(toggle);
  });
});
