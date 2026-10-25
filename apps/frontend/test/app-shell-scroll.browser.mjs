/* global document, window */

// Run against the real app in a browser; JSDOM cannot measure overflow/scroll.
// Vite: await (await import('/test/app-shell-scroll.browser.mjs')).verifyProfileScrolling()
function assert(condition, message) {
  if (!condition) throw new Error(`App Shell scrolling regression: ${message}`);
}

const frame = () => new Promise(window.requestAnimationFrame);
const near = (a, b) => Math.abs(a - b) <= 1;

function geometry(main) {
  return {
    viewport: [window.innerWidth, window.innerHeight],
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentTop: window.scrollY,
    mainHeight: main.clientHeight,
    mainScrollHeight: main.scrollHeight,
    mainTop: main.scrollTop,
  };
}

function assertViewport(main) {
  const measured = geometry(main);
  assert(
    near(measured.documentHeight, window.innerHeight),
    `document is ${measured.documentHeight}px tall for a ${window.innerHeight}px viewport`,
  );
  assert(
    measured.documentWidth <= window.innerWidth,
    'document overflows horizontally',
  );
  assert(near(measured.documentTop, 0), 'document scrolled outside the shell');
  return measured;
}

/** Natural Profile, long accessible announcements, bottom focus and scroll ownership. */
export async function verifyProfileScrolling() {
  const main = document.querySelector('main#main-content');
  const security = document.querySelector(
    '[aria-labelledby="account-security-heading"]',
  );
  const header = document.querySelector('header');
  const nav = document.querySelector('nav[aria-label="Primary"]');
  assert(
    main && security && header && nav,
    'open the loaded authenticated Profile first',
  );
  assert(
    security.querySelector('input[name="currentPassword"]'),
    'use a local-password account to exercise the full form',
  );
  const originalTop = main.scrollTop;
  const originalFocus = document.activeElement;
  const probe = document.createElement('div');
  try {
    window.scrollTo(0, 0);
    main.scrollTop = 0;
    await frame();
    const natural = assertViewport(main);
    const shell = main.parentElement.parentElement.parentElement;
    const shellRect = shell.getBoundingClientRect();
    assert(
      near(shellRect.top, 0) && near(shellRect.bottom, window.innerHeight),
      'shell does not fill the viewport',
    );
    const headerTop = header.getBoundingClientRect().top;
    const navTop = nav.getBoundingClientRect().top;
    main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await frame();
    assertViewport(main);
    assert(
      near(header.getBoundingClientRect().top, headerTop),
      'header moved with content',
    );
    assert(
      near(nav.getBoundingClientRect().top, navTop),
      'sidebar moved with content',
    );
    const link = security.querySelector('a');
    link.focus();
    const bounds = main.getBoundingClientRect();
    const target = link.getBoundingClientRect();
    assert(
      target.top >= bounds.top && target.bottom <= bounds.bottom,
      'last Security action is unreachable',
    );
    const bottom = assertViewport(main);

    // Reproduce the exact failure mechanism even on tall desktop viewports:
    // Tailwind sr-only uses absolute positioning with a static-position anchor
    // below long form/error content. It must stay in the main scroll area.
    const spacer = document.createElement('div');
    spacer.style.height = `${window.innerHeight * 2}px`;
    const announcement = document.createElement('p');
    announcement.className = 'sr-only';
    announcement.setAttribute('role', 'status');
    announcement.textContent = 'Long form validation announcement';
    const lastControl = document.createElement('button');
    lastControl.textContent = 'Layout regression focus target';
    probe.append(spacer, announcement, lastControl);
    main.append(probe);
    main.scrollTop = 0;
    await frame();
    assertViewport(main);
    lastControl.focus();
    await frame();
    const stressed = assertViewport(main);
    assert(
      stressed.mainTop > 0,
      'keyboard focus did not scroll main to the last control',
    );
    const focused = lastControl.getBoundingClientRect();
    assert(
      focused.top >= bounds.top && focused.bottom <= bounds.bottom,
      'focused control is clipped',
    );
    return { natural, bottom, stressed };
  } finally {
    probe.remove();
    originalFocus?.focus({ preventScroll: true });
    main.scrollTop = originalTop;
    window.scrollTo(0, 0);
  }
}

/** Guard against replacing the fix with a global html/body overflow lock. */
export async function verifyPublicAuthScrolling() {
  assert(
    ['/login', '/register', '/forgot-password', '/reset-password'].includes(
      window.location.pathname,
    ),
    'open a public auth form first',
  );
  const main = document.querySelector('main');
  assert(main?.querySelector('form'), 'public form is not loaded');
  const spacer = document.createElement('div');
  spacer.style.height = `${window.innerHeight * 2}px`;
  const button = document.createElement('button');
  button.textContent = 'Public form focus target';
  const probe = document.createElement('div');
  probe.append(spacer, button);
  const originalFocus = document.activeElement;
  const originalTop = main.scrollTop;
  try {
    for (const element of [document.documentElement, document.body]) {
      assert(
        !['hidden', 'clip'].includes(
          window.getComputedStyle(element).overflowY,
        ),
        'public document scrolling is globally locked',
      );
    }
    main.append(probe);
    button.focus();
    await frame();
    assert(
      main.scrollTop > 0,
      'long public form cannot scroll to a focused control',
    );
    const bounds = main.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    assert(
      target.top >= bounds.top && target.bottom <= bounds.bottom,
      'public form control is clipped',
    );
    return geometry(main);
  } finally {
    probe.remove();
    originalFocus?.focus({ preventScroll: true });
    main.scrollTop = originalTop;
  }
}

/** A body-portaled dialog must retain its own scroll area and focus visibility. */
export async function verifyDialogScrolling() {
  const dialog = document.querySelector('[role="dialog"]');
  const main = document.querySelector('main#main-content');
  assert(dialog && main, 'open an authenticated dialog first');
  assert(
    document.querySelector('#root').hasAttribute('inert'),
    'modal background is not inert',
  );
  const originalFocus = document.activeElement;
  const originalTop = dialog.scrollTop;
  const mainTop = main.scrollTop;
  const probe = document.createElement('div');
  const spacer = document.createElement('div');
  spacer.style.height = `${window.innerHeight * 2}px`;
  const button = document.createElement('button');
  button.textContent = 'Dialog focus target';
  probe.append(spacer, button);
  try {
    dialog.append(probe);
    button.focus();
    await frame();
    assert(dialog.scrollTop > 0, 'long modal content cannot scroll');
    const bounds = dialog.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    assert(
      bounds.top >= 0 && bounds.bottom <= window.innerHeight,
      'modal exceeds viewport',
    );
    assert(
      target.top >= bounds.top && target.bottom <= bounds.bottom,
      'modal focus target is clipped',
    );
    assert(
      near(main.scrollTop, mainTop),
      'modal scrolling moved the background main',
    );
    assertViewport(main);
    return {
      viewport: [window.innerWidth, window.innerHeight],
      dialogHeight: dialog.clientHeight,
      dialogScrollHeight: dialog.scrollHeight,
      dialogTop: dialog.scrollTop,
    };
  } finally {
    probe.remove();
    originalFocus?.focus({ preventScroll: true });
    dialog.scrollTop = originalTop;
  }
}
