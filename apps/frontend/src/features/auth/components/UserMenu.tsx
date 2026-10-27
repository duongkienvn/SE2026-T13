import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '../../../components/icons';
import { useAuth } from '../useAuth';
import { AccountLinks } from './AccountLinks';
import { UserAvatar } from './UserAvatar';

/** Sidebar account disclosure. Portal placement keeps it outside the shell's clipping. */
export function UserMenu({ expanded = true }: { expanded?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;
    const trigger = button.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const gap = 8;
    const above = trigger.top - height - gap;
    const beside = !expanded || above < gap;
    setPosition({
      left: Math.max(
        gap,
        Math.min(
          beside ? trigger.right + gap : trigger.left,
          window.innerWidth - width - gap,
        ),
      ),
      top: Math.max(
        gap,
        Math.min(
          beside ? trigger.bottom - height : above,
          window.innerHeight - height - gap,
        ),
      ),
    });
    panel.querySelector<HTMLElement>('a, button')?.focus();
  }, [open, expanded]);

  useEffect(() => {
    if (!open) return;
    const contains = (target: EventTarget | null) =>
      target instanceof Node &&
      (buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target));
    const onOutside = (event: Event) => {
      if (!contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  if (!user) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${user.displayName}`}
        title={expanded ? undefined : `Account menu for ${user.displayName}`}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-11 w-full items-center rounded-lg text-left text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary ${expanded ? 'gap-3 px-2 py-2' : 'justify-center'}`}
      >
        <UserAvatar user={user} className="size-9 text-sm" />
        {expanded && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">
                {user.displayName}
              </span>
              <span className="block truncate text-xs text-muted">
                {user.email}
              </span>
            </span>
            <ChevronDownIcon
              className={`size-4 shrink-0 ${open ? '' : 'rotate-180'}`}
            />
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="group"
            aria-label="Account actions"
            style={position}
            className="fixed z-50 max-h-[calc(100dvh-1rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-frame"
          >
            <AccountLinks
              showIdentity={false}
              onAction={() => {
                buttonRef.current?.focus();
                setOpen(false);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
