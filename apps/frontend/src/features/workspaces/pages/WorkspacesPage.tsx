import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspaceDirectory } from '../hooks';
import { WorkspaceState } from '../components/WorkspaceState';

export function WorkspacesPage() {
  usePageTitle('Workspaces');
  const query = useWorkspaceDirectory();
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-7">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Workspaces
        </h1>
        <p className="mt-2 text-sm text-muted">
          A place for every team. A home for your own work.
        </p>
      </header>
      <WorkspaceState state={query.state} retry={() => void query.refetch()} />
    </div>
  );
}
