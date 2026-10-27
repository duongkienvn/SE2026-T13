import { useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '../types';
import { AuthContext } from '../auth-context';
import { useAuthSession } from '../auth-session-context';
import { useAuth } from '../useAuth';
import { isManagedAvatar, readAvatar } from '../avatar-api';
import { avatarKeys } from '../avatar-query-keys';

interface UserAvatarProps {
  user: Pick<User, 'displayName' | 'avatarUrl'> & { id?: string };
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Shared legacy/managed profile renderer with session-private delivery.
 * `className` sets the size and the initials' font size.
 */
export function UserAvatar({
  user,
  className = 'size-11 text-[15px]',
}: UserAvatarProps) {
  const auth = useContext(AuthContext);
  // Board/member DTO caches may predate the current user's successful upload.
  const effective =
    user.id && auth?.user?.id === user.id
      ? { ...user, avatarUrl: auth.user.avatarUrl }
      : user;
  if (effective.avatarUrl && isManagedAvatar(effective.avatarUrl))
    return auth?.user ? (
      <ManagedAvatar
        user={effective}
        className={className}
        path={effective.avatarUrl}
      />
    ) : (
      <AvatarImage
        user={{ ...effective, avatarUrl: null }}
        className={className}
      />
    );
  return <AvatarImage user={effective} className={className} />;
}

function ManagedAvatar({
  user,
  className,
  path,
}: UserAvatarProps & { path: string }) {
  const { runAuthorized } = useAuth();
  const { generation, isCurrent } = useAuthSession();
  const image = useQuery({
    queryKey: avatarKeys.image(generation, path),
    queryFn: ({ signal }) =>
      runAuthorized((token) => readAvatar(token, path, signal)),
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  const [object, setObject] = useState<{
    blob: Blob;
    url: string;
    generation: number;
  } | null>(null);
  useEffect(() => {
    if (!image.data || image.isError || !isCurrent()) {
      setObject(null);
      return;
    }
    const url = URL.createObjectURL(image.data);
    setObject({ blob: image.data, url, generation });
    return () => URL.revokeObjectURL(url);
  }, [image.data, image.isError, generation, isCurrent]);
  const url =
    !image.isError &&
    object?.blob === image.data &&
    object?.generation === generation &&
    isCurrent()
      ? object.url
      : null;
  return (
    <AvatarImage user={{ ...user, avatarUrl: url }} className={className} />
  );
}

function AvatarImage({ user, className }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = user.avatarUrl && user.avatarUrl !== failedUrl;

  if (showImage) {
    return (
      <img
        src={user.avatarUrl!}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(user.avatarUrl)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary ${className}`}
    >
      {initials(user.displayName)}
    </span>
  );
}
