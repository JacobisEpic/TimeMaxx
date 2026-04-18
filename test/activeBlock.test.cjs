const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACTIVE_DONE_BLOCK_META_KEY,
  getActiveDoneBlockEffectiveEndMin,
  parseActiveDoneBlockMeta,
  serializeActiveDoneBlockMeta,
} = require('../src/utils/activeBlock.ts');

test('active block meta key is stable', () => {
  assert.equal(ACTIVE_DONE_BLOCK_META_KEY, 'timeline_active_done_block');
});

test('parseActiveDoneBlockMeta accepts valid JSON and rejects invalid values', () => {
  assert.deepEqual(
    parseActiveDoneBlockMeta('{"blockId":"block-1","dayKey":"2026-04-17"}'),
    { blockId: 'block-1', dayKey: '2026-04-17' }
  );

  assert.equal(parseActiveDoneBlockMeta(null), null);
  assert.equal(parseActiveDoneBlockMeta(''), null);
  assert.equal(parseActiveDoneBlockMeta('{"blockId":"","dayKey":"2026-04-17"}'), null);
  assert.equal(parseActiveDoneBlockMeta('{"blockId":"block-1"}'), null);
  assert.equal(parseActiveDoneBlockMeta('bad json'), null);
});

test('serializeActiveDoneBlockMeta round-trips through parseActiveDoneBlockMeta', () => {
  const value = {
    blockId: 'block-2',
    dayKey: '2026-04-17',
  };

  assert.deepEqual(
    parseActiveDoneBlockMeta(serializeActiveDoneBlockMeta(value)),
    value
  );
});

test('getActiveDoneBlockEffectiveEndMin grows with the current minute and respects the stored minimum', () => {
  assert.equal(getActiveDoneBlockEffectiveEndMin(600, 601, 600, true), 601);
  assert.equal(getActiveDoneBlockEffectiveEndMin(600, 601, 645, true), 645);
  assert.equal(getActiveDoneBlockEffectiveEndMin(1439, 1440, 1439, true), 1440);
});

test('getActiveDoneBlockEffectiveEndMin fills to the end of the day for non-current-day active blocks', () => {
  assert.equal(getActiveDoneBlockEffectiveEndMin(600, 601, 645, false), 1440);
});
