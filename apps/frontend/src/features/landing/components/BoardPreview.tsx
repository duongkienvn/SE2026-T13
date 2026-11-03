import { BrandLogo } from '../../../components/Brand';
import {
  ColumnsIcon,
  HomeIcon,
  CheckSquareIcon,
  StarIcon,
  LayersIcon,
  UsersIcon,
  SlidersIcon,
  SearchIcon,
  LockIcon,
} from '../../../components/icons';
import { PreviewPeople } from './ProductShowcases';

const columns = [
  {
    name: 'To Do',
    cards: [
      { title: 'Design landing page', label: 'Design', due: 'Nov 19' },
      { title: 'Write release notes', label: 'Docs', due: 'Nov 6' },
    ],
  },
  {
    name: 'In Progress',
    cards: [
      { title: 'Polish Kanban UI', label: 'Frontend', due: 'Nov 5' },
      { title: 'Connect realtime updates', label: 'Feature', due: 'Nov 7' },
    ],
  },
  {
    name: 'Done',
    cards: [
      { title: 'Build card checklists', label: 'Feature', due: 'Nov 1' },
      { title: 'Add labels & dates', label: 'Design', due: 'Nov 2' },
    ],
  },
];

/** Static, representative product artwork. Its controls are not interactive. */
export function BoardPreview({ className = '' }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Preview of a Kanvexa board with To Do, In Progress and Done columns of cards"
      data-ui
      className={`marketing-board ${className}`}
    >
      <div aria-hidden="true" className="marketing-board-inner">
        <div className="marketing-sidebar">
          <div className="marketing-brand">
            <BrandLogo decorative /> Kanvexa
          </div>
          <div className="marketing-workspace">
            <LayersIcon />
            <span>
              Personal Workspace<small>Personal workspace</small>
            </span>
          </div>
          <div className="marketing-nav">
            <span>
              <HomeIcon />
              Home
            </span>
            <span>
              <CheckSquareIcon />
              My Tasks
            </span>
            <span className="selected">
              <ColumnsIcon />
              Boards
            </span>
            <span>
              <StarIcon />
              Starred
            </span>
          </div>
          <small>WORKSPACES</small>
          <span className="marketing-space">
            <LayersIcon /> Product Team
          </span>
          <span className="marketing-space">
            <UsersIcon /> Design Team
          </span>
          <span className="marketing-account">
            <i>AM</i> Alex Morgan
          </span>
        </div>
        <div className="marketing-board-main">
          <div className="marketing-breadcrumb">
            Personal Workspace <span>›</span> Boards <span>›</span> Project
            Sprint
          </div>
          <div className="marketing-board-heading">
            <strong>
              Project Sprint <StarIcon />
            </strong>
            <span className="marketing-role">Owner</span>
            <span className="marketing-privacy">
              <LockIcon />
              Private
            </span>
            <PreviewPeople />
          </div>
          <div className="marketing-tabs">
            <span className="selected">Kanban</span>
            <span>Members</span>
            <span>Activity</span>
            <span>Board settings</span>
          </div>
          <div className="marketing-canvas">
            <div className="marketing-filter">
              <span>
                <SlidersIcon />
                Filter
              </span>
              <SearchIcon />
            </div>
            <div className="marketing-columns">
              {columns.map((column, index) => (
                <div className="marketing-column" key={column.name}>
                  <div className="marketing-column-heading">
                    {column.name}
                    <span>{column.cards.length}</span>
                  </div>
                  {column.cards.map((card) => (
                    <div className="marketing-card" key={card.title}>
                      <strong>{card.title}</strong>
                      <span className={`marketing-label tone-${index}`}>
                        {card.label}
                      </span>
                      <div className="marketing-card-meta">
                        <span>{card.due}</span>
                        <i>{index === 0 ? 'AM' : index === 1 ? 'SL' : 'JK'}</i>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
