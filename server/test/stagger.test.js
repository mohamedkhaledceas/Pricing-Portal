const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('node-cron');
const { staggeredMinutes } = require('../src/common/jobs/stagger');

test('staggered schedules are valid cron and land on their offsets', () => {
  for (const [every, offset, expected] of [[30, 3, '3-59/30'], [15, 7, '7-59/15'], [60, 25, '25-59/60'], [30, 41, '11-59/30']]) {
    assert.equal(staggeredMinutes(every, offset), expected);
    assert.ok(cron.validate(`${expected} * * * *`));
  }
});
