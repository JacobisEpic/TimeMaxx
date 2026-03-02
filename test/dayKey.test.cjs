const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getLocalDayKey,
  dayKeyToLocalDate,
  shiftDayKey,
} = require('../src/utils/dayKey.ts');

test('getLocalDayKey returns YYYY-MM-DD in local time', () => {
  const date = new Date(2026, 0, 2, 22, 10, 0, 0);
  assert.equal(getLocalDayKey(date), '2026-01-02');
});

test('dayKeyToLocalDate parses valid date', () => {
  const parsed = dayKeyToLocalDate('2024-02-29');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2024);
  assert.equal(parsed.getMonth(), 1);
  assert.equal(parsed.getDate(), 29);
});

test('dayKeyToLocalDate rejects invalid formats and impossible dates', () => {
  assert.equal(dayKeyToLocalDate('2024-2-29'), null);
  assert.equal(dayKeyToLocalDate('2024-13-01'), null);
  assert.equal(dayKeyToLocalDate('2023-02-29'), null);
  assert.equal(dayKeyToLocalDate('not-a-date'), null);
});

test('shiftDayKey shifts across month and year boundaries', () => {
  assert.equal(shiftDayKey('2026-01-31', 1), '2026-02-01');
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDayKey('2024-02-28', 1), '2024-02-29');
});

test('shiftDayKey returns original value for invalid input', () => {
  assert.equal(shiftDayKey('invalid', 2), 'invalid');
});
