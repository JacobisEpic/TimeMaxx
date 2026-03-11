const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRepeatDayKeys, normalizeRepeatRule } = require('../src/utils/recurrence.ts');

test('daily repeat with interval uses inclusive end date', () => {
  const rule = {
    preset: 'daily',
    interval: 2,
    weekDays: [4],
    monthlyMode: 'dayOfMonth',
    endMode: 'onDate',
    endDayKey: '2026-01-07',
    occurrenceCount: 10,
  };
  const result = buildRepeatDayKeys('2026-01-01', rule);

  assert.equal(result.truncated, false);
  assert.deepEqual(result.dayKeys, ['2026-01-01', '2026-01-03', '2026-01-05', '2026-01-07']);
});

test('weekly repeat supports multiple selected weekdays', () => {
  const rule = {
    preset: 'weekly',
    interval: 1,
    weekDays: [1, 3, 5],
    monthlyMode: 'dayOfMonth',
    endMode: 'onDate',
    endDayKey: '2026-03-20',
    occurrenceCount: 20,
  };
  const result = buildRepeatDayKeys('2026-03-11', rule);

  assert.deepEqual(result.dayKeys, ['2026-03-11', '2026-03-13', '2026-03-16', '2026-03-18', '2026-03-20']);
});

test('monthly day-of-month repeat clamps to last day for shorter months', () => {
  const rule = {
    preset: 'monthly',
    interval: 1,
    weekDays: [6],
    monthlyMode: 'dayOfMonth',
    endMode: 'onDate',
    endDayKey: '2026-04-30',
    occurrenceCount: 10,
  };
  const result = buildRepeatDayKeys('2026-01-31', rule);

  assert.deepEqual(result.dayKeys, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('monthly ordinal repeat supports last weekday', () => {
  const rule = {
    preset: 'monthly',
    interval: 1,
    weekDays: [1],
    monthlyMode: 'ordinalWeekday',
    endMode: 'onDate',
    endDayKey: '2026-03-31',
    occurrenceCount: 10,
  };
  const result = buildRepeatDayKeys('2026-01-26', rule);

  assert.deepEqual(result.dayKeys, ['2026-01-26', '2026-02-23', '2026-03-30']);
});

test('after-count mode stops after N occurrences', () => {
  const rule = {
    preset: 'weekly',
    interval: 1,
    weekDays: [1, 3],
    monthlyMode: 'dayOfMonth',
    endMode: 'afterCount',
    endDayKey: '2026-12-31',
    occurrenceCount: 4,
  };
  const result = buildRepeatDayKeys('2026-03-11', rule);

  assert.equal(result.truncated, false);
  assert.deepEqual(result.dayKeys, ['2026-03-11', '2026-03-16', '2026-03-18', '2026-03-23']);
});

test('never mode is capped to one-year rolling window', () => {
  const rule = {
    preset: 'daily',
    interval: 1,
    weekDays: [4],
    monthlyMode: 'dayOfMonth',
    endMode: 'never',
    endDayKey: '2026-01-01',
    occurrenceCount: 100,
  };
  const result = buildRepeatDayKeys('2026-01-01', rule);

  assert.equal(result.truncated, true);
  assert.equal(result.dayKeys.length, 366);
  assert.equal(result.dayKeys[0], '2026-01-01');
  assert.equal(result.dayKeys[result.dayKeys.length - 1], '2027-01-01');
});

test('normalizeRepeatRule clamps invalid values', () => {
  const normalized = normalizeRepeatRule(
    {
      preset: 'weekly',
      interval: -20,
      weekDays: [20, -1],
      monthlyMode: 'ordinalWeekday',
      endMode: 'afterCount',
      endDayKey: 'bad-input',
      occurrenceCount: 0,
    },
    '2026-03-11'
  );

  assert.equal(normalized.interval, 1);
  assert.deepEqual(normalized.weekDays, [3]);
  assert.equal(normalized.occurrenceCount, 1);
  assert.equal(normalized.endDayKey, '2026-03-11');
});
