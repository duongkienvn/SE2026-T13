import {
  ActivityIcon,
  ColumnsIcon,
  LayersIcon,
  UsersIcon,
} from '../../../components/icons';
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
      accent: 'bg-primary-soft text-primary',
    },
    {
      label: 'Members',
      value: overview?.memberCount,
      icon: UsersIcon,
      accent: 'bg-primary-soft text-primary',
    },
    {
      label: 'Active this week',
      value: null,
      icon: ActivityIcon,
      accent: 'bg-success/10 text-success',
    },
    {
      label: 'Total cards',
      value: null,
      icon: LayersIcon,
      accent: 'bg-primary-soft text-primary',
    },
  ];
  return (
    <section aria-label="Workspace summary">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-5"
          >
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-full ${accent}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col">
              <dt className="order-2 mt-1 text-xs leading-relaxed text-muted">
                {label}
              </dt>
              <dd className="text-xl font-semibold tracking-tight text-ink">
                {value != null ? (
                  value
                ) : (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">
                      {state === 'loading' &&
                      label !== 'Active this week' &&
                      label !== 'Total cards'
                        ? 'Loading'
                        : 'Unavailable'}
                    </span>
                  </>
                )}
              </dd>
              {value == null && (
                <span
                  aria-hidden="true"
                  className="order-3 mt-1 text-[11px] text-muted"
                >
                  {state === 'loading' &&
                  label !== 'Active this week' &&
                  label !== 'Total cards'
                    ? 'Loading…'
                    : 'Unavailable'}
                </span>
              )}
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
