import { Button } from '../../../components/Button';
import { LayersIcon, LockIcon } from '../../../components/icons';
import type { WorkspaceViewState } from '../types';

const messages = {
  unavailable: [
    'Workspaces are on their way',
    'Workspace services are not available yet. Your existing boards are still available from Personal navigation.',
  ],
  forbidden: [
    'Workspace access unavailable',
    'You may no longer be a member of this workspace. Choose another workspace or return to your boards.',
  ],
  'not-found': [
    'Workspace not found',
    'This workspace is unavailable or you do not have access to it.',
  ],
  error: ['Could not load workspace', 'Check your connection and try again.'],
} as const;

export function WorkspaceState({
  state,
  retry,
}: {
  state: WorkspaceViewState;
  retry?: () => void;
}) {
  if (state === 'ready') return null;
  if (state === 'loading')
    return (
      <div
        role="status"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <span className="sr-only">Loading workspace</span>
        <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
          <div className="h-4 w-2/3 rounded bg-line" />
          <div className="h-3 w-1/2 rounded bg-line" />
        </div>
      </div>
    );
  const [title, description] = messages[state];
  const Icon =
    state === 'forbidden' || state === 'not-found' ? LockIcon : LayersIcon;
  return (
    <div
      role={state === 'error' ? 'alert' : 'status'}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
          {description}
        </p>
      </div>
      {state === 'error' && retry && (
        <Button variant="secondary" size="lg" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
