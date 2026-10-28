import { Link, useSearchParams } from 'react-router';
import { Button } from '../../../components/Button';
import {
  ChevronRightIcon,
  LayersIcon,
  PlusIcon,
  UserIcon,
} from '../../../components/icons';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useAuthSession } from '../../auth/auth-session-context';
import { CreateWorkspaceDialog } from '../components/CreateWorkspaceDialog';
import { WorkspaceAvatar } from '../components/WorkspaceIdentity';
import { WorkspaceState } from '../components/WorkspaceState';
import { useWorkspaceDirectory } from '../hooks';
import { workspacePath } from '../navigation';
import type { WorkspaceSummary } from '../types';

export function WorkspacesPage() {
  usePageTitle('Workspaces');
  const query = useWorkspaceDirectory();
  const { generation } = useAuthSession();
  const [params, setParams] = useSearchParams();
  const createOpen = params.get('create') === 'team';
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('create');
    void setParams(next, { replace: true });
  };
  const personal = query.workspaces.filter((item) => item.type === 'PERSONAL');
  const teams = query.workspaces.filter((item) => item.type === 'TEAM');
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-7">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">
            Your work, connected
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Workspaces
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A place for every team. A home for your own work.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('create', 'team');
            void setParams(next);
          }}
        >
          <PlusIcon className="size-4" />
          Create Workspace
        </Button>
      </header>
      <WorkspaceState state={query.state} retry={() => void query.refetch()} />
      {query.state === 'ready' && !query.workspaces.length && (
        <div
          role="status"
          className="rounded-xl border border-line bg-surface p-5"
        >
          <h2 className="font-semibold text-ink">No workspaces available</h2>
          <p className="mt-2 text-sm text-muted">
            Your personal workspace is provisioned automatically. Refresh if it
            has not appeared, or create a team workspace.
          </p>
          <Button
            variant="secondary"
            size="lg"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Refresh workspaces
          </Button>
        </div>
      )}
      <section aria-labelledby="personal-workspace-heading">
        <div className="mb-3 flex items-center gap-2">
          <UserIcon className="size-4 text-muted" />
          <h2
            id="personal-workspace-heading"
            className="font-semibold text-ink"
          >
            Personal workspace
          </h2>
        </div>
        <p className="mb-4 text-sm text-muted">
          Your own space, automatically created for you.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {personal.map((item) => (
            <WorkspaceCard key={item.id} workspace={item} />
          ))}
          {!personal.length && (
            <WorkspacePlaceholder
              loading={query.state === 'loading'}
              title="Your personal space"
              description={
                query.state === 'ready'
                  ? 'Your personal workspace is not available. Try refreshing.'
                  : 'Personal workspace details will appear when available.'
              }
            />
          )}
        </div>
      </section>
      <section aria-labelledby="team-workspaces-heading">
        <div className="mb-3 flex items-center gap-2">
          <LayersIcon className="size-4 text-muted" />
          <h2 id="team-workspaces-heading" className="font-semibold text-ink">
            Team workspaces
          </h2>
        </div>
        <p className="mb-4 text-sm text-muted">
          Spaces you belong to, with the people you work with.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((item) => (
            <WorkspaceCard key={item.id} workspace={item} />
          ))}
          {!teams.length && (
            <WorkspacePlaceholder
              loading={query.state === 'loading'}
              title={
                query.state === 'ready'
                  ? 'Make room for teamwork'
                  : 'Your team spaces'
              }
              description={
                query.state === 'ready'
                  ? 'No team memberships yet. Create a workspace to get started.'
                  : 'Your team memberships will appear here when available.'
              }
            />
          )}
        </div>
      </section>
      <CreateWorkspaceDialog
        key={generation}
        open={createOpen}
        onClose={close}
      />
    </div>
  );
}

function WorkspaceCard({ workspace }: { workspace: WorkspaceSummary }) {
  return (
    <Link
      to={workspacePath(workspace.id)}
      className="group flex min-w-0 items-start gap-4 rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <WorkspaceAvatar workspace={workspace} />
      <div className="min-w-0 flex-1">
        <span className="text-xs text-muted">
          {workspace.type === 'PERSONAL' ? 'Personal' : 'Team'} workspace
        </span>
        <h3 className="mt-1 font-semibold break-words text-ink [overflow-wrap:anywhere]">
          {workspace.name}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm break-words text-muted [overflow-wrap:anywhere]">
          {workspace.description || 'A space for your boards and ideas.'}
        </p>
        <p className="mt-4 text-xs text-muted">
          {workspace.role === 'ADMIN' ? 'Workspace admin' : 'Workspace member'}
        </p>
      </div>
      <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted group-hover:text-primary" />
    </Link>
  );
}

function WorkspacePlaceholder({
  loading,
  title,
  description,
}: {
  loading: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-44 rounded-xl border border-dashed border-line bg-surface/60 p-5">
      {loading ? (
        <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
          <div className="size-10 rounded-xl bg-line" />
          <div className="h-4 w-2/3 rounded bg-line" />
          <div className="h-3 w-5/6 rounded bg-line" />
        </div>
      ) : (
        <>
          <span className="mb-3 grid size-10 place-items-center rounded-xl bg-app text-muted">
            <LayersIcon className="size-5" />
          </span>
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {description}
          </p>
        </>
      )}
    </div>
  );
}
