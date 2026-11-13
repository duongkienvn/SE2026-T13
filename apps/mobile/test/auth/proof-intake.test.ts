import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthFlow,
  parseTrustedAuthLink,
} from '../../src/features/auth/flow.ts';
import { parseLink } from '../../src/navigation/routes.ts';
const token = 'a'.repeat(43);
const url = `https://kanvexa.tech/verify-email?token=${token}`;
test('separate trusted proof intake never weakens generic resource parser', () => {
  assert.equal(parseLink(url), null);
  assert.deepEqual(parseTrustedAuthLink(url), { kind: 'verify-email', token });
  for (const input of [
    url + '&x=1',
    url + '#x',
    url + '&token=' + token,
    url.replace('https:', 'http:'),
    url.replace('kanvexa.tech', 'evil.test'),
    url.replace('kanvexa.tech', 'kanvexa.tech:443'),
    url.replace('/verify', '/x/../verify'),
    url.replace('?token', '?%74oken'),
    url.replace('https://', 'kanvexa-dev://'),
    url.replace('https://', 'https://user@'),
    url + '\n',
    url.replace(token, 'short'),
    url.replace('/verify-email', '/reset-password/'),
    url.replace(token, '%61' + token.slice(1)),
  ])
    assert.equal(parseTrustedAuthLink(input), null, input);
});
test('proofs have a single memory claim, never appear in snapshots, and scrub on cancel/supersede/reset', () => {
  const flow = createAuthFlow();
  try {
    assert.equal(flow.intake(url), 'verify-email');
    const revision = flow.getSnapshot().revision;
    flow.intake(url);
    assert.equal(flow.getSnapshot().revision, revision);
    assert.ok(!JSON.stringify(flow.getSnapshot()).includes(token));
    assert.equal(flow.takeProof('reset-password'), null);
    assert.equal(flow.takeProof('verify-email'), token);
    assert.equal(flow.takeProof('verify-email'), null);
    flow.intake(url);
    flow.cancelProof('verify-email');
    assert.equal(flow.takeProof('verify-email'), null);
    flow.intake(url);
    flow.intake(url.replace('verify-email', 'reset-password'));
    assert.equal(flow.takeProof('verify-email'), null);
    assert.equal(flow.takeProof('reset-password'), token);
    flow.intake(url);
    flow.checkEmail('a@example.test');
    assert.equal(flow.takeProof('verify-email'), null);
    flow.intake(url);
    flow.clear();
    assert.equal(flow.takeProof('verify-email'), null);
    assert.equal(flow.getSnapshot().email, '');
  } finally {
    flow.clear();
  }
});
