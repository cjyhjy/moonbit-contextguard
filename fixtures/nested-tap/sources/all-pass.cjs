const {describe, it} = require('node:test');
describe('passing outer suite', () => {
  for (let i = 0; i < 4; i++) describe(`inner ${i}`, () => {
    for (let j = 0; j < 8; j++) it(`case ${j}`, () => {});
  });
});
