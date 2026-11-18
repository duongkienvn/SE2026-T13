import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isUuid } from '../../../infrastructure/auth/credential-record';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import { Avatar } from '../../../ui';
import type { BoardMember } from './api';

/** Private avatars use the Board roster fence and never put bearer tokens in Image URLs. */
export function BoardMemberAvatar({
  member,
  identity,
  boardId,
}: {
  member: BoardMember;
  identity: SessionIdentity;
  boardId: string;
}) {
  const data = useMobileData();
  const { user } = member;
  const parts = user.avatarUrl?.split('/');
  const owned =
    parts?.length === 5 &&
    parts[0] === '' &&
    parts[1] === 'users' &&
    parts[2] === user.id &&
    parts[3] === 'avatar' &&
    isUuid(parts[4])
      ? user.avatarUrl
      : null;
  let external: string | undefined;
  try {
    const url = new URL(user.avatarUrl ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password)
      external = url.href;
  } catch {
    /* Initials remain available for an absent/invalid image. */
  }
  const key = [
    ...queryKeys.members(identity, boardId),
    'avatar',
    user.id,
    user.avatarRevision,
    owned,
  ] as const;
  const image = useQuery({
    queryKey: key,
    enabled: !!owned && !user.isDeleted,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    async queryFn({ signal }) {
      const { bytes } = await data.api.binary(owned!, ['image/webp'], {
        identity,
        signal,
        resourceKey: key,
        retries: 0,
      });
      if (bytes.byteLength > 512_000) return null;
      const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const buffer = new Uint8Array(bytes);
      let encoded = '';
      for (let i = 0; i < buffer.length; i += 3) {
        const bits =
          (buffer[i]! << 16) |
          ((buffer[i + 1] ?? 0) << 8) |
          (buffer[i + 2] ?? 0);
        encoded +=
          alphabet[(bits >>> 18) & 63]! +
          alphabet[(bits >>> 12) & 63]! +
          (i + 1 < buffer.length ? alphabet[(bits >>> 6) & 63]! : '=') +
          (i + 2 < buffer.length ? alphabet[bits & 63]! : '=');
      }
      return `data:image/webp;base64,${encoded}`;
    },
  });
  const uri = user.isDeleted ? undefined : owned ? image.data : external;
  const source = useMemo(() => (uri ? { uri } : undefined), [uri]);
  return <Avatar name={user.displayName} source={source} />;
}
