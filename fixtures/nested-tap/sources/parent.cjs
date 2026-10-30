const {test, describe, it} = require('node:test');
const assert = require('node:assert/strict');
test('parent with child tests', async t => {
  await t.test('child passes', () => {});
  await t.test('child fails', () => assert.equal(1, 2));
});
describe.skip('skipped suite', () => {it('never executed', () => {});});
describe.todo('todo suite', () => {it('todo child', () => {});});
describe('empty suite', () => {});
