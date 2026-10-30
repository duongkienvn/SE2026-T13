import {
  BriefcaseIcon,
  CodeIcon,
  LayersIcon,
  PaletteIcon,
  UsersIcon,
  type IconProps,
} from '../../../components/icons';
import type { WorkspaceIcon } from './api';

export const WORKSPACE_ICON_LABELS: Record<WorkspaceIcon, string> = {
  briefcase: 'Briefcase',
  users: 'People',
  code: 'Code',
  palette: 'Palette',
  layers: 'Layers',
};

const GLYPHS = {
  briefcase: BriefcaseIcon,
  users: UsersIcon,
  code: CodeIcon,
  palette: PaletteIcon,
  layers: LayersIcon,
} satisfies Record<WorkspaceIcon, (props: IconProps) => React.JSX.Element>;

export function WorkspaceIconGlyph({
  icon,
  ...props
}: IconProps & { icon: WorkspaceIcon }) {
  const Glyph = GLYPHS[icon];
  return <Glyph {...props} />;
}
