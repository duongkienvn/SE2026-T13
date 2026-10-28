import { useParams } from 'react-router';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspaceBoards } from '../boards/hooks';
import { WorkspaceBoardGrid } from '../boards/WorkspaceBoardGrid';
import { WorkspaceBoardsToolbar } from '../boards/WorkspaceBoardsToolbar';
import { useBoardFilters } from '../boards/useBoardFilters';
import { useWorkspaceBoardsGateway } from '../boards/gateway';
import { Pagination } from '../../../components/Pagination';
import { useAuthSession } from '../../auth/auth-session-context';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceState } from '../components/WorkspaceState';

export function WorkspaceBoardsPage() {
  const { workspaceId = '' } = useParams();
  const { generation } = useAuthSession();
  return (
    <WorkspaceBoardsContent
      key={`${generation}:${workspaceId}`}
      workspaceId={workspaceId}
    />
  );
}

function WorkspaceBoardsContent({ workspaceId }: { workspaceId: string }) {
  const workspace = useWorkspacePage();
  const gateway = useWorkspaceBoardsGateway();
  const control = useBoardFilters(gateway.features);
  const query = useWorkspaceBoards(
    workspaceId,
    control.filters,
    control.debouncing && workspace.state === 'ready'
      ? 'loading'
      : workspace.state,
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
      <WorkspaceBoardsToolbar
        control={control}
        features={gateway.features}
        available={gateway.available && workspace.state === 'ready'}
      />
      {workspace.state === 'ready' && (
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
      )}
      <WorkspaceBoardGrid
        boards={query.pageData?.items ?? []}
        state={query.state}
        filtered={control.filtered}
      />
      {query.pageData && (
        <div className="space-y-3">
          <p role="status" className="text-xs text-muted">
            {query.pageData.total} accessible{' '}
            {query.pageData.total === 1 ? 'board' : 'boards'}
            {control.filtered ? ' matching these filters' : ''}
          </p>
          {gateway.features.pagination && (
            <Pagination
              label="Workspace boards pages"
              page={query.pageData.page}
              pageCount={query.pageData.pageCount}
              onChange={control.page}
            />
          )}
        </div>
      )}
    </section>
  );
}
