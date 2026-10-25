import type { ComponentType, ReactNode } from 'react';
import { BrandLogo } from '../../../components/Brand';
import {
  BarChartIcon,
  ClockIcon,
  FolderIcon,
  MegaphoneIcon,
  MonitorIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  type IconProps,
} from '../../../components/icons';

// Tile and role colors mirror BoardIcon and RoleChip at miniature size.
const ROLE = {
  Owner: 'bg-[#ebeafe] text-[#4840ee]',
  Member: 'bg-[#e4edfe] text-[#1458c9]',
};

const BOARDS: {
  name: string;
  role: keyof typeof ROLE;
  updated: string;
  description: string;
  Icon: ComponentType<IconProps>;
  tile: string;
}[] = [
  {
    name: 'Product Roadmap',
    role: 'Owner',
    updated: '2 hours ago',
    description: 'Plan and track product work.',
    Icon: MonitorIcon,
    tile: 'bg-[#edebfe] text-[#4f46e5]',
  },
  {
    name: 'Marketing',
    role: 'Member',
    updated: 'yesterday',
    description: 'Campaigns across all channels.',
    Icon: MegaphoneIcon,
    tile: 'bg-[#e0edfd] text-[#1d6fd8]',
  },
  {
    name: 'Design Team',
    role: 'Member',
    updated: '3 days ago',
    description: 'Requests and upcoming work.',
    Icon: UsersIcon,
    tile: 'bg-[#ebf8ed] text-[#4a9a45]',
  },
  {
    name: 'Q1 Planning',
    role: 'Owner',
    updated: 'last week',
    description: 'Goals and key results.',
    Icon: BarChartIcon,
    tile: 'bg-[#fcf6e4] text-[#e5a502]',
  },
];

const MEMBERS: { initials: string; name: string; role: keyof typeof ROLE }[] = [
  { initials: 'AM', name: 'Alex Morgan', role: 'Owner' },
  { initials: 'SL', name: 'Sam Lee', role: 'Member' },
  { initials: 'JK', name: 'Jordan Kim', role: 'Member' },
];

function Window({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-[0_28px_70px_-28px_rgb(97_92_247/0.45)] ${className}`}
    >
      <div className="hidden w-24 shrink-0 border-r border-line/80 p-2.5 sm:block">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-ink">
          <BrandLogo decorative className="size-4" />
          Kanvexa
        </div>
        <p className="mt-3 flex items-center gap-1 rounded-md bg-primary-soft px-1.5 py-1 text-[9px] font-medium text-primary">
          <FolderIcon className="size-2.5" />
          Boards
        </p>
      </div>
      <div className="min-w-0 flex-1 bg-app p-3">{children}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: keyof typeof ROLE }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[8px] font-medium ${ROLE[role]}`}
    >
      {role}
    </span>
  );
}

/**
 * Two layered miniatures of real screens: Board members behind, Boards in
 * front. Behind-window is desktop only so phones get one readable preview.
 */
export function ShowcasePreview() {
  return (
    <div
      role="img"
      aria-label="Preview of the Kanvexa boards list in front of a board's members page"
      className="relative lg:pt-28"
    >
      <div aria-hidden="true">
        <Window className="absolute top-0 left-0 hidden w-[70%] opacity-90 lg:flex lg:[transform:perspective(1600px)_rotateY(10deg)]">
          <p className="text-[12px] font-semibold text-ink">Board members</p>
          <ul className="mt-2 space-y-1.5">
            {MEMBERS.map((member) => (
              <li
                key={member.name}
                className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 shadow-card"
              >
                <span className="grid size-5 place-items-center rounded-full bg-primary-soft text-[8px] font-semibold text-primary">
                  {member.initials}
                </span>
                <span className="text-[10px] font-medium text-ink">
                  {member.name}
                </span>
                <span className="ml-auto">
                  <RoleBadge role={member.role} />
                </span>
              </li>
            ))}
          </ul>
        </Window>

        <Window className="relative lg:ml-auto lg:w-[86%] lg:[transform:perspective(1600px)_rotateY(10deg)]">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-ink">Boards</p>
            <span className="ml-auto hidden items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[9px] text-muted sm:flex">
              <SearchIcon className="size-2.5" />
              Search boards…
            </span>
            <span className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[9px] font-medium text-white">
              <PlusIcon className="size-2.5" />
              New Board
            </span>
          </div>
          <ul className="mt-2.5 grid grid-cols-2 gap-2">
            {BOARDS.map((board) => (
              <li
                key={board.name}
                className="rounded-lg bg-surface p-2 shadow-card"
              >
                <div className="flex items-start gap-1.5">
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-md text-[12px] ${board.tile}`}
                  >
                    <board.Icon />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold text-ink">
                      {board.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[8px] text-muted">
                      <RoleBadge role={board.role} />
                      <span className="flex items-center gap-0.5">
                        <ClockIcon className="size-2" />
                        {board.updated}
                      </span>
                    </p>
                  </div>
                </div>
                <p className="mt-1.5 truncate text-[9px] text-muted">
                  {board.description}
                </p>
              </li>
            ))}
          </ul>
        </Window>
      </div>
    </div>
  );
}
