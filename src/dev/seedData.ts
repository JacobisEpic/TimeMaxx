import { clearAllBlocks as clearAllBlocksInDb, initDb, insertBlock } from '@/src/storage/blocksDb';
import type { Block, Lane } from '@/src/types/blocks';
import { getLocalDayKey, shiftDayKey } from '@/src/utils/dayKey';

const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 15;

type SeedBlockInput = Block;
type PlannedKey =
  | 'work_morning'
  | 'work_afternoon'
  | 'health'
  | 'hobbies'
  | 'break_lunch'
  | 'break_afternoon'
  | 'none_buffer';

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
  id: string,
  lane: Lane,
  title: string,
  tags: string[],
  startMin: number,
  endMin: number,
  linkedPlannedId: string | null = null
): boolean {
  const snappedStart = roundTo15(startMin);
  const snappedEnd = roundTo15(endMin);
  const clampedStart = clamp(snappedStart, 0, MINUTES_PER_DAY - SNAP_MINUTES);
  const clampedEnd = clamp(snappedEnd, SNAP_MINUTES, MINUTES_PER_DAY);

  if (clampedEnd <= clampedStart) {
    return false;
  }

  const hasOverlap = laneBlocks.some((block) => {
    if (block.lane !== lane) {
      return false;
    }

    return rangesOverlap(clampedStart, clampedEnd, block.startMin, block.endMin);
  });

  if (hasOverlap) {
    return false;
  }

  laneBlocks.push({
    id,
    lane,
    title,
    tags,
    startMin: clampedStart,
    endMin: clampedEnd,
    linkedPlannedId: lane === 'actual' ? linkedPlannedId : undefined,
  });
  return true;
}

