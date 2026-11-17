import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isUuid } from '../../../infrastructure/auth/credential-record';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import { Avatar } from '../../../ui';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';

function ownedAvatar(value: string | null, userId: string) {
  const parts = value?.split('/');
  return parts?.length === 5 &&
    parts[0] === '' &&
    parts[1] === 'users' &&
    parts[2] === userId &&
    parts[3] === 'avatar' &&
    isUuid(parts[4])
    ? value
    : null;
}

function externalAvatar(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function avatarData(bytes: Uint8Array) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits =
      (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded +=
      alphabet[(bits >>> 18) & 63]! +
      alphabet[(bits >>> 12) & 63]! +
      (i + 1 < bytes.length ? alphabet[(bits >>> 6) & 63]! : '=') +
      (i + 2 < bytes.length ? alphabet[bits & 63]! : '=');
  }
  return `data:image/webp;base64,${encoded}`;
}

export function WorkspacePersonAvatar({
  context,
  name,
  userId,
  avatarUrl,
  revision,
}: {
  context: WorkspaceCollaborationContext;
  name: string;
  userId: string;
  avatarUrl: string | null;
  revision?: number;
}) {
  const data = useMobileData();
  const owned = ownedAvatar(avatarUrl, userId);
  const { identity, id, active, online } = context;
  const queryKey = [
    ...queryKeys.workspace(identity, id),
    'roster-avatar',
    owned,
    revision,
  ] as const;
  const image = useQuery({
    queryKey,
    enabled: !!owned && active && online,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const { bytes } = await data.api.binary(owned!, ['image/webp'], {
        identity,
        signal,
        resourceKey: queryKey,
        retries: 0,
      });
      return bytes.byteLength <= 512_000
        ? avatarData(new Uint8Array(bytes))
        : null;
    },
  });
  const uri = owned
    ? image.isSuccess
      ? image.data
      : null
    : externalAvatar(avatarUrl);
  const source = useMemo(() => (uri ? { uri } : undefined), [uri]);
  return <Avatar name={name} source={source} />;
}
