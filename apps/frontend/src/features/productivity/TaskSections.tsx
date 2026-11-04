import type {
  TaskCardSummary,
  TaskGroup,
  TaskGroupCounts,
} from '@kanban/shared';
import { Link } from 'react-router';
import { CalendarIcon, ColumnsIcon, LayersIcon } from '../../components/icons';
import { formatInstantDate } from '../settings/format';
import { taskGroups } from './task-groups';

export function TaskSections({
  tasks,
  counts,
  group,
  dateFormat,
  timeZone,
}: {
  tasks: TaskCardSummary[];
  counts: TaskGroupCounts;
  group: TaskGroup | 'ALL';
  dateFormat: Parameters<typeof formatInstantDate>[1];
  timeZone: string;
}) {
  return (
    <div className="my-tasks-sections">
      {taskGroups
        .filter(
          (item) =>
            (group === 'ALL' || group === item.id) &&
            tasks.some((task) => task.group === item.id),
        )
        .map(({ id, label, Icon }) => (
          <section
            key={id}
            aria-labelledby={`task-${id}`}
            className="my-tasks-group"
            data-tone={id}
          >
            <h2 id={`task-${id}`} className="my-tasks-group-heading">
              <Icon />{' '}
              <span>
                {label} ({counts[id]})
              </span>
            </h2>
            <ul>
              {tasks
                .filter((task) => task.group === id)
                .map((task) => (
                  <li key={task.id}>
                    <Link to={task.permalink} className="my-tasks-row">
                      <span className="my-tasks-row-content">
                        <span className="my-tasks-title">{task.title}</span>
                        <span className="my-tasks-context">
                          <span>
                            <ColumnsIcon />
                            {task.boardName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            <LayersIcon />
                            {task.workspaceName}
                          </span>
                        </span>
                        {task.labels.length > 0 && (
                          <span className="my-tasks-labels">
                            {task.labels.slice(0, 5).map((label) => (
                              <span
                                key={label.id}
                                className="my-tasks-label"
                                style={{
                                  borderColor: label.color,
                                  backgroundColor: `color-mix(in srgb, ${label.color} 9%, var(--color-surface))`,
                                }}
                              >
                                {label.name}
                              </span>
                            ))}
                            {task.labels.length > 5 && (
                              <span className="text-xs text-muted">
                                +{task.labels.length - 5}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      {task.dueDate ? (
                        <time dateTime={task.dueDate} className="my-tasks-due">
                          <CalendarIcon />
                          {task.group === 'OVERDUE' && (
                            <span className="sr-only">Overdue: </span>
                          )}
                          {formatInstantDate(
                            new Date(task.dueDate),
                            dateFormat,
                            timeZone,
                          )}
                        </time>
                      ) : (
                        <span className="my-tasks-due">
                          <CalendarIcon />
                          No due date
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
