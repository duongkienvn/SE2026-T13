import { ColumnsIcon, UsersIcon } from '../../../components/icons';
import type { WorkspaceOverview, WorkspaceViewState } from '../types';

export function WorkspaceSummaryCards({
  overview,
  state,
}: {
  overview?: WorkspaceOverview;
  state: WorkspaceViewState;
}) {
  const metrics = [
    {
      label: 'Visible boards',
      value: overview?.visibleBoardCount,
      icon: ColumnsIcon,
      hint: 'Boards you can access',
      tone: 'workspace-metric',
    },
    {
      label: 'Members',
      value: overview?.memberCount,
      icon: UsersIcon,
      hint: 'People in this workspace',
      tone: 'workspace-metric-members',
    },
  ];
  return (
    <section aria-label="Workspace summary">
      <dl className="grid gap-3 sm:grid-cols-2">
        {metrics.map(({ label, value, icon: Icon, hint, tone }) => (
          <div
            key={label}
            className={`${tone} flex min-w-0 items-center gap-4 rounded-xl border border-line p-4 shadow-card`}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col">
              <dt className="order-2 text-sm leading-relaxed font-semibold text-ink">
                {label}
              </dt>
              <dd className="text-2xl leading-7 font-bold tracking-tight text-ink tabular-nums">
                {value != null ? (
                  value
                ) : (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">
                      {state === 'loading' ? 'Loading' : 'Unavailable'}
                    </span>
                  </>
                )}
              </dd>
              <span className="order-3 mt-0.5 text-xs text-muted">{hint}</span>
              {value == null && (
                <span
                  aria-hidden="true"
                  className="order-4 mt-1 text-xs text-muted"
                >
                  {state === 'loading' ? 'Loading…' : 'Unavailable'}
                </span>
              )}
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