function buildSeedBlocksForDay(dayKey: string): SeedBlockInput[] {
  const hash = hashString(dayKey);
  const blocks: SeedBlockInput[] = [];
  const plannedIdByKey = new Map<PlannedKey, string>();
  let actualIndex = 0;

  const plannedWorkMorningStart = 8 * 60 + (((hash % 3) - 1) * 15);
  const plannedBreakLunchStart = 12 * 60 + (((hash >>> 3) % 3) - 1) * 15;
  const plannedWorkAfternoonStart = 13 * 60 + 30 + (((hash >>> 5) % 3) - 1) * 15;
  const plannedBreakAfternoonStart = 16 * 60 + (((hash >>> 7) % 3) - 1) * 15;
  const plannedHealthStart = 18 * 60 + (((hash >>> 9) % 3) - 1) * 15;
  const plannedHobbiesStart = 20 * 60 + (((hash >>> 11) % 3) - 1) * 15;
  const plannedNoneBufferStart = 22 * 60 + (((hash >>> 13) % 2) * 15);

  const addPlanned = (
    key: PlannedKey,
    title: string,
    tags: string[],
    startMin: number,
    endMin: number
  ) => {
    const plannedId = deterministicUuid(dayKey, `planned-${key}`);
    const added = addLaneBlock(blocks, plannedId, 'planned', title, tags, startMin, endMin);
    if (added) {
      plannedIdByKey.set(key, plannedId);
    }
  };

  const addActual = (
    title: string,
    tags: string[],
    startMin: number,
    endMin: number,
    plannedKey: PlannedKey | null = null
  ) => {
    const actualId = deterministicUuid(dayKey, `actual-${actualIndex}`);
    actualIndex += 1;
    addLaneBlock(
      blocks,
      actualId,
      'actual',
      title,
      tags,
      startMin,
      endMin,
      plannedKey ? plannedIdByKey.get(plannedKey) ?? null : null
    );
  };

  addPlanned(
    'work_morning',
    'Morning Work Block',
    ['work'],
    plannedWorkMorningStart,
    plannedWorkMorningStart + 120
  );
  addPlanned(
    'break_lunch',
    'Lunch Break',
    ['break'],
    plannedBreakLunchStart,
    plannedBreakLunchStart + 45
  );
  addPlanned(
    'work_afternoon',
    'Afternoon Work Block',
    ['work'],
    plannedWorkAfternoonStart,
    plannedWorkAfternoonStart + 120
  );
  addPlanned(
    'break_afternoon',
    'Afternoon Break',
    ['break'],
    plannedBreakAfternoonStart,
    plannedBreakAfternoonStart + 30
  );
  addPlanned('health', 'Workout', ['health'], plannedHealthStart, plannedHealthStart + 60);
  addPlanned('hobbies', 'Hobby Time', ['hobbies'], plannedHobbiesStart, plannedHobbiesStart + 60);
  addPlanned(
    'none_buffer',
    'Unstructured Buffer',
    ['other'],
    plannedNoneBufferStart,
    plannedNoneBufferStart + 30
  );

  const scenario = hash % 6;
  const workShift = (((hash >>> 2) % 5) - 2) * 15;
  const breakShift = (((hash >>> 6) % 3) - 1) * 15;
  const healthShift = (((hash >>> 8) % 3) - 1) * 15;
  const hobbiesShift = (((hash >>> 10) % 3) - 1) * 15;

  if (scenario === 0) {
    addActual('Morning Work Sprint', ['work'], plannedWorkMorningStart + workShift, plannedWorkMorningStart + workShift + 105, 'work_morning');
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 45, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift, plannedWorkAfternoonStart + workShift + 120, 'work_afternoon');
    addActual('Afternoon Recharge', ['break'], plannedBreakAfternoonStart + breakShift, plannedBreakAfternoonStart + breakShift + 30, 'break_afternoon');
    addActual('Workout', ['health'], plannedHealthStart + healthShift, plannedHealthStart + healthShift + 60, 'health');
    addActual('Gaming', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 60, 'hobbies');
    addActual('Inbox Cleanup', ['other'], 22 * 60 + 30, 23 * 60, 'none_buffer');
  } else if (scenario === 1) {
    addActual('Morning Work Sprint', ['work'], plannedWorkMorningStart + workShift, plannedWorkMorningStart + workShift + 90, 'work_morning');
    addActual('Client Follow-up', ['work'], 10 * 60 + 45, 11 * 60 + 15, null);
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 30, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift + 15, plannedWorkAfternoonStart + workShift + 120, 'work_afternoon');
    addActual('Walk', ['health'], plannedHealthStart + healthShift, plannedHealthStart + healthShift + 45, 'health');
    addActual('Music Practice', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 45, 'hobbies');
    addActual('Unplanned Errands', ['other'], 21 * 60, 21 * 60 + 30, null);
  } else if (scenario === 2) {
    addActual('Morning Work Sprint 1', ['work'], plannedWorkMorningStart + workShift, plannedWorkMorningStart + workShift + 60, 'work_morning');
    addActual('Morning Work Sprint 2', ['work'], plannedWorkMorningStart + workShift + 75, plannedWorkMorningStart + workShift + 135, 'work_morning');
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 45, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift, plannedWorkAfternoonStart + workShift + 90, 'work_afternoon');
    addActual('Stretch Break', ['break'], plannedBreakAfternoonStart + breakShift, plannedBreakAfternoonStart + breakShift + 15, 'break_afternoon');
    addActual('Workout', ['health'], plannedHealthStart + healthShift + 15, plannedHealthStart + healthShift + 75, 'health');
    addActual('Crafting', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 75, 'hobbies');
  } else if (scenario === 3) {
    addActual('Morning Work Marathon', ['work'], plannedWorkMorningStart - 15, plannedWorkMorningStart + 150, 'work_morning');
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 30, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift + 30, plannedWorkAfternoonStart + workShift + 120, 'work_afternoon');
    addActual('Afternoon Recharge', ['break'], plannedBreakAfternoonStart + breakShift, plannedBreakAfternoonStart + breakShift + 30, 'break_afternoon');
    addActual('Run', ['health'], plannedHealthStart + healthShift - 15, plannedHealthStart + healthShift + 30, 'health');
    addActual('Reading', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 45, 'hobbies');
    addActual('Loose End Tasks', ['other'], 22 * 60 + 15, 22 * 60 + 45, 'none_buffer');
  } else if (scenario === 4) {
    addActual('Morning Work Sprint', ['work'], plannedWorkMorningStart + workShift + 15, plannedWorkMorningStart + workShift + 90, 'work_morning');
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 45, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift, plannedWorkAfternoonStart + workShift + 105, 'work_afternoon');
    addActual('Workout Warmup', ['health'], plannedHealthStart + healthShift - 15, plannedHealthStart + healthShift + 15, 'health');
    addActual('Workout Main', ['health'], plannedHealthStart + healthShift + 15, plannedHealthStart + healthShift + 60, 'health');
    addActual('Hobby Jam', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 60, 'hobbies');
    addActual('Unplanned Buffer', ['other'], 23 * 60, 23 * 60 + 30, null);
  } else {
    addActual('Morning Work Sprint', ['work'], plannedWorkMorningStart + workShift, plannedWorkMorningStart + workShift + 75, 'work_morning');
    addActual('Extra Work Catch-up', ['work'], 11 * 60 + 15, 11 * 60 + 45, null);
    addActual('Lunch Break', ['break'], plannedBreakLunchStart + breakShift, plannedBreakLunchStart + breakShift + 45, 'break_lunch');
    addActual('Afternoon Work Sprint', ['work'], plannedWorkAfternoonStart + workShift + 15, plannedWorkAfternoonStart + workShift + 120, 'work_afternoon');
    addActual('Afternoon Break', ['break'], plannedBreakAfternoonStart + breakShift, plannedBreakAfternoonStart + breakShift + 30, 'break_afternoon');
    addActual('Mobility Session', ['health'], plannedHealthStart + healthShift, plannedHealthStart + healthShift + 45, 'health');
    addActual('Creative Project', ['hobbies'], plannedHobbiesStart + hobbiesShift, plannedHobbiesStart + hobbiesShift + 60, 'hobbies');
    addActual('Unstructured Buffer', ['other'], plannedNoneBufferStart, plannedNoneBufferStart + 30, 'none_buffer');
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
      await insertBlock(input, dayKey);
    }
  }
}
