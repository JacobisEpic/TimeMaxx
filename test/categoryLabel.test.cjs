const test = require('node:test');
const assert = require('node:assert/strict');

const { getCategoryLabel } = require('../src/constants/uiTheme.ts');

test('getCategoryLabel keeps protected none label for other category id', () => {
  assert.equal(getCategoryLabel('other'), 'None');
});

test('getCategoryLabel prefers configured category labels when provided', () => {
  assert.equal(
    getCategoryLabel('deep_focus', {
      deep_focus: 'Deep Focus',
    }),
    'Deep Focus'
  );
});
