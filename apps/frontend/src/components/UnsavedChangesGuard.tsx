import { useEffect } from 'react';
import { useBlocker } from 'react-router';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface UnsavedChangesGuardProps {
  /** True while the form has edits that are not saved or being saved. */
  when: boolean;
  description: string;
}

/**
 * Asks before a route change drops unsaved edits and warns on tab close.
 * Logout and session expiry unmount the form, and with it this guard.
 */
export function UnsavedChangesGuard({
  when,
  description,
}: UnsavedChangesGuardProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [when]);

  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      title="Discard unsaved changes?"
      description={description}
    >
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => blocker.reset?.()}>
          Keep editing
        </Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>
          Discard changes
        </Button>
      </div>
    </Dialog>
  );
}
