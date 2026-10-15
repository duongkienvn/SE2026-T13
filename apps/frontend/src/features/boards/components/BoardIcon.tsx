import type { ComponentType } from 'react';
import {
  BarChartIcon,
  BriefcaseIcon,
  MegaphoneIcon,
  MonitorIcon,
  UsersIcon,
  type IconProps,
} from '../../../components/icons';

/*
 * Boards have no icon or color field. To match boards.png, each board gets one
 * of the five design tile styles, derived deterministically from its id.
 * Purely decorative: it carries no meaning.
 */
const TILE_STYLES: { icon: ComponentType<IconProps>; className: string }[] = [
  { icon: MonitorIcon, className: 'bg-[#edebfe] text-[#4f46e5]' },
  { icon: MegaphoneIcon, className: 'bg-[#e0edfd] text-[#1d6fd8]' },
  { icon: UsersIcon, className: 'bg-[#ebf8ed] text-[#4a9a45]' },
  { icon: BarChartIcon, className: 'bg-[#fcf6e4] text-[#e5a502]' },
  { icon: BriefcaseIcon, className: 'bg-[#fce7e8] text-[#dc2626]' },
];

export function boardTileIndex(boardId: string): number {
  let hash = 0;
  for (const char of boardId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % TILE_STYLES.length;
}

export function BoardIcon({
  boardId,
  className = 'size-16 rounded-xl text-[32px]',
}: {
  boardId: string;
  className?: string;
}) {
  const { icon: Icon, className: tile } = TILE_STYLES[boardTileIndex(boardId)];
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${tile} ${className}`}
    >
      <Icon />
    </span>
  );
}
