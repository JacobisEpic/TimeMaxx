import { clearAllBlocks as clearAllBlocksInDb, initDb, insertBlock } from '@/src/storage/blocksDb';
import type { Block, Lane } from '@/src/types/blocks';
import { getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';

const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 15;

type SeedBlockInput = Omit<Block, 'id'>;

type HashState = {
  value: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo15(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

function hashString(input: string): number {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function nextHash(state: HashState): number {
  state.value = Math.imul(state.value ^ 0x9e3779b9, 1597334677) >>> 0;
  return state.value;
}

function deterministicUuid(dayKey: string, salt: string): string {
  const state: HashState = { value: hashString(`${dayKey}:${salt}`) };
  const bytes: number[] = [];

  while (bytes.length < 16) {
    const value = nextHash(state);
    bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  const uuidBytes = bytes.slice(0, 16);
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  const hex = uuidBytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function addLaneBlock(
  laneBlocks: SeedBlockInput[],
  lane: Lane,
  title: string,
  tags: string[],
  startMin: number,
  endMin: number
): void {
  const snappedStart = roundTo15(startMin);
  const snappedEnd = roundTo15(endMin);
  const clampedStart = clamp(snappedStart, 0, MINUTES_PER_DAY - SNAP_MINUTES);
  const clampedEnd = clamp(snappedEnd, SNAP_MINUTES, MINUTES_PER_DAY);

  if (clampedEnd <= clampedStart) {
    return;
  }

  const hasOverlap = laneBlocks.some((block) => {
    if (block.lane !== lane) {
      return false;
    }

    return rangesOverlap(clampedStart, clampedEnd, block.startMin, block.endMin);
  });

  if (hasOverlap) {
    return;
  }

  laneBlocks.push({
    lane,
    title,
    tags,
    startMin: clampedStart,
    endMin: clampedEnd,
  });
}

function buildSeedBlocksForDay(dayKey: string): SeedBlockInput[] {
  const hash = hashString(dayKey);
  const blocks: SeedBlockInput[] = [];

  const plannedFocusStart = 9 * 60 + (((hash % 3) - 1) * 15);
  const plannedAdminStart = 13 * 60 + ((hash % 4) * 15);
  const plannedWorkoutStart = 17 * 60 + 30;

  addLaneBlock(blocks, 'planned', 'Morning Focus', ['work', 'focus'], plannedFocusStart, plannedFocusStart + 120);
  addLaneBlock(blocks, 'planned', 'Admin and Misc', ['admin'], plannedAdminStart, plannedAdminStart + 45);
  addLaneBlock(blocks, 'planned', 'Workout', ['health'], plannedWorkoutStart, plannedWorkoutStart + 60);

  const focusShift = ((((hash >>> 3) % 5) - 2) * 15);
  let actualFocusDuration = 120;

  if (hash % 5 === 0) {
    actualFocusDuration = 90;
  } else if (hash % 7 === 0) {
    actualFocusDuration = 150;
  }

  const actualFocusStart = plannedFocusStart + focusShift;
  addLaneBlock(
    blocks,
    'actual',
    'Morning Focus',
    ['work', 'focus'],
    actualFocusStart,
    actualFocusStart + actualFocusDuration
  );

  const actualAdminShift = ((((hash >>> 6) % 3) - 1) * 15);
  const actualAdminDuration = hash % 6 === 0 ? 30 : 45;
  const actualAdminStart = plannedAdminStart + actualAdminShift;

  addLaneBlock(
    blocks,
    'actual',
    'Admin and Misc',
    ['admin'],
    actualAdminStart,
    actualAdminStart + actualAdminDuration
  );

  const missesWorkout = hash % 4 === 0;

  if (!missesWorkout) {
    const workoutShift = ((((hash >>> 8) % 3) - 1) * 15);
    const workoutDuration = hash % 9 === 0 ? 45 : 60;
    const actualWorkoutStart = plannedWorkoutStart + workoutShift;

    addLaneBlock(
      blocks,
      'actual',
      'Workout',
      ['health'],
      actualWorkoutStart,
      actualWorkoutStart + workoutDuration
    );
  }

  const hasLateNightWork = hash % 6 === 0;

  if (hasLateNightWork) {
    addLaneBlock(blocks, 'actual', 'Late Work', ['work'], 21 * 60 + 30, 22 * 60 + 30);
  }

  const overperformed = hash % 8 === 0;

  if (overperformed) {
    addLaneBlock(blocks, 'actual', 'Deep Work', ['work', 'focus'], 19 * 60 + 30, 20 * 60 + 30);
  }

  const underperformed = hash % 10 === 0;

  if (underperformed) {
    addLaneBlock(blocks, 'actual', 'Break', ['break'], 15 * 60, 15 * 60 + 30);
  }

  return blocks;
}

export async function clearAllBlocks(): Promise<void> {
  await initDb();
  await clearAllBlocksInDb();
}

export async function seedLastNDays(n: number): Promise<void> {
  await initDb();

  const safeDays = Math.max(0, Math.floor(n));
  const todayKey = getLocalDayKey();

  for (let offset = 0; offset < safeDays; offset += 1) {
    const dayKey = shiftDayKey(todayKey, -offset);
    const blocksForDay = buildSeedBlocksForDay(dayKey);

    for (let i = 0; i < blocksForDay.length; i += 1) {
      const input = blocksForDay[i];
      await insertBlock({ ...input, id: deterministicUuid(dayKey, `seed-${i}`) }, dayKey);
    }
  }
}
