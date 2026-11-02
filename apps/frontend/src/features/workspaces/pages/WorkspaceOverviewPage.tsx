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
      <div className="grid items-stretch gap-4 lg:grid-cols-[1.2fr_minmax(0,1fr)]">
        <RecentWorkspaceBoards overview={overview} state={state} />
        <WorkspaceActivity state={state} />
      </div>
    </div>
  );
}
