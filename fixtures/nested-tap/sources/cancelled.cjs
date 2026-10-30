const {describe, it} = require('node:test');
describe('timeout suite', () => {
  it('cancelled by timeout', {timeout: 10}, async () => {
    await new Promise(resolve => setTimeout(resolve, 60));
  });
});
