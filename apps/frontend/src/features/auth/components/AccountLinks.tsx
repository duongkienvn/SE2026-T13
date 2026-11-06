import { Link, useNavigate } from 'react-router';
import { LogoutIcon, SettingsIcon } from '../../../components/icons';
import { useAuth } from '../useAuth';
import { UserAvatar } from './UserAvatar';

const rowClassName =
  'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary';

/** Signed-in identity with Settings and Log out, for the mobile navigation drawer. */
export function AccountLinks({
  showIdentity = true,
  compact = false,
  onAction,
}: {
  showIdentity?: boolean;
  compact?: boolean;
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
      <Link
        to="/settings"
        onClick={onAction}
        className={`${rowClassName} ${compact ? 'gap-3 text-sm' : ''}`}
      >
        {compact && <SettingsIcon className="size-4 shrink-0 text-muted" />}
        Settings
      </Link>
      {compact && <hr className="mx-2 my-1 border-line" />}
      <button
        type="button"
        onClick={handleLogout}
        className={
          compact
            ? 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[color-mix(in_srgb,var(--color-danger)_75%,var(--color-muted))] hover:bg-danger/8 focus-visible:outline-2 focus-visible:outline-primary'
            : rowClassName
        }
      >
        {compact && <LogoutIcon className="size-4 shrink-0" />}
        Log out
      </button>
    </div>
  );
}
