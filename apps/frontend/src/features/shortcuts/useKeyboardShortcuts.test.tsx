import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { modifierLabel } from './registry';

const id = '00000000-0000-4000-9000-000000000001';
function Harness({ overlay = false }: { overlay?: boolean }) {
  useKeyboardShortcuts();
  const location = useLocation();
  return (
    <>
      <output aria-label="location">
        {location.pathname}
        {location.search}
      </output>
      <input aria-label="editor" />
      <div contentEditable aria-label="rich editor" />
      {overlay && <div role="dialog">Dialog</div>}
      <section data-shortcut-board={id}>
        <button data-shortcut-card>First card</button>
        <button data-shortcut-card disabled>
          Disabled card
        </button>
        <button data-shortcut-card data-shortcut-open-card="card-2">
          Second card
        </button>
        <details>
          <summary>More</summary>
          <button data-shortcut-card>Hidden card</button>
        </details>
      </section>
    </>
  );
}
function setup(path = `/boards/${id}?q=keep`, overlay = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Harness overlay={overlay} />
    </MemoryRouter>,
  );
}
const location = () => screen.getByLabelText('location').textContent;
const key = (value: string, options: Partial<KeyboardEvent> = {}) =>
  fireEvent.keyDown(document, { key: value, ...options });
afterEach(() => vi.restoreAllMocks());

describe('keyboard shortcuts', () => {
  it.each([
    ['h', '/home'],
    ['t', '/my-tasks'],
    ['b', '/boards'],
  ])('navigates G then %s', (letter, expected) => {
    setup();
    key('g');
    expect(location()).toContain('/boards/');
    key(letter);
    expect(location()).toBe(expected);
  });
  it('expires a chord, ignores modifiers and opens help with ?', () => {
    setup();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    key('g');
    clock.mockReturnValue(2001);
    key('h');
    expect(location()).toContain('/boards/');
    key('g', { ctrlKey: true });
    key('h');
    expect(location()).toContain('/boards/');
    key('?', { shiftKey: true });
    expect(location()).toBe('/settings/keyboard-shortcuts');
  });
  it('does not execute another shortcut as the second key of an invalid chord', () => {
    setup();
    key('g');
    key('2');
    expect(location()).toBe(`/boards/${id}?q=keep`);
    key('2');
    expect(location()).toBe(`/boards/${id}/calendar?q=keep`);
  });
  it.each([
    ['1', ''],
    ['2', '/calendar'],
    ['3', '/table'],
  ])('opens Board view %s and preserves filters', (digit, suffix) => {
    setup();
    key(digit);
    expect(location()).toBe(`/boards/${id}${suffix}?q=keep`);
  });
  it('does not switch views outside an authorized mounted Board', () => {
    setup('/home');
    key('2');
    expect(location()).toBe('/home');
  });
  it('ignores editable, IME, modified and open overlay events', () => {
    setup();
    fireEvent.keyDown(screen.getByLabelText('editor'), { key: '?' });
    fireEvent.keyDown(screen.getByLabelText('rich editor'), { key: 'g' });
    key('h');
    key('?', { isComposing: true });
    fireEvent.keyDown(document, { key: '?', keyCode: 229 });
    key('?', { metaKey: true });
    expect(location()).toContain('/boards/');
  });
  it('does not navigate or move focus behind a dialog', () => {
    setup(`/boards/${id}`, true);
    key('?');
    key('g');
    key('h');
    key('2');
    key('j');
    expect(location()).toBe(`/boards/${id}`);
    expect(document.activeElement).not.toBe(screen.getByText('First card'));
  });
  it('moves focus within visible cards, clamps boundaries, and opens the focused Calendar card', () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
      length: 1,
    } as DOMRectList);
    setup(`/boards/${id}/calendar?q=keep`);
    key('j');
    expect(document.activeElement).toBe(screen.getByText('First card'));
    key('j');
    expect(document.activeElement).toBe(screen.getByText('Second card'));
    key('j');
    expect(document.activeElement).toBe(screen.getByText('Second card'));
    fireEvent.keyDown(screen.getByText('Second card'), { key: 'Enter' });
    expect(location()).toBe(`/boards/${id}/cards/card-2?q=keep`);
  });
  it('does not hijack ordinary Enter or native Ctrl/Cmd+K', () => {
    setup();
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    const search = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(search);
    expect(search.defaultPrevented).toBe(false);
  });
  it('does not scan card collections for unrelated keys', () => {
    setup();
    const board = document.querySelector('[data-shortcut-board]')!;
    const scan = vi.spyOn(board, 'querySelectorAll');
    key('x');
    expect(scan).not.toHaveBeenCalled();
  });
  it('uses the correct platform keycap', () => {
    expect(modifierLabel('MacIntel')).toBe('⌘');
    expect(modifierLabel('Win32')).toBe('Ctrl');
  });
  it('removes its document listener when the session unmounts', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = setup('/home');
    const listener = add.mock.calls.find(([name]) => name === 'keydown')?.[1];
    expect(listener).toBeTruthy();
    unmount();
    expect(
      remove.mock.calls.some(
        ([name, fn]) => name === 'keydown' && fn === listener,
      ),
    ).toBe(true);
  });
});
