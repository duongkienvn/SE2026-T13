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
});
