import type { TaskCardSummary } from '@kanban/shared';
import { Link } from 'react-router';
import {
  ArrowRightIcon,
  CheckSquareIcon,
  ColumnsIcon,
  LayersIcon,
} from '../../../components/icons';
import { Pagination } from '../../../components/Pagination';
import { formatInstantDate } from '../../settings/format';
import type { DateFormat } from '../../settings/types';
import { usePagedList } from './paging';

export const UP_NEXT_PAGE_SIZE = 4;

/** Badge text comes only from the server's due group, never a client recount. */
const badges: Partial<Record<TaskCardSummary['group'], string>> = {
  OVERDUE: 'Overdue',
  NEXT_7_DAYS: 'Due soon',
};

export function UpNext({
  tasks,
  assignedCount,
  dateFormat,
  timeZone,
}: {
  tasks: TaskCardSummary[];
  assignedCount: number;
  dateFormat: DateFormat;
  timeZone: string;
}) {
  const paged = usePagedList(tasks, UP_NEXT_PAGE_SIZE);
  return (
    <section aria-labelledby="home-up-next" className="home-section">
      <div className="home-section-head">
        <h2 id="home-up-next">Up Next</h2>
        <Link to="/my-tasks" className="home-view-all">
          View all <span className="sr-only">tasks</span>
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </div>
      {tasks.length === 0 ? (
        <div className="home-panel home-empty">
          <span className="home-empty-icon" aria-hidden="true">
            <CheckSquareIcon />
          </span>
          {assignedCount === 0 ? (
            <>
              <h3>No assigned cards yet</h3>
              <p>Cards assigned to you will appear here.</p>
              <Link to="/boards" className="home-link">
                Browse boards
              </Link>
            </>
          ) : (
            <>
              <h3>Nothing due</h3>
              <p>Your assigned cards have no due dates.</p>
              <Link to="/my-tasks" className="home-link">
                Open My Tasks
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="home-panel home-task-list">
            {paged.visible.map((task) => {
              const badge = badges[task.group];
              const due = task.dueDate
                ? formatInstantDate(new Date(task.dueDate), dateFormat, timeZone)
                : undefined;
              return (
                <li key={task.id}>
                  <Link
                    to={task.permalink}
                    className="home-task"
                    data-group={task.group}
                  >
                    <span className="home-task-marker" aria-hidden="true" />
                    <span className="home-task-body">
                      <span className="home-task-title">{task.title}</span>
                      <span className="home-task-context">
                        <span>
                          <ColumnsIcon aria-hidden="true" />
                          <span className="sr-only">Board: </span>
                          {task.boardName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          <LayersIcon aria-hidden="true" />
                          <span className="sr-only">Workspace: </span>
                          {task.workspaceName}
                        </span>
                      </span>
                    </span>
                    <span className="home-task-due">
                      {badge && <span className="home-badge">{badge}</span>}
                      {due && (
                        <time dateTime={task.dueDate ?? undefined}>
                          <span className="sr-only">Due </span>
                          {due}
                        </time>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination
            label="Up Next pages"
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={paged.setPage}
            className="home-pager"
          />
        </>
      )}
    </section>
  );
}
