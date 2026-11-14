import { Image, type ImageSourcePropType } from 'react-native';
import briefcase from '../../../assets/workspace-icons/briefcase.png';
import users from '../../../assets/workspace-icons/users.png';
import code from '../../../assets/workspace-icons/code.png';
import palette from '../../../assets/workspace-icons/palette.png';
import layers from '../../../assets/workspace-icons/layers.png';
import { useTheme } from '../../ui';
import type { WorkspaceSummary } from './decoder';

const glyphs: Record<
  NonNullable<WorkspaceSummary['icon']>,
  ImageSourcePropType
> = {
  briefcase,
  users,
  code,
  palette,
  layers,
};

export function WorkspaceGlyph({
  icon,
  decorative = false,
}: {
  icon: NonNullable<WorkspaceSummary['icon']>;
  decorative?: boolean;
}) {
  const c = useTheme();
  return (
    <Image
      source={glyphs[icon]}
      accessibilityLabel={decorative ? undefined : `Workspace icon: ${icon}`}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no' : 'auto'}
      style={{ width: 24, height: 24, tintColor: c.focus }}
    />
  );
}
