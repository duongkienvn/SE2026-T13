import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';
import {
  destinationPath,
  parseLink,
  parsePath,
} from '../src/navigation/routes.ts';
import { tabs } from '../src/navigation/tabs.ts';

const board = '01234567-89ab-cdef-0123-456789abcdef';
const card = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const path = `/boards/${board}/cards/${card}`;

test('the native shell exposes precisely the four approved tabs', () => {
  assert.deepEqual(
    tabs.map(({ name, label }) => [name, label]),
    [
      ['home', 'Home'],
      ['tasks', 'My Tasks'],
      ['boards', 'Boards'],
      ['inbox', 'Inbox'],
    ],
  );
});

test('tab icons provide distinct transparent selected and unselected assets at native densities', () => {
  for (const { name } of tabs) {
    for (const scale of [1, 2, 3]) {
      const density = scale === 1 ? '' : `@${scale}x`;
      const load = (state) =>
        readFileSync(
          new URL(
            `../assets/navigation/${name}${state}${density}.png`,
            import.meta.url,
          ),
        );
      const normal = load('');
      const selected = load('-selected');
      for (const asset of [normal, selected]) {
        assert.equal(asset.readUInt32BE(16), 24 * scale);
        assert.equal(asset.readUInt32BE(20), 24 * scale);
        assert.equal(asset[25], 6, 'PNG must include an alpha channel');
      }
      assert.notDeepEqual(normal, selected, `${name} ${scale}x`);
    }
  }
});

test('header icons provide transparent assets at native densities', () => {
  for (const name of ['account', 'settings']) {
    for (const scale of [1, 2, 3]) {
      const density = scale === 1 ? '' : `@${scale}x`;
      const asset = readFileSync(
        new URL(`../assets/navigation/${name}${density}.png`, import.meta.url),
      );
      assert.equal(asset.readUInt32BE(16), 24 * scale);
      assert.equal(asset.readUInt32BE(20), 24 * scale);
      assert.equal(asset[25], 6);
    }
  }
});

test('canonical card links round trip for HTTPS and the configured scheme', () => {
  const expected = { kind: 'card', boardId: board, cardId: card };
  assert.deepEqual(parseLink(`https://kanvexa.tech${path}`), expected);
  assert.deepEqual(parseLink(`kanvexa-dev://${path}`), expected);
  assert.deepEqual(parseLink(`kanvexa-dev://${path.slice(1)}`), expected);
  assert.equal(destinationPath(expected), path);
});

test('reject untrusted authorities, paths, queries and encodings before normalization', () => {
  for (const url of [
    `https://evil.example${path}`,
    `https://kanvexa.tech.evil.example${path}`,
    `https://user@kanvexa.tech${path}`,
    `https://kanvexa.tech:443${path}`,
    `http://kanvexa.tech${path}`,
    `https://kanvexa.tech${path}?next=https://evil.example`,
    `https://kanvexa.tech/boards/%2e%2e${path}`,
    `https://kanvexa.tech/boards/%252e%252e${path}`,
    `https://kanvexa.tech/boards/${board}/cards/not-a-uuid`,
    `https://kanvexa.tech${path}/extra`,
    `https://kanvexa.tech${path}#fragment`,
  ])
    assert.equal(parseLink(url), null, url);
  assert.equal(parsePath('//evil.example'), null);
  assert.equal(parsePath('/boards/../home'), null);
});

test('only the approved destination schema parses', () => {
  for (const path of [
    '/home',
    '/tasks',
    '/boards',
    '/inbox',
    '/search',
    '/settings',
    '/invitation',
    `/workspaces/${board}`,
    `/boards/${board}`,
    `/boards/${board}/table`,
    `/boards/${board}/calendar`,
  ]) {
    assert.ok(parsePath(path), path);
  }
  assert.equal(parsePath('/calendar'), null);
});
