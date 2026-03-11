const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeExecutionScoreSummary,
  isExcludedFromExecutionMetrics,
} = require('../src/utils/executionScore.ts');

test('isExcludedFromExecutionMetrics excludes none, other, and break', () => {
  assert.equal(isExcludedFromExecutionMetrics({ tags: ['none'] }), true);
  assert.equal(isExcludedFromExecutionMetrics({ tags: ['other'] }), true);
  assert.equal(isExcludedFromExecutionMetrics({ tags: ['break'] }), true);
  assert.equal(isExcludedFromExecutionMetrics({ tags: ['work'] }), false);
});

test('computeExecutionScoreSummary subtracts only excess break time', () => {
  const summary = computeExecutionScoreSummary([
    { lane: 'planned', tags: ['work'], startMin: 9 * 60, endMin: 11 * 60 },
    { lane: 'actual', tags: ['work'], startMin: 9 * 60, endMin: 11 * 60 },
    { lane: 'planned', tags: ['break'], startMin: 12 * 60, endMin: 12 * 60 + 30 },
    { lane: 'actual', tags: ['break'], startMin: 12 * 60, endMin: 13 * 60 },
  ]);

  assert.equal(summary.plannedMinutes, 120);
  assert.equal(summary.doneMinutes, 120);
  assert.equal(summary.breakPlannedMinutes, 30);
  assert.equal(summary.breakDoneMinutes, 60);
  assert.equal(summary.breakPenaltyMinutes, 30);
  assert.equal(summary.executionDoneMinutes, 90);
  assert.equal(summary.scorePercent, 75);
});

test('computeExecutionScoreSummary returns null score when productive planned time is zero', () => {
  const summary = computeExecutionScoreSummary([
    { lane: 'actual', tags: ['break'], startMin: 12 * 60, endMin: 13 * 60 },
    { lane: 'actual', tags: ['other'], startMin: 14 * 60, endMin: 15 * 60 },
  ]);

  assert.equal(summary.plannedMinutes, 0);
  assert.equal(summary.doneMinutes, 0);
  assert.equal(summary.breakPenaltyMinutes, 60);
  assert.equal(summary.executionDoneMinutes, -60);
  assert.equal(summary.scorePercent, null);
});

test('computeExecutionScoreSummary allows negative score from unplanned break', () => {
  const summary = computeExecutionScoreSummary([
    { lane: 'planned', tags: ['work'], startMin: 9 * 60, endMin: 11 * 60 },
    { lane: 'actual', tags: ['break'], startMin: 12 * 60, endMin: 12 * 60 + 30 },
  ]);

  assert.equal(summary.plannedMinutes, 120);
  assert.equal(summary.doneMinutes, 0);
  assert.equal(summary.breakPenaltyMinutes, 30);
  assert.equal(summary.executionDoneMinutes, -30);
  assert.equal(summary.scorePercent, -25);
});
