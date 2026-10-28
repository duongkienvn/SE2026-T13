import { usePageTitle } from '../../../hooks/usePageTitle';
import { useWorkspacePage } from '../components/WorkspaceLayout';

export function WorkspaceOverviewPage() {
  const { overview } = useWorkspacePage();
  usePageTitle(
    overview ? `${overview.workspace.name} · Overview` : 'Workspace overview',
  );
  return (
    <section
      aria-label="Workspace overview"
      className="rounded-xl border border-line bg-surface p-5"
    >
      <h2 className="font-semibold text-ink">Your workspace at a glance</h2>
      <p className="mt-2 text-sm text-muted">
        Accessible boards and workspace updates will appear here when available.
      </p>
    </section>
  );
}
