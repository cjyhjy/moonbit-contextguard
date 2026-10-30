const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
describe('suite containing directives', () => {
  it.todo('expected TODO failure', () => assert.equal(1, 2));
  it('named # SKIP but actually passes', () => {});
  it.skip('actual skip', () => {});
});
