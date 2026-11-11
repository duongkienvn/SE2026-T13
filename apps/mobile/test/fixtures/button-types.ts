import { createElement } from 'react';
import { View } from 'react-native';
import type { ButtonProps } from '../../src/ui/controls';

export const iconButton: ButtonProps = {
  variant: 'icon',
  label: 'Open options',
  icon: createElement(View),
  onPress: () => {},
};
// @ts-expect-error Icon buttons must not render without an icon.
export const missingIcon: ButtonProps = {
  variant: 'icon',
  label: 'Open options',
  onPress: () => {},
};
