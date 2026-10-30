const {describe, it} = require('node:test');
describe('custom output suite', () => {
  it('prints meaningful output', () => { console.log('CUSTOM IMPORTANT DIAGNOSTIC'); });
});
