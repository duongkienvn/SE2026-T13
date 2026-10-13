import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronDownIcon } from '../../../components/icons';
import { useAuth } from '../useAuth';
import { UserAvatar } from './UserAvatar';

/** Header disclosure with the signed-in user, a profile link and logout. */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = () => {
    setOpen(false);
    signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${user.displayName}`}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full p-0.5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <UserAvatar user={user} className="size-9 text-sm" />
        <ChevronDownIcon className="hidden size-4 md:block" />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-frame"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <UserAvatar user={user} className="size-10" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">
                {user.displayName}
              </p>
              <p className="truncate text-sm text-muted">{user.email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-[15px] text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary"
          >
            Profile
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full rounded-lg px-3 py-2 text-left text-[15px] text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
