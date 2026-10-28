import { Link, Outlet, useOutletContext, useParams } from 'react-router';
import { ChevronRightIcon } from '../../../components/icons';
import { useWorkspaceOverview } from '../hooks';
import { workspacePath } from '../navigation';
import { WorkspaceIdentity } from './WorkspaceIdentity';
import { WorkspaceSections } from './WorkspaceSections';
import { WorkspaceState } from './WorkspaceState';

type WorkspaceContext = ReturnType<typeof useWorkspaceOverview>;
export function useWorkspacePage() {
  return useOutletContext<WorkspaceContext>();
}

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams();
  const query = useWorkspaceOverview(workspaceId);
  const workspace = query.overview?.workspace;
  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-7">
      <nav aria-label="Workspace breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-6 text-muted">
          <li>
            <Link
              className="rounded hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              to="/workspaces"
            >
              Workspaces
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRightIcon className="size-3.5" />
          </li>
          <li className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
            {workspace ? (
              <Link
                to={workspacePath(workspaceId)}
                className="rounded hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                {workspace.name}
              </Link>
            ) : (
              'Workspace'
            )}
          </li>
          <li aria-hidden="true">
            <ChevronRightIcon className="size-3.5" />
          </li>
          <li aria-current="page" className="font-medium text-ink">
            Overview
          </li>
        </ol>
      </nav>
      <WorkspaceIdentity
        workspace={workspace}
        memberCount={query.overview?.memberCount}
        loading={query.state === 'loading'}
      />
      <WorkspaceSections workspaceId={workspaceId} />
      <div className="mt-5 space-y-5">
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
        <Outlet context={query satisfies WorkspaceContext} />
      </div>
    </div>
  );
}
