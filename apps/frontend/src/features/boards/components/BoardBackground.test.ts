import { describe, expect, it } from 'vitest';
import { backgroundStyle } from './BoardBackground';

describe('board background rendering', () => {
  it('uses packaged photos rather than the server URL', () => {
    const style = backgroundStyle({
      id: 'forest',
      kind: 'photo',
      value: 'https://example.invalid/image',
      foreground: 'light',
    });
    expect(JSON.stringify(style)).toContain('/board-backgrounds/forest.jpg');
    expect(JSON.stringify(style)).not.toContain('example.invalid');
  });

  it('renders the catalog color and handles missing presets', () => {
    expect(
      backgroundStyle({
        id: 'blue',
        kind: 'color',
        value: '#2563EB',
        foreground: 'light',
      }),
    ).toMatchObject({
      backgroundColor: '#2563EB',
      backgroundImage: expect.stringContaining('linear-gradient'),
    });
    expect(backgroundStyle(undefined)).toBeUndefined();
  });
});
