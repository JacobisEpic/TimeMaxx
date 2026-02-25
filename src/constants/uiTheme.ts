export const UI_COLORS_LIGHT = {
  appBackground: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F3F5',
  neutralBorder: '#E4E7EC',
  neutralText: '#111827',
  neutralTextSoft: '#6B7280',
  planned: '#3B82F6',
  plannedTint: '#EBF3FF',
  actual: '#10B981',
  actualTint: '#ECFDF5',
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
  neutralBorder: '#232934',
  neutralText: '#F9FAFB',
  neutralTextSoft: '#9CA3AF',
  planned: '#60A5FA',
  plannedTint: '#1E293B',
  actual: '#34D399',
  actualTint: '#052E24',
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
  focus: '#8B5CF6',
  health: '#22C55E',
  meeting: '#0EA5A4',
  break: '#F59E0B',
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
  return withAlpha(getCategoryColor(tag), '22');
}

export function getCategoryBorder(tag?: string): string {
  return withAlpha(getCategoryColor(tag), '55');
}

export function getCategoryLabel(tag?: string): string {
  const normalized = tag?.trim().toLowerCase() ?? 'uncategorized';

  if (normalized === 'work') {
    return 'Work';
  }
  if (normalized === 'focus') {
    return 'Deep Focus';
  }
  if (normalized === 'health') {
    return 'Workout';
  }
  if (normalized === 'meeting') {
    return 'Meeting';
  }
  if (normalized === 'break') {
    return 'Break';
  }
  if (normalized === 'admin') {
    return 'Admin';
  }
  if (normalized === 'personal') {
    return 'Personal';
  }

  return 'Uncategorized';
}
