export const TAG_CATALOG = [
  'work',
  'health',
  'chores',
  'hobbies',
  'break',
  'other',
] as const;

export type CanonicalTag = (typeof TAG_CATALOG)[number];

export const DEFAULT_TAG_COLOR = '#9CA3AF';

const TAG_COLORS: Record<CanonicalTag, string> = {
  work: '#3B82F6',
  health: '#22C55E',
  chores: '#EC4899',
  hobbies: '#8B5CF6',
  break: '#F59E0B',
  other: '#9CA3AF',
};

export function getTagColor(tag?: string): string {
  if (!tag) {
    return DEFAULT_TAG_COLOR;
  }

  const normalized = tag.trim().toLowerCase();

  if (normalized in TAG_COLORS) {
    return TAG_COLORS[normalized as CanonicalTag];
  }

  return DEFAULT_TAG_COLOR;
}
