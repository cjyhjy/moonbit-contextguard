// Synthetic passing workload; fixture stdout is an actual Node.js process capture.
const test = require('node:test');
const assert = require('node:assert/strict');
test('addition works', () => assert.equal(2 + 3, 5));
test('Unicode 字符 remains intact', () => assert.equal('证据', '证据'));
