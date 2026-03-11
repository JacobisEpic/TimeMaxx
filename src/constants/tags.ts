// Primary categories match app defaults; legacy tags remain for older data.
export const TAG_CATALOG = [
  'work',
  'health',
  'chores',
  'hobbies',
  'break',
  'other',
  'focus',
  'meeting',
  'personal',
  'admin',
] as const;

export type CanonicalTag = (typeof TAG_CATALOG)[number];

export const DEFAULT_TAG_COLOR = '#E2E8F0';

const TAG_COLORS: Record<CanonicalTag, string> = {
  work: '#3B82F6',
  health: '#22C55E',
  chores: '#EC4899',
  hobbies: '#8B5CF6',
  break: '#F59E0B',
  other: '#9CA3AF',
  focus: '#8B5CF6',
  meeting: '#0EA5A4',
  personal: '#14B8A6',
  admin: '#94A3B8',
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
