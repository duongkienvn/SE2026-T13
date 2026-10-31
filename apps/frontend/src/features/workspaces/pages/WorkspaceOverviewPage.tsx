import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceSummaryCards } from '../components/WorkspaceSummaryCards';
import { RecentWorkspaceBoards } from '../components/RecentWorkspaceBoards';
import { WorkspaceActivity } from '../components/WorkspaceActivity';

export function WorkspaceOverviewPage() {
  const { overview, state } = useWorkspacePage();
  usePageTitle(
    overview ? `${overview.workspace.name} · Overview` : 'Workspace overview',
  );
  return (
    <div className="space-y-5">
      <WorkspaceSummaryCards overview={overview} state={state} />
      <div className="grid items-start gap-4 md:grid-cols-2">
        <RecentWorkspaceBoards overview={overview} state={state} />
        <WorkspaceActivity state={state} />
      </div>
    </div>
  );
}
