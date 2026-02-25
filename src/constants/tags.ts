export const TAG_CATALOG = ['work', 'focus', 'health', 'break', 'personal'] as const;

export type CanonicalTag = (typeof TAG_CATALOG)[number];

export const DEFAULT_TAG_COLOR = '#E2E8F0';

const TAG_COLORS: Record<CanonicalTag, string> = {
  work: '#CBD5E1',
  focus: '#D1D5DB',
  health: '#BBF7D0',
  break: '#FDE68A',
  personal: '#E5E7EB',
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
