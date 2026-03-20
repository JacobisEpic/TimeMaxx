import { useColorScheme } from '@/hooks/use-color-scheme';

export {
  CATEGORY_COLORS,
  getCategoryBorder,
  getCategoryColor,
  getCategoryLabel,
  getCategoryTint,
} from '@/src/constants/categoryTheme';

export const UI_COLORS_LIGHT = {
  appBackground: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F3F5',
  glassSurface: 'rgba(255, 255, 255, 0.62)',
  glassSurfaceStrong: 'rgba(255, 255, 255, 0.76)',
  glassStroke: 'rgba(255, 255, 255, 0.72)',
  glassStrokeSoft: 'rgba(148, 163, 184, 0.28)',
  glassHighlight: 'rgba(255, 255, 255, 0.65)',
  neutralBorder: '#E4E7EC',
  neutralText: '#111827',
  neutralTextSoft: '#6B7280',
  planned: '#3B82F6',
  plannedTint: '#EBF3FF',
  done: '#10B981',
  doneTint: '#ECFDF5',
  accent: '#6366F1',
  accentTint: '#EEF2FF',
  warmStart: '#111827',
  warmEnd: '#111827',
  overlay: 'rgba(15, 23, 42, 0.24)',
} as const;

export const UI_COLORS_DARK = {
  appBackground: '#0B0D11',
  surface: '#12151B',
  surfaceMuted: '#181C23',
  glassSurface: 'rgba(28, 33, 43, 0.62)',
  glassSurfaceStrong: 'rgba(28, 33, 43, 0.76)',
  glassStroke: 'rgba(148, 163, 184, 0.3)',
  glassStrokeSoft: 'rgba(148, 163, 184, 0.2)',
  glassHighlight: 'rgba(255, 255, 255, 0.12)',
  neutralBorder: '#232934',
  neutralText: '#F9FAFB',
  neutralTextSoft: '#9CA3AF',
  planned: '#60A5FA',
  plannedTint: '#1E293B',
  done: '#34D399',
  doneTint: '#052E24',
  accent: '#818CF8',
  accentTint: '#1E1B4B',
  warmStart: '#F9FAFB',
  warmEnd: '#F9FAFB',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export const UI_COLORS = UI_COLORS_LIGHT;
export type UIColors = Record<keyof typeof UI_COLORS_LIGHT, string>;

export function getUIColors(colorScheme?: 'light' | 'dark' | null): UIColors {
  return colorScheme === 'dark' ? UI_COLORS_DARK : UI_COLORS_LIGHT;
}

export function useUIColors(): UIColors {
  return getUIColors(useColorScheme());
}

export const UI_RADIUS = {
  sheet: 22,
  card: 10,
  control: 16,
} as const;

export const UI_TYPE = {
  title: 30,
  section: 18,
  value: 32,
  body: 14,
  caption: 12,
} as const;
