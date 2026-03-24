const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFirstLaunchSampleDay,
  buildFirstLaunchSampleBlocks,
  createFirstLaunchSeedState,
  FIRST_LAUNCH_SEED_META_KEY,
} = require('../src/storage/firstLaunchSeed.ts');

function hasLaneOverlap(blocks) {
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title)
  );

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startMin < sorted[index - 1].endMin) {
      return true;
    }
  }

  return false;
}

test('first-launch sample blocks cover both lanes without overlaps', () => {
  const blocks = buildFirstLaunchSampleBlocks();
  const plannedBlocks = blocks.filter((block) => block.lane === 'planned');
  const doneBlocks = blocks.filter((block) => block.lane === 'done');

  assert.equal(FIRST_LAUNCH_SEED_META_KEY, 'bootstrap_first_launch_seed_state');
  assert.equal(plannedBlocks.length, 6);
  assert.equal(doneBlocks.length, 6);
  assert.equal(hasLaneOverlap(plannedBlocks), false);
  assert.equal(hasLaneOverlap(doneBlocks), false);

  for (const block of blocks) {
    assert.ok(block.title.length > 0);
    assert.ok(block.startMin >= 0);
    assert.ok(block.endMin <= 24 * 60);
    assert.ok(block.endMin > block.startMin);
    assert.equal(block.tags.length, 1);
  }
});

test('first-launch sample links related done blocks back to plan blocks', () => {
  const sampleDay = buildFirstLaunchSampleDay();
  const plannedTitles = new Set(sampleDay.planned.map((block) => block.title));
  const linkedDoneBlocks = sampleDay.done
    .filter((block) => block.linkedPlannedTitle)
    .map((block) => [block.title, block.linkedPlannedTitle]);

  assert.deepEqual(linkedDoneBlocks, [
    ['Deep Work', 'Deep Work'],
    ['Late Lunch', 'Lunch'],
    ['Workout', 'Workout'],
    ['TV', 'Wind Down'],
  ]);

  for (const [, linkedPlannedTitle] of linkedDoneBlocks) {
    assert.equal(plannedTitles.has(linkedPlannedTitle), true);
  }
});

test('first-launch seed state serialization is explicit', () => {
  const state = JSON.parse(createFirstLaunchSeedState('seeded_sample', '2026-03-18'));

  assert.deepEqual(state, {
    status: 'handled',
    reason: 'seeded_sample',
    seededDayKey: '2026-03-18',
  });
});
