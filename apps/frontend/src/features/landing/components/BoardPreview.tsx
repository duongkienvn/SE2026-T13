import { BrandLogo } from '../../../components/Brand';
import {
  ActivityIcon,
  ClockIcon,
  FolderIcon,
  MonitorIcon,
  PlusIcon,
  UsersIcon,
} from '../../../components/icons';

interface PreviewCard {
  title: string;
  description?: string;
  due?: string;
  assignees: string[];
}

interface PreviewColumn {
  name: string;
  cards: PreviewCard[];
  /** Hidden on phones, where two readable columns beat three tiny ones. */
  wideOnly?: boolean;
}

// Only fields a real Kanvexa card has: title, description, due date, assignees.
const COLUMNS: PreviewColumn[] = [
  {
    name: 'To Do',
    cards: [
      {
        title: 'Design landing page',
        description: 'Hero, features and a clear call to action.',
        due: 'Nov 4',
        assignees: ['AL'],
      },
      { title: 'Plan Q1 roadmap', due: 'Nov 12', assignees: ['GH', 'AT'] },
    ],
  },
  {
    name: 'In Progress',
    cards: [
      {
        title: 'Build board UI',
        description: 'Columns, cards and drag and drop.',
        due: 'Oct 30',
        assignees: ['GH'],
      },
      {
        title: 'Real-time board sync',
        assignees: ['AT', 'AL'],
      },
    ],
  },
  {
    name: 'Done',
    wideOnly: true,
    cards: [
      { title: 'Set up database', due: 'Oct 21', assignees: ['AT'] },
      {
        title: 'Write documentation',
        description: 'Setup guide for the team.',
        assignees: ['AL', 'GH'],
      },
    ],
  },
];

const PRESENCE = [
  'bg-primary-soft text-primary',
  'bg-[#e7f6ee] text-success',
  'bg-[#fdeedd] text-[#b45309]',
];

function Initials({ value, className }: { value: string; className: string }) {
  return (
    <span
      className={`grid size-5 place-items-center rounded-full text-[8px] font-semibold ring-2 ring-surface ${className}`}
    >
      {value}
    </span>
  );
}

function MiniCard({ card }: { card: PreviewCard }) {
  return (
    <div className="rounded-lg bg-surface p-2.5 shadow-card">
      {card.due && (
        <p className="flex items-center justify-end gap-1 text-[9px] text-muted">
          <ClockIcon className="size-2.5" />
          {card.due}
        </p>
      )}
      <p className="text-[11px] leading-snug font-semibold text-ink">
        {card.title}
      </p>
      {card.description && (
        <p className="mt-0.5 text-[10px] leading-snug text-muted">
          {card.description}
        </p>
      )}
      <div className="mt-1.5 flex justify-end -space-x-0.5">
        {card.assignees.map((initials) => (
          <Initials
            key={initials}
            value={initials}
            className="bg-primary-soft text-primary"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A coded miniature of the real board screen, so it stays sharp and honest:
 * nothing here is a feature Kanvexa does not have.
 */
export function BoardPreview({ className = '' }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Preview of a Kanvexa board with To Do, In Progress and Done columns of cards"
      className={`overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-[0_32px_80px_-24px_rgb(97_92_247/0.45)] ${className}`}
    >
      <div aria-hidden="true" className="flex">
        <div className="hidden w-28 shrink-0 border-r border-line/80 p-3 sm:block">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <BrandLogo decorative className="size-5" />
            Kanvexa
          </div>
          <p className="mt-4 flex items-center gap-1.5 rounded-md bg-primary-soft px-2 py-1.5 text-[10px] font-medium text-primary">
            <FolderIcon className="size-3" />
            Boards
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 border-b border-line/80 px-3 py-2.5">
            <span className="grid size-6 place-items-center rounded-md bg-primary-soft text-primary">
              <MonitorIcon className="size-3.5" />
            </span>
            <p className="truncate text-[12px] font-semibold text-ink">
              Website Launch
            </p>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-1 hidden -space-x-0.5 sm:flex">
                {['AL', 'GH', 'AT'].map((initials, index) => (
                  <Initials
                    key={initials}
                    value={initials}
                    className={PRESENCE[index]}
                  />
                ))}
              </span>
              <span className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[9px] font-medium text-ink">
                <UsersIcon className="size-2.5" />
                Members
              </span>
              <span className="flex items-center gap-1 rounded-md border border-line px-1.5 py-1 text-[9px] font-medium text-ink">
                <ActivityIcon className="size-2.5" />
                Activity
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 bg-app p-3 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div
                key={column.name}
                className={`flex-col gap-2 rounded-xl bg-[#eceef6] p-2 ${column.wideOnly ? 'hidden sm:flex' : 'flex'}`}
              >
                <p className="px-0.5 text-[11px] font-semibold text-ink">
                  {column.name}{' '}
                  <span className="font-normal text-muted">
                    {column.cards.length}
                  </span>
                </p>
                {column.cards.map((card) => (
                  <MiniCard key={card.title} card={card} />
                ))}
                <p className="flex items-center gap-1 px-0.5 text-[10px] text-muted">
                  <PlusIcon className="size-2.5" />
                  New card
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
