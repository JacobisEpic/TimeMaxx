import type { Block, Lane } from '@/src/types/blocks';

export const FIRST_LAUNCH_SEED_META_KEY = 'bootstrap_first_launch_seed_state';

export type FirstLaunchSeedReason = 'seeded_sample' | 'existing_data';

type SeedBlockInput = Omit<Block, 'id'>;

function minutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function createSeedBlock(
  lane: Lane,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  title: string,
  tag: string
): SeedBlockInput {
  return {
    lane,
    startMin: minutes(startHour, startMinute),
    endMin: minutes(endHour, endMinute),
    title,
    tags: [tag],
  };
}

const FIRST_LAUNCH_SAMPLE_BLOCKS: readonly SeedBlockInput[] = [
  createSeedBlock('planned', 7, 30, 8, 30, 'Morning Routine', 'health'),
  createSeedBlock('planned', 9, 0, 11, 30, 'Deep Work', 'work'),
  createSeedBlock('planned', 12, 0, 12, 45, 'Lunch', 'break'),
  createSeedBlock('planned', 13, 0, 15, 0, 'Project Review', 'work'),
  createSeedBlock('planned', 18, 0, 19, 0, 'Workout', 'health'),
  createSeedBlock('planned', 22, 0, 23, 0, 'Wind Down', 'hobbies'),
  createSeedBlock('done', 7, 30, 8, 15, 'Phone Scroll', 'other'),
  createSeedBlock('done', 9, 30, 11, 0, 'Deep Work', 'work'),
  createSeedBlock('done', 12, 30, 13, 15, 'Late Lunch', 'break'),
  createSeedBlock('done', 13, 30, 14, 30, 'Admin', 'chores'),
  createSeedBlock('done', 18, 15, 19, 15, 'Workout', 'health'),
  createSeedBlock('done', 21, 30, 22, 30, 'TV', 'hobbies'),
];

export function buildFirstLaunchSampleBlocks(): SeedBlockInput[] {
  return FIRST_LAUNCH_SAMPLE_BLOCKS.map((block) => ({
    ...block,
    tags: [...block.tags],
  }));
}

export function createFirstLaunchSeedState(
  reason: FirstLaunchSeedReason,
  seededDayKey: string | null
): string {
  return JSON.stringify({
    status: 'handled',
    reason,
    seededDayKey,
  });
}
