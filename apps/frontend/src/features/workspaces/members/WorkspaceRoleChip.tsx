import type { WorkspaceRole } from '@kanban/shared';

/** Workspace ADMIN/MEMBER only; Board OWNER/MEMBER keep their own RoleChip. */
export function WorkspaceRoleChip({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap ${
        role === 'ADMIN'
          ? 'bg-[#e4edfe] text-[#1458c9] dark:bg-[#172e4f] dark:text-[#8bbcf7]'
          : 'bg-[#e3f6ea] text-[#1c7a43] dark:bg-[#173a28] dark:text-[#86d8a6]'
      }`}
    >
      {role === 'ADMIN' ? 'Admin' : 'Member'}
    </span>
  );
}
