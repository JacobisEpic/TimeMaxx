export const CATEGORY_COLORS = {
  work: '#3B82F6',
  health: '#22C55E',
  chores: '#EC4899',
  hobbies: '#8B5CF6',
  break: '#F59E0B',
  other: '#9CA3AF',
} as const;

function withAlpha(hexColor: string, alpha: string): string {
  return `${hexColor}${alpha}`;
}

export function getCategoryColor(tag?: string): string {
  const normalized = tag?.trim().toLowerCase() ?? 'other';
  if (normalized in CATEGORY_COLORS) {
    return CATEGORY_COLORS[normalized as keyof typeof CATEGORY_COLORS];
  }

  return CATEGORY_COLORS.other;
}

export function getCategoryTint(tag?: string): string {
  return withAlpha(getCategoryColor(tag), '1C');
}

export function getCategoryBorder(tag?: string): string {
  return withAlpha(getCategoryColor(tag), '55');
}

export function getCategoryLabel(tag?: string, categoryLabelMap?: Record<string, string>): string {
  const normalized = tag?.trim().toLowerCase() ?? 'other';

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

  return 'None';
}
