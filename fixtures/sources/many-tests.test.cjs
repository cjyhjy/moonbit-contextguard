// Synthetic test workload; its committed TAP fixture is actual Node.js process output.
const test = require('node:test');
const assert = require('node:assert/strict');

for (let index = 1; index <= 36; index += 1) {
  test(`before ${String(index).padStart(2, '0')} — 中文 passes`, () => {
    assert.equal(index + 1, 1 + index);
  });
}

test('middle failure retains actual expected and location', () => {
  assert.deepEqual(
    { account: '演示账户', remaining: 7, state: 'pending' },
    { account: '演示账户', remaining: 9, state: 'ready' },
  );
});

test('explicit skip retains its reason', { skip: 'synthetic unavailable optional service' }, () => {});
test('explicit todo retains its reason', { todo: 'synthetic future behavior' }, () => {});

for (let index = 1; index <= 36; index += 1) {
  test(`after ${String(index).padStart(2, '0')} — unicode λ passes`, () => {
    assert.ok(index > 0);
  });
}
