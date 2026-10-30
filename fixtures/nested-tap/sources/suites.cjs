const {describe, it, test} = require('node:test');
const assert = require('node:assert/strict');
for (let i = 0; i < 12; i++) test(`ordinary passing test ${i}`, () => {});
describe('suite 月兔', () => {
  it('shared title', () => {});
  describe('inner: nested scope', () => {
    it('shared title', () => {});
    it('broken identity', () => assert.equal(2, 3));
    it.skip('later skipped', () => {});
    it.todo('future');
  });
});
for (let i = 12; i < 24; i++) test(`ordinary passing test ${i}`, () => {});
