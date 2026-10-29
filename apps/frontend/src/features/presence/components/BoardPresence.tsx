import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { boardKeys } from '../../boards/query-keys';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { isApiError } from '../../../lib/api-client';
import { UserAvatar } from '../../auth/components/UserAvatar';
import type { User } from '../../auth/types';
import { useAuth } from '../../auth/useAuth';
import { useBoardMembers } from '../../board-members/hooks';
import { useBoardPresence } from '../useBoardPresence';

type Profile = Pick<User, 'displayName' | 'avatarUrl'>;
const UNKNOWN: Profile = { displayName: '?', avatarUrl: null };
const messages = {
  connecting: 'Connecting viewers…',
  syncing: 'Syncing viewers…',
  reconnecting: 'Viewers reconnecting…',
  paused: 'Viewers paused',
} as const;

/** Resolves profiles through existing REST data, never infers population from it. */
export function BoardPresence({
  boardId,
  canReadMembers = true,
}: {
  boardId: string;
  canReadMembers?: boolean;
}) {
  const presence = useBoardPresence(boardId);
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profiles = useMemo(() => {
    const values = new Map<string, Profile>(
      (canReadMembers ? (members.data ?? []) : []).map((member) => [
        member.user.id.toLowerCase(),
        member.user,
      ]),
    );
    if (user) values.set(user.id.toLowerCase(), user);
    return values;
  }, [members.data, user, canReadMembers]);
  const forbidden =
    canReadMembers &&
    isApiError(members.error) &&
    (members.error.status === 403 || members.error.status === 404);
  useEffect(() => {
    if (forbidden)
      void queryClient.invalidateQueries({
        queryKey: boardKeys.detail(boardId),
        exact: true,
      });
  }, [boardId, forbidden, queryClient]);
  if (presence.status === 'unavailable' || forbidden) return null;
  if (presence.status !== 'live' || presence.userIds === null) {
    return (
      <span className="text-xs font-medium text-muted">
        {messages[presence.status === 'live' ? 'syncing' : presence.status]}
      </span>
    );
  }
  if (!presence.userIds.length)
    return <span className="text-xs font-medium text-muted">0 viewing</span>;
  return (
    <PresenceViewers
      key={boardId}
      userIds={presence.userIds}
      profiles={profiles}
      currentUserId={user?.id.toLowerCase()}
    />
  );
}

function PresenceViewers({
  userIds,
  profiles,
  currentUserId,
}: {
  userIds: readonly string[];
  profiles: ReadonlyMap<string, Profile>;
  currentUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const desktop = useMediaQuery('(min-width: 640px)', true);
  const visible = desktop ? 4 : 1;
  const remaining = Math.max(0, userIds.length - visible);
  const names = (id: string) =>
    profiles.get(id)?.displayName || 'Unknown viewer';
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const avatar = (id: string) => (
    <UserAvatar
      user={profiles.get(id) ?? UNKNOWN}
      className={`size-7 text-[11px] ${profiles.has(id) ? '' : 'bg-app! text-muted!'}`}
    />
  );
  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-label={`${userIds.length} ${userIds.length === 1 ? 'person' : 'people'} viewing. Show viewers`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 items-center gap-2 rounded-lg px-1 text-sm text-muted hover:bg-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex -space-x-2">
          {userIds.slice(0, visible).map((id) => (
            <span
              key={id}
              role="img"
              aria-label={`${names(id)} is viewing`}
              className="rounded-full ring-2 ring-surface"
            >
              {avatar(id)}
            </span>
          ))}
          {remaining > 0 && (
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-full bg-app text-[11px] font-semibold text-muted ring-2 ring-surface"
            >
              +{remaining}
            </span>
          )}
        </span>
        <span className="whitespace-nowrap text-xs font-medium">
          {userIds.length} viewing
        </span>
      </button>
      {open && (
        <div
          id={listId}
          className="absolute top-full left-0 z-30 mt-2 w-60 max-w-[calc(100vw-7rem)] rounded-xl border border-line bg-surface p-3 shadow-card"
        >
          <p className="mb-2 text-xs font-semibold text-muted">
            Viewing this board
          </p>
          <ul
            aria-label="People viewing this board"
            className="max-h-56 space-y-2 overflow-y-auto"
          >
            {userIds.map((id) => (
              <li key={id} className="flex min-w-0 items-center gap-2">
                {avatar(id)}
                <span className="min-w-0 text-sm break-words text-ink">
                  {names(id)}
                  {id === currentUserId && (
                    <span className="text-muted"> (You)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
