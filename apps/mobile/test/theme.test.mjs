import assert from 'node:assert/strict';
import test from 'node:test';
import { palettes, resolveTheme, spacing } from '../src/ui/tokens.ts';

function luminance(hex) {
  const channels = hex
    .match(/[\da-f]{2}/gi)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('explicit and system theme selection', () => {
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', null), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.deepEqual(Object.values(spacing), [4, 8, 12, 16, 20, 24, 32, 40]);
});
test('core text, status and button pairs have readable contrast', () => {
  for (const c of Object.values(palettes)) {
    for (const foreground of [
      c.text,
      c.textSecondary,
      c.textMuted,
      c.success,
      c.warning,
      c.danger,
      c.info,
    ]) {
      assert.ok(
        contrast(foreground, c.surface) >= 4.5,
        `${foreground} on ${c.surface}`,
      );
    }
    assert.ok(contrast(c.onPrimary, c.primary) >= 4.5);
    assert.ok(contrast(c.surface, c.danger) >= 4.5);
  }
});
