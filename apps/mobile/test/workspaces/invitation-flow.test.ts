import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInvitationFlow,
  parseInvitationProof,
} from '../../src/features/workspaces/invitations/flow.ts';
import { FakeTime, USER_A, USER_B } from '../auth/support.ts';

const proof = 'a'.repeat(43);
const link = 'https://kanvexa.tech/invitations/workspace#proof=' + proof;
const identity = { userId: USER_A, generation: 2 };

test('the invitation parser accepts only the canonical HTTPS fragment', () => {
  assert.equal(parseInvitationProof(link), proof);
  for (const unsafe of [
    link.replace('kanvexa.tech', 'kanvexa.tech.example'),
    link.replace('kanvexa.tech', 'kanvexa.tech:443'),
    link.replace('kanvexa.tech', 'kanvexa.tech@elsewhere.test'),
    link.replace('https', 'http'),
    link.replace('#', '?'),
    link.replace('invitations/', 'invitations/%2e%2e/'),
    link.replace('invitations/', 'invitations%2f'),
    link.replace('#proof=', '?resume=1#proof='),
    link + '&proof=' + proof,
    link + '\n',
    link.slice(0, -1),
    link.slice(0, -1) + '=',
  ])
    assert.equal(parseInvitationProof(unsafe), null);
});

test('handoff snapshots omit proof and a single claim is bound to a session generation', () => {
  const time = new FakeTime();
  const flow = createInvitationFlow(time, () => time.now());
  assert.equal(flow.intake(link), true);
  assert.equal(flow.claim(identity), null);
  flow.handoff();
  assert.equal(flow.getSnapshot().handoff, true);
  assert.equal(JSON.stringify(flow.getSnapshot()).includes(proof), false);
  flow.bind(identity);
  flow.resume();
  const attempt = flow.claim(identity);
  assert.equal(attempt?.proof, proof);
  assert.equal(flow.claim(identity), null);
  assert.equal(attempt?.finish(true), true);
  const next = flow.claim(identity);
  flow.bind({ userId: USER_B, generation: 3 });
  assert.equal(next?.signal.aborted, true);
  assert.equal(next?.finish(), false);
  assert.equal(flow.getSnapshot().available, false);
});

test('completion, cancellation, expiry and restart discard the invitation proof', () => {
  const time = new FakeTime();
  const flow = createInvitationFlow(time, () => time.now());
  flow.intake(link);
  flow.bind(identity);
  assert.equal(flow.claim(identity)?.finish(), true);
  assert.equal(flow.getSnapshot().available, false);
  flow.intake(link);
  flow.clear();
  assert.equal(flow.getSnapshot().available, false);
  flow.intake(link);
  flow.bind(identity);
  const attempt = flow.claim(identity);
  time.advance(600_000);
  assert.equal(attempt?.signal.aborted, true);
  assert.equal(flow.getSnapshot().available, false);
  assert.equal(createInvitationFlow().getSnapshot().available, false);
  assert.equal(flow.intake(link.replace('#', '?')), true);
  assert.equal(flow.getSnapshot().available, false);
});
