import { CheckCircleIcon, CheckSquareIcon } from '../../../components/icons';

interface IllustrationTask {
  title: string;
  label?: string;
  detail?: string;
  progress?: { completed: number; total: number };
  complete?: boolean;
  collaborator?: string;
}

const columns: { title: string; tone: string; tasks: IllustrationTask[] }[] = [
  {
    title: 'To Do',
    tone: 'planned',
    tasks: [
      { title: 'Design landing page', label: 'Design', collaborator: 'AL' },
      { title: 'Write documentation', label: 'Docs' },
      { title: 'Review product brief', detail: 'A clear plan for the team' },
    ],
  },
  {
    title: 'In Progress',
    tone: 'active',
    tasks: [
      { title: 'Build board UI', progress: { completed: 3, total: 5 } },
      { title: 'Refine onboarding', label: 'Frontend' },
    ],
  },
  {
    title: 'Done',
    tone: 'complete',
    tasks: [
      {
        title: 'Set up database',
        detail: 'Project foundation',
        complete: true,
      },
      { title: 'Connect Google', detail: 'Account access', complete: true },
      { title: 'Define card checklists', complete: true },
      { title: 'Add board labels', complete: true },
    ],
  },
];

function TaskCard({
  task,
  floating = false,
}: {
  task: IllustrationTask;
  floating?: boolean;
}) {
  return (
    <div className={`auth-art-task${floating ? ' auth-art-floating' : ''}`}>
      <p className="auth-art-title">{task.title}</p>
      {task.detail && <p className="auth-art-detail">{task.detail}</p>}
      {task.progress && (
        <div className="auth-art-checklist">
          <span>
            <CheckSquareIcon /> {task.progress.completed}/{task.progress.total}
          </span>
          <div className="auth-art-track">
            <span
              style={{
                width: `${(task.progress.completed / task.progress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}
      {task.label && (
        <span
          className={`auth-art-label auth-art-label-${task.label.toLowerCase()}`}
        >
          {task.label}
        </span>
      )}
      {task.complete && <CheckCircleIcon className="auth-art-completed" />}
      {task.collaborator && (
        <span className="auth-art-person">{task.collaborator}</span>
      )}
      {floating && (
        <div className="auth-art-people">
          <span>AL</span>
          <span>JM</span>
          <span>SK</span>
        </div>
      )}
    </div>
  );
}

/** Approved illustrative task content; never live board data or interactive UI. */
export function ForwardTogetherIllustration() {
  return (
    <div className="auth-entry-illustration" aria-hidden="true">
      <div className="auth-art-board">
        {columns.map((column) => (
          <div
            key={column.title}
            className={`auth-art-column auth-art-${column.tone}`}
          >
            <div className="auth-art-column-heading">
              <span className="auth-art-status" />
              <span>{column.title}</span>
              <span className="auth-art-count">{column.tasks.length}</span>
            </div>
            <div className="auth-art-tasks">
              {column.tasks.map((task) => (
                <TaskCard key={task.title} task={task} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <svg
        className="auth-art-path"
        viewBox="0 0 600 350"
        fill="none"
        focusable="false"
      >
        <path
          d="M326 260C442 260 512 233 510 139"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray="8 9"
          strokeLinecap="round"
        />
        <path d="m500 152 10-17 10 17z" fill="currentColor" />
      </svg>
      <TaskCard
        floating
        task={{
          title: 'Real-time board sync',
          progress: { completed: 4, total: 4 },
        }}
      />
      <svg
        className="auth-art-cursor"
        viewBox="0 0 40 44"
        fill="none"
        focusable="false"
      >
        <path
          d="m5 3 29 19-14 3-6 14z"
          fill="var(--auth-art-cursor)"
          stroke="white"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
