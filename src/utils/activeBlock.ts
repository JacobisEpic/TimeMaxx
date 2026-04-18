import { clamp } from './time';

const MINUTES_PER_DAY = 24 * 60;

export const ACTIVE_DONE_BLOCK_META_KEY = 'timeline_active_done_block';

export type ActiveDoneBlockMeta = {
  blockId: string;
  dayKey: string;
};

export function parseActiveDoneBlockMeta(rawValue: string | null): ActiveDoneBlockMeta | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const blockId = String((parsed as { blockId?: unknown }).blockId ?? '').trim();
    const dayKey = String((parsed as { dayKey?: unknown }).dayKey ?? '').trim();

    if (!blockId || !dayKey) {
      return null;
    }

    return {
      blockId,
      dayKey,
    };
  } catch {
    return null;
  }
}

export function serializeActiveDoneBlockMeta(value: ActiveDoneBlockMeta): string {
  return JSON.stringify(value);
}

export function getActiveDoneBlockEffectiveEndMin(
  startMin: number,
  storedEndMin: number,
  nowMinute: number,
  isCurrentDay: boolean
): number {
  const minimumEndMin = clamp(
    Math.max(startMin + 1, storedEndMin),
    startMin + 1,
    MINUTES_PER_DAY
  );

  if (!isCurrentDay) {
    return MINUTES_PER_DAY;
  }

  return clamp(
    Math.max(minimumEndMin, nowMinute),
    startMin + 1,
    MINUTES_PER_DAY
  );
}
