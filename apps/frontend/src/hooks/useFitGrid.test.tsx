import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFitGrid, type FitGridOptions } from './useFitGrid';

function Probe(options: FitGridOptions) {
  const fit = useFitGrid(options);
  return (
    <div ref={fit.ref}>
      <div data-fit-fixed />
      <div data-fit-row />
      <output>{`${fit.rows}x${fit.columns}=${fit.pageSize}`}</output>
    </div>
  );
}

/** jsdom has no layout, so give the container, header and row fixed sizes. */
function stubLayout({ width = 900, height = 500 } = {}) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
    height,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const size =
        'fitRow' in this.dataset ? 100 : 'fitFixed' in this.dataset ? 50 : 0;
      return { height: size, width: 0 } as DOMRect;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFitGrid', () => {
  it('remeasures available columns when the sidebar changes the container width', () => {
    stubLayout({ width: 900, height: 500 });
    let resize!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const view = render(
      <Probe
        fallbackRows={4}
        minColumnWidth={280}
        maxColumns={3}
        gap={16}
        reserve={8}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('3x3=9');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(736);
    act(() => resize());
    expect(screen.getByRole('status').textContent).toBe('3x2=6');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    act(() => resize());
    expect(screen.getByRole('status').textContent).toBe('3x3=9');
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('uses the fallback until the layout can be measured', () => {
    render(<Probe fallbackRows={4} maxColumns={3} minColumnWidth={280} />);
    expect(screen.getByRole('status').textContent).toBe('4x3=12');
  });

  it('counts the rows that fit below the fixed parts', () => {
    stubLayout({ height: 500 });
    render(<Probe fallbackRows={1} />);
    // (500 - 50 header) / 100 per row = 4 rows.
    expect(screen.getByRole('status').textContent).toBe('4x1=4');
  });

  it('accounts for gaps, reserved space and column width', () => {
    stubLayout({ width: 900, height: 500 });
    render(
      <Probe
        fallbackRows={1}
        gap={16}
        reserve={8}
        minColumnWidth={280}
        maxColumns={3}
      />,
    );
    // Rows: (500 - 50 - 8 + 16) / 116 = 3.9 → 3. Columns: (900 + 16) / 296 = 3.1 → 3.
    expect(screen.getByRole('status').textContent).toBe('3x3=9');
  });

  it('always shows at least one row and one column', () => {
    stubLayout({ width: 100, height: 60 });
    render(<Probe fallbackRows={5} minColumnWidth={280} maxColumns={3} />);
    expect(screen.getByRole('status').textContent).toBe('1x1=1');
  });
});
