import type { Block } from '@/src/types/blocks';

type BlockLike = Pick<Block, 'lane' | 'tags' | 'startMin' | 'endMin'>;

const BREAK_CATEGORY_ID = 'break';
const EXCLUDED_CATEGORY_IDS = new Set(['none', 'other']);

function getCategoryId(block: Pick<Block, 'tags'>): string {
  return block.tags[0]?.trim().toLowerCase() || 'uncategorized';
}

function isBreakCategory(block: Pick<Block, 'tags'>): boolean {
  return getCategoryId(block) === BREAK_CATEGORY_ID;
}

function isNeutralCategory(block: Pick<Block, 'tags'>): boolean {
  return EXCLUDED_CATEGORY_IDS.has(getCategoryId(block));
}

export function isExcludedFromExecutionMetrics(block: Pick<Block, 'tags'>): boolean {
  return isNeutralCategory(block) || isBreakCategory(block);
}

export type ExecutionScoreSummary = {
  plannedMinutes: number;
  doneMinutes: number;
  breakPlannedMinutes: number;
  breakDoneMinutes: number;
  breakPenaltyMinutes: number;
  executionDoneMinutes: number;
  scorePercent: number | null;
};

export function computeExecutionScoreSummary(blocks: BlockLike[]): ExecutionScoreSummary {
  let plannedMinutes = 0;
  let doneMinutes = 0;
  let breakPlannedMinutes = 0;
  let breakDoneMinutes = 0;

  for (const block of blocks) {
    const duration = Math.max(0, block.endMin - block.startMin);
    if (duration <= 0 || isNeutralCategory(block)) {
      continue;
    }

    if (isBreakCategory(block)) {
      if (block.lane === 'planned') {
        breakPlannedMinutes += duration;
      } else {
        breakDoneMinutes += duration;
      }
      continue;
    }

    if (block.lane === 'planned') {
      plannedMinutes += duration;
    } else {
      doneMinutes += duration;
    }
  }

  const breakPenaltyMinutes = Math.max(0, breakDoneMinutes - breakPlannedMinutes);
  const executionDoneMinutes = doneMinutes - breakPenaltyMinutes;
  const scorePercent =
    plannedMinutes > 0 ? Math.round((executionDoneMinutes / plannedMinutes) * 100) : null;

  return {
    plannedMinutes,
    doneMinutes,
    breakPlannedMinutes,
    breakDoneMinutes,
    breakPenaltyMinutes,
    executionDoneMinutes,
    scorePercent,
  };
}
