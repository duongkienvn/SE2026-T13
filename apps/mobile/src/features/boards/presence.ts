import type { BoardRealtimeState } from '../../infrastructure/realtime/rooms.ts';

export const PRESENCE_AVATARS = 3;

export type PresencePerson = { userId: string; displayName: string };
export type PresenceView =
  | { kind: 'hidden' }
  | {
      kind: 'count';
      /** Distinct current Board connections, excluding you. */
      others: number;
      label: string;
    }
  | {
      kind: 'people';
      others: number;
      shown: PresencePerson[];
      /** Present users that the roster cannot name (or past the avatar cap). */
      more: number;
      label: string;
    };

function people(count: number) {
  return count === 1 ? '1 other person' : `${count} other people`;
}

/**
 * `presence:sync` is a snapshot of users connected to this Board room right
 * now. It is shown only while the room is live and REST still grants read, and
 * it is never a last-seen, typing or "online anywhere" signal. Names come only
 * from the authorized Board roster; without one (Workspace read-only viewer)
 * the view is a count. Unknown ids are counted, never named.
 */
export function presenceView(
  room: Pick<BoardRealtimeState, 'status' | 'canRead' | 'userIds'>,
  boardReadable: boolean,
  selfId: string,
  roster: ReadonlyMap<
    string,
    { displayName: string; isDeleted?: boolean }
  > | null,
): PresenceView {
  if (room.status !== 'live' || !room.canRead || !boardReadable)
    return { kind: 'hidden' };
  const self = selfId.toLowerCase();
  const others = [
    ...new Set(room.userIds.map((id) => id.toLowerCase())),
  ].filter((id) => id !== self);
  if (!others.length) return { kind: 'hidden' };
  if (!roster)
    return {
      kind: 'count',
      others: others.length,
      label: `${people(others.length)} viewing this board now`,
    };
  const named: PresencePerson[] = [];
  for (const id of others) {
    const member = roster.get(id);
    if (member && !member.isDeleted)
      named.push({ userId: id, displayName: member.displayName });
  }
  named.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      a.userId.localeCompare(b.userId),
  );
  const shown = named.slice(0, PRESENCE_AVATARS);
  const more = others.length - shown.length;
  const names = shown.map(({ displayName }) => displayName).join(', ');
  return {
    kind: 'people',
    others: others.length,
    shown,
    more,
    label: `Viewing this board now: ${
      shown.length
        ? more
          ? `${names} and ${more} more`
          : names
        : people(others.length)
    }`,
  };
}
