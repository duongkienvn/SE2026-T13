import { useParams } from 'react-router';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspaceBoards } from '../boards/hooks';
import { WorkspaceBoardGrid } from '../boards/WorkspaceBoardGrid';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceState } from '../components/WorkspaceState';

export function WorkspaceBoardsPage() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspacePage();
  const query = useWorkspaceBoards(
    workspaceId,
    { search: '', status: 'active', sort: 'updated-desc', page: 1 },
    workspace.state,
  );
  usePageTitle(
    workspace.overview
      ? `${workspace.overview.workspace.name} · Boards`
      : 'Workspace boards',
  );
  return (
    <section aria-label="Workspace boards" className="space-y-5">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Boards
        </h2>
        <p className="mt-1 text-sm text-muted">
          Manage and organize your workspace’s boards.
        </p>
      </header>
      {workspace.state === 'ready' && (
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
      )}
      <WorkspaceBoardGrid
        boards={query.pageData?.items ?? []}
        state={query.state}
      />
    </section>
  );
}
