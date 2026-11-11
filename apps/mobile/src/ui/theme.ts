import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import {
  palettes,
  resolveTheme,
  type ThemeColors,
  type ThemeMode,
} from './tokens';
export * from './tokens';

export const ThemeContext = createContext<ThemeMode>('system');
export function useTheme(): ThemeColors {
  const mode = useContext(ThemeContext);
  const system = useColorScheme();
  return palettes[resolveTheme(mode, system)];
}
