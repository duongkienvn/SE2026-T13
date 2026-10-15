import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from './ActionMenu';

/** jsdom has no layout: place the scroll area, trigger and panel by hand. */
function stubLayout(triggerTop: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === 'MAIN') return { top: 0, bottom: 300 } as DOMRect;
      if (this.tagName === 'BUTTON') {
        return { top: triggerTop, bottom: triggerTop + 32 } as DOMRect;
      }
      return { height: 100 } as DOMRect;
    },
  );
}

function openMenu() {
  render(
    <main>
      <ActionMenu
        label="Actions for Design Team"
        items={[{ label: 'Edit board', onSelect: () => {} }]}
      />
    </main>,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Design Team' }),
  );
  return screen.getByRole('list');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ActionMenu placement', () => {
  it('opens below the trigger when there is room', () => {
    stubLayout(20);
    expect(openMenu().className).toContain('top-full');
  });

  it('opens above the trigger near the bottom of the scroll area', () => {
    stubLayout(250);
    expect(openMenu().className).toContain('bottom-full');
  });
});
