import { Link, useNavigate } from 'react-router';
import { useAuth } from '../useAuth';
import { UserAvatar } from './UserAvatar';

const rowClassName =
  'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary';

/** Signed-in identity with Settings and Log out, for the mobile navigation drawer. */
export function AccountLinks({
  showIdentity = true,
  onAction,
}: {
  showIdentity?: boolean;
  onAction?: () => void;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const handleLogout = () => {
    onAction?.();
    signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col">
      {/* Short phones drop the identity row so the whole drawer fits. */}
      {showIdentity && (
        <div className="flex items-center gap-3 px-3 py-2 short:hidden">
          <UserAvatar user={user} className="size-9 text-sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {user.displayName}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
        </div>
      )}
      <Link to="/settings" onClick={onAction} className={rowClassName}>
        Settings
      </Link>
      <button type="button" onClick={handleLogout} className={rowClassName}>
        Log out
      </button>
    </div>
  );
}
