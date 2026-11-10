import type { ColorSchemeName } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;
export const radius = {
  small: 8,
  control: 12,
  card: 16,
  surface: 24,
  pill: 999,
} as const;
export const sizes = {
  iconSmall: 16,
  icon: 20,
  iconLarge: 24,
  touch: 48,
  contentMax: 640,
} as const;
export const typography = {
  display: { fontSize: 28, lineHeight: 35, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '700' },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  strong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  supporting: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
} as const;

export const palettes = {
  light: {
    primary: '#615CF7',
    primaryPressed: '#4F46E5',
    primaryTint: '#F0EEFF',
    primaryBorder: '#DCD9FF',
    background: '#F8F9FE',
    surface: '#FFFFFF',
    surfaceSoft: '#F5F5FC',
    text: '#171A35',
    textSecondary: '#515A78',
    textMuted: '#626B89',
    border: '#D5D9E8',
    success: '#087762',
    warning: '#865100',
    danger: '#B42332',
    info: '#175CC4',
    onPrimary: '#FFFFFF',
    overlay: 'rgba(15,20,48,0.48)',
    focus: '#4038D5',
  },
  dark: {
    primary: '#A9A5FF',
    primaryPressed: '#C3C0FF',
    primaryTint: '#302D58',
    primaryBorder: '#7772C7',
    background: '#121426',
    surface: '#1D2035',
    surfaceSoft: '#282B42',
    text: '#F4F4FF',
    textSecondary: '#C1C5DE',
    textMuted: '#AEB4D0',
    border: '#656B88',
    success: '#73DDC4',
    warning: '#FFD083',
    danger: '#FFABB2',
    info: '#9AC3FF',
    onPrimary: '#17133E',
    overlay: 'rgba(0,0,0,0.72)',
    focus: '#C8C5FF',
  },
} as const;
export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColors = { [K in keyof typeof palettes.light]: string };
export function resolveTheme(
  mode: ThemeMode,
  system: ColorSchemeName | null,
): 'light' | 'dark' {
  return mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
}
