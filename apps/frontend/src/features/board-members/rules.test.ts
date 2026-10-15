import { describe, expect, it } from 'vitest';
import { makeMember } from '../../test/board-fixtures';
import { memberActionBlocks, sortMembers } from './rules';

const creatorId = 'creator';
const user = (id: string, displayName = id) => ({
  id,
  email: `${id}@example.com`,
  displayName,
  avatarUrl: null,
});

describe('memberActionBlocks', () => {
  const creator = makeMember({ user: user(creatorId), role: 'OWNER' });
  const coOwner = makeMember({ user: user('co-owner'), role: 'OWNER' });
  const member = makeMember({ user: user('member'), role: 'MEMBER' });

  it('protects the board creator', () => {
    const blocks = memberActionBlocks(
      creator,
      [creator, coOwner],
      { createdById: creatorId },
      'co-owner',
    );
    expect(blocks).toEqual({
      remove: 'The board creator can’t be removed.',
      demote: 'The board creator always stays an owner.',
    });
  });

  it('stops owners removing or demoting themselves', () => {
    const blocks = memberActionBlocks(
      coOwner,
      [creator, coOwner],
      { createdById: creatorId },
      'co-owner',
    );
    expect(blocks).toEqual({
      remove: 'You can’t remove yourself from the board.',
      demote: 'You can’t change your own role.',
    });
  });

  it('protects the last remaining owner', () => {
    const blocks = memberActionBlocks(
      coOwner,
      [coOwner, member],
      { createdById: 'someone-else' },
      undefined,
    );
    expect(blocks).toEqual({
      remove: 'A board needs at least one owner.',
      demote: 'A board needs at least one owner.',
    });
  });

  it('allows actions on co-owners and members', () => {
    const board = { createdById: creatorId };
    expect(
      memberActionBlocks(coOwner, [creator, coOwner], board, creatorId),
    ).toEqual({});
    expect(
      memberActionBlocks(member, [creator, member], board, creatorId),
    ).toEqual({});
  });
});

describe('sortMembers', () => {
  it('lists owners first, then by name', () => {
    const sorted = sortMembers([
      makeMember({ user: user('c', 'Zoe'), role: 'MEMBER' }),
      makeMember({ user: user('b', 'Bob'), role: 'OWNER' }),
      makeMember({ user: user('a', 'Amy'), role: 'MEMBER' }),
    ]);
    expect(sorted.map((m) => m.user.displayName)).toEqual([
      'Bob',
      'Amy',
      'Zoe',
    ]);
  });
});
