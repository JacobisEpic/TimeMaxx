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

export const CATEGORY_COLORS = {
  work: '#3B82F6',
  health: '#22C55E',
  chores: '#EC4899',
  hobbies: '#8B5CF6',
  break: '#F59E0B',
  other: '#9CA3AF',
  // Legacy tags are kept for older imported/sample data.
  focus: '#8B5CF6',
  meeting: '#0EA5A4',
  admin: '#94A3B8',
  personal: '#14B8A6',
  uncategorized: '#94A3B8',
} as const;

function withAlpha(hexColor: string, alpha: string): string {
  return `${hexColor}${alpha}`;
}

export function getCategoryColor(tag?: string): string {
  const normalized = tag?.trim().toLowerCase() ?? 'uncategorized';
  if (normalized in CATEGORY_COLORS) {
    return CATEGORY_COLORS[normalized as keyof typeof CATEGORY_COLORS];
  }

  return CATEGORY_COLORS.uncategorized;
}

export function getCategoryTint(tag?: string): string {
  return withAlpha(getCategoryColor(tag), '1C');
}

export function getCategoryBorder(tag?: string): string {
  return withAlpha(getCategoryColor(tag), '55');
}

export function getCategoryLabel(tag?: string, categoryLabelMap?: Record<string, string>): string {
  const normalized = tag?.trim().toLowerCase() ?? 'uncategorized';

  const configuredLabel = categoryLabelMap?.[normalized]?.trim();
  if (configuredLabel) {
    return configuredLabel;
  }

  if (normalized === 'work') {
    return 'Work';
  }
  if (normalized === 'health') {
    return 'Health';
  }
  if (normalized === 'chores') {
    return 'Chores';
  }
  if (normalized === 'hobbies') {
    return 'Hobbies';
  }
  if (normalized === 'break') {
    return 'Break';
  }
  if (normalized === 'other') {
    return 'None';
  }
  if (normalized === 'focus') {
    return 'Deep Focus';
  }
  if (normalized === 'meeting') {
    return 'Meeting';
  }
  if (normalized === 'personal') {
    return 'Personal';
  }
  if (normalized === 'admin') {
    return 'Admin';
  }

  return 'Uncategorized';
}
