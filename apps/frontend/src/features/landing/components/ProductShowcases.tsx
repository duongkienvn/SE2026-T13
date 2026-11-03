import { BrandLogo } from '../../../components/Brand';
import {
  CheckSquareIcon,
  PaperclipIcon,
  CommentIcon,
  LinkIcon,
  CalendarIcon,
  UsersIcon,
  CopyIcon,
  ArchiveIcon,
  CheckCircleIcon,
} from '../../../components/icons';

export function PreviewPeople() {
  return (
    <span className="marketing-people">
      <span>
        {['AM', 'SL', 'JK'].map((name) => (
          <i key={name}>{name}</i>
        ))}
        <i>+1</i>
      </span>
      <small>
        <b />4 viewing
      </small>
    </span>
  );
}

export function RealtimeShowcase() {
  return (
    <div
      role="img"
      aria-label="A collaborative Project Sprint board showing four viewers and recent activity"
      data-ui
      className="marketing-realtime"
    >
      <div aria-hidden="true">
        <div className="marketing-live-board">
          <div className="marketing-live-heading">
            <strong>Project Sprint</strong>
            <PreviewPeople />
          </div>
          <div className="marketing-live-column">
            <strong>
              In Progress <small>2</small>
            </strong>
            <div className="marketing-card">
              <strong>Polish Kanban UI</strong>
              <span className="marketing-label tone-1">Frontend</span>
              <span className="marketing-mini-check">
                <CheckSquareIcon />
                2/3
              </span>
            </div>
            <div className="marketing-card">
              <strong>Connect realtime updates</strong>
              <span className="marketing-label tone-0">Feature</span>
            </div>
          </div>
        </div>
        <div className="marketing-activity">
          <strong>Activity</strong>
          {[
            [
              'AM',
              'Alex Morgan',
              'moved Polish Kanban UI to In Progress.',
              '2m ago',
            ],
            ['SL', 'Sam Lee', 'commented on Polish Kanban UI.', '5m ago'],
            [
              'JK',
              'Jordan Kim',
              'updated the due date on Design landing page.',
              '10m ago',
            ],
          ].map(([initials, name, event, time]) => (
            <div className="marketing-event" key={name}>
              <i>{initials}</i>
              <p>
                <b>{name}</b> {event}
                <small>{time}</small>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardDetailShowcase() {
  return (
    <div
      role="img"
      aria-label="Kanvexa Card Detail with checklists, attachments, assignees, labels and dates"
      data-ui
      className="marketing-detail"
    >
      <div aria-hidden="true">
        <div className="marketing-detail-brand">
          <BrandLogo decorative />
          <span>Kanvexa</span>
          <small>
            Boards
            <br />
            Members
          </small>
        </div>
        <div className="marketing-detail-window">
          <div className="marketing-detail-title">
            <strong>Design landing page</strong>
            <LinkIcon />
          </div>
          <div className="marketing-detail-grid">
            <div>
              <strong>Description</strong>
              <p>Create a clear, collaborative home for Kanvexa.</p>
              <strong>
                Checklists <small>2/3 completed</small>
              </strong>
              <div className="marketing-progress">
                <span />
              </div>
              {[
                'Create the wireframe',
                'Design the interface',
                'Review with the team',
              ].map((item, index) => (
                <p className="marketing-check-item" key={item}>
                  <span className={index < 2 ? 'checked' : ''}>
                    {index < 2 ? '✓' : ''}
                  </span>
                  {item}
                </p>
              ))}
              <strong className="marketing-attachment-title">
                <PaperclipIcon />
                Attachments <small>2</small>
              </strong>
              <div className="marketing-attachment-pair">
                <span>
                  design.png<small>1.2 MB</small>
                </span>
                <span>
                  spec.pdf<small>428 KB</small>
                </span>
              </div>
              <strong className="marketing-attachment-title">
                <CommentIcon />
                Comments <small>1</small>
              </strong>
              <p className="marketing-comment">
                AM · Ready for the final review.
              </p>
            </div>
            <div className="marketing-detail-properties">
              <strong>
                <UsersIcon />
                Assignees
              </strong>
              <span className="marketing-detail-assignees">
                <i>AM</i>
              </span>
              <strong>Labels</strong>
              <span className="marketing-label tone-0">Design</span>
              <strong>
                <CalendarIcon />
                Dates
              </strong>
              <span>Start · Nov 4, 09:00</span>
              <span>Due · Nov 19, 17:00</span>
              <span className="marketing-upcoming">Upcoming</span>
              <strong>Actions</strong>
              <span>
                <CopyIcon />
                Duplicate
              </span>
              <span>
                <LinkIcon />
                Copy link
              </span>
              <span>
                <ArchiveIcon />
                Archive
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkflowPreview({
  name,
  tasks,
}: {
  name: string;
  tasks: string[];
}) {
  return (
    <div
      role="img"
      aria-label={`${name} Kanban workflow illustration`}
      data-ui
      className="marketing-workflow"
    >
      <div aria-hidden="true">
        <strong>{name}</strong>
        <div>
          {['To Do', 'In Progress', 'Done'].map((column, index) => (
            <section key={column}>
              <b>{column}</b>
              <span>{tasks[index]}</span>
              <i className={`tone-${index}`} />
              <span>
                {
                  [
                    'Plan the next step',
                    'Keep things moving',
                    'Ready to share',
                  ][index]
                }
              </span>
              <i className={`tone-${index}`} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BenefitList({ items }: { items: string[] }) {
  return (
    <ul className="landing-benefits">
      {items.map((item) => (
        <li key={item}>
          <CheckCircleIcon />
          {item}
        </li>
      ))}
    </ul>
  );
}
