import { useState } from 'react';
import type { User } from '../types';

interface UserAvatarProps {
  user: Pick<User, 'displayName' | 'avatarUrl'>;
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
 * Profile image when available, otherwise initials. Purely presentational.
 * `className` sets the size and the initials' font size.
 */
export function UserAvatar({
  user,
  className = 'size-11 text-[15px]',
}: UserAvatarProps) {
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
