const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clamp,
  roundTo15,
  parseHHMM,
  formatHHMM,
  formatDuration,
} = require('../src/utils/time.ts');

test('clamp keeps value in range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('roundTo15 rounds to nearest quarter hour', () => {
  assert.equal(roundTo15(7), 0);
  assert.equal(roundTo15(8), 15);
  assert.equal(roundTo15(22), 15);
  assert.equal(roundTo15(23), 30);
});

test('parseHHMM parses valid values and rejects invalid values', () => {
  assert.equal(parseHHMM('00:00'), 0);
  assert.equal(parseHHMM('9:05'), 545);
  assert.equal(parseHHMM('23:59'), 1439);
  assert.equal(parseHHMM('24:00'), 1440);

  assert.equal(parseHHMM('24:01'), null);
  assert.equal(parseHHMM('99:00'), null);
  assert.equal(parseHHMM('12:60'), null);
  assert.equal(parseHHMM('bad'), null);
});

test('formatHHMM clamps and formats output', () => {
  assert.equal(formatHHMM(0), '00:00');
  assert.equal(formatHHMM(545), '09:05');
  assert.equal(formatHHMM(1439), '23:59');
  assert.equal(formatHHMM(1440), '24:00');
  assert.equal(formatHHMM(1500), '24:00');
  assert.equal(formatHHMM(-5), '00:00');
});

test('formatDuration formats minutes into human readable text', () => {
  assert.equal(formatDuration(5), '5m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(61), '1h 1m');
  assert.equal(formatDuration(-90), '1h 30m');
});
