import type { BoardRole } from '@kanban/shared';

const ROLE_STYLES: Record<BoardRole, { label: string; className: string }> = {
  OWNER: {
    label: 'Owner',
    className:
      'bg-[#ebeafe] text-[#4840ee] dark:bg-[#2a2860] dark:text-[#b3afff]',
  },
  MEMBER: {
    label: 'Member',
    className:
      'bg-[#e4edfe] text-[#1458c9] dark:bg-[#172e4f] dark:text-[#8bbcf7]',
  },
};

/** OWNER/MEMBER badge styled after the role chips in boards.png and team-members.png. */
export function RoleChip({ role }: { role: BoardRole }) {
  const { label, className } = ROLE_STYLES[role];
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}
