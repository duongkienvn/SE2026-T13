import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Rename board"
        description="Pick a new name."
        dismissible={dismissible}
      >
        <input aria-label="Name" />
        <button type="button">Save</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('closes only the top nested dialog and preserves the parent focus trap', () => {
    function Nested() {
      const [parent, setParent] = useState(true);
      const [child, setChild] = useState(false);
      return (
        <Dialog open={parent} onClose={() => setParent(false)} title="Parent">
          <button onClick={() => setChild(true)}>Open child</button>
          <Dialog open={child} onClose={() => setChild(false)} title="Child">
            <button>Child action</button>
          </Dialog>
        </Dialog>
      );
    }
    render(<Nested />);
    const opener = screen.getByRole('button', { name: 'Open child' });
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Child' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Child' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Parent' })).toBeNull();
  });
  it('is a labelled modal that focuses its first control', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = screen.getByRole('dialog', { name: 'Rename board' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('prefers the element marked data-autofocus', () => {
    render(
      <Dialog open onClose={() => undefined} title="Pick">
        <a href="#help">Help</a>
        <input aria-label="Name" data-autofocus />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('keeps Tab focus inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const save = screen.getByRole('button', { name: 'Save' });

    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on backdrop click', () => {
    const { baseElement } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    fireEvent.click(baseElement.querySelector('[data-dialog-backdrop]')!);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cannot be dismissed while not dismissible', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Saving" dismissible={false}>
        <p>Working…</p>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not close during IME composition', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Editor">
        <input />
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});
