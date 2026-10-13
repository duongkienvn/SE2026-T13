import type { BoardRole } from '@kanban/shared';

const ROLE_STYLES: Record<BoardRole, { label: string; className: string }> = {
  OWNER: { label: 'Owner', className: 'bg-[#ebeafe] text-[#4840ee]' },
  MEMBER: { label: 'Member', className: 'bg-[#e4edfe] text-[#1458c9]' },
};

/** OWNER/MEMBER badge styled after the role chips in boards.png and team-members.png. */
export function RoleChip({ role }: { role: BoardRole }) {
  const { label, className } = ROLE_STYLES[role];
  return (
    <span
      className={`inline-flex h-8 items-center rounded-full px-3.5 text-[15px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}
