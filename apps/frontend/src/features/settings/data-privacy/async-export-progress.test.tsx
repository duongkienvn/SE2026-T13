import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportAction } from './ExportCard';
import type { ExportState } from './useExportDownload';

afterEach(cleanup);
describe('VT-054 visible export progress', () => {
  it.each([
    ['queued', 'Queued for export.'],
    ['running', 'Preparing your board export.'],
    ['downloading', 'Downloading your export.'],
  ])('TC14: announces the actual %s phase visibly', (phase, message) => {
    // Contract fixture for a phase the baseline component does not support yet.
    const state = { status: 'exporting', phase } as ExportState;
    render(
      <ExportAction
        label="Export board data"
        state={state}
        onClick={vi.fn()}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(message);
    expect(status.querySelector('.sr-only')).toBeNull();
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });
});
