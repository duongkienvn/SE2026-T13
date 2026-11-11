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
function blend(a, b, amount) {
  const start = a.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16));
  const end = b.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16));
  return `#${start
    .map((value, index) =>
      Math.round(value + (end[index] - value) * amount)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
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
      for (const background of [
        c.surface,
        c.surfaceSoft,
        c.primaryTint,
        c.background,
      ]) {
        assert.ok(
          contrast(foreground, background) >= 4.5,
          `${foreground} on ${background}`,
        );
      }
    }
    for (const background of [
      c.surface,
      c.surfaceSoft,
      c.primaryTint,
      c.background,
    ]) {
      assert.ok(
        contrast(c.controlBorder, background) >= 3,
        `${c.controlBorder} on ${background}`,
      );
    }
    assert.ok(contrast(c.onPrimary, c.primary) >= 4.5);
    assert.ok(contrast(c.onPrimary, c.primaryPressed) >= 4.5);
    assert.ok(contrast(c.surface, c.danger) >= 4.5);
    assert.ok(
      contrast(c.primary, c.progressTrack) >= 3,
      `${c.primary} progress on ${c.progressTrack}`,
    );
    for (const amount of [0.25, 0.5, 0.75, 1]) {
      const color = blend(c.primary, c.progressEnd, amount);
      assert.ok(
        contrast(color, c.progressTrack) >= 3,
        `${color} progress on ${c.progressTrack}`,
      );
    }
    for (const background of [c.surface, c.surfaceSoft, c.background]) {
      assert.ok(
        contrast(c.focus, background) >= 3,
        `${c.focus} focus on ${background}`,
      );
    }
  }
});
