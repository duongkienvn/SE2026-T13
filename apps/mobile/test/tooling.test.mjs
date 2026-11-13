import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const readJson = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url)));

test('preview profile does not enable the navigation bypass', () => {
  const eas = readJson('../eas.json');
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_NAVIGATION_PREVIEW, '0');
  assert.equal(eas.build.preview.environment, 'preview');
  assert.equal(eas.build.preview.android.buildType, 'apk');
});

test('mobile build includes typecheck and Android bundle verification', () => {
  const mobile = readJson('../package.json');
  assert.match(
    mobile.scripts.build,
    /pnpm typecheck\s*&&\s*pnpm bundle:android/,
  );
});
