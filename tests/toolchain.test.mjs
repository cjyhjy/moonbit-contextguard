import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolchain} from '../tools/check-toolchain.mjs';

test('toolchain gate rejects the previous compiler and a missing compiler receipt', () => {
  assert.throws(() => validateToolchain('moonc v0.10.15+943464bfa (date)', '0.10.15+943464bfa'), /requires/);
  assert.throws(() => validateToolchain('moon 0.1.20261028', '0.10.18+6c83a7f62'), /Cannot determine/);
});

test('toolchain gate requires the tested lock, even for a newer compiler', () => {
  assert.equal(validateToolchain('moonc v0.10.18+6c83a7f62 (date)', '0.10.18+6c83a7f62'), '0.10.18+6c83a7f62');
  assert.throws(() => validateToolchain('moonc v0.10.19+other (date)', '0.10.18+6c83a7f62'), /pinned compiler/);
});
