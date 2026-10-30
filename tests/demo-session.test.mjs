import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestSession, integerField } from '../demo/request-session.mjs';

test('editing invalidates an in-flight response even when its producer ignores abort', async () => {
  const session = createRequestSession();
  const first = session.begin();
  let resolveOld;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  let output = 'previous snapshot';
  const renderOld = oldResponse.then((value) => { if (session.canCommit(first)) output = value; });
  session.invalidate();
  assert.equal(first.signal.aborted, true);
  const second = session.begin();
  if (session.canCommit(second)) output = 'current result';
  resolveOld('obsolete result');
  await renderOld;
  assert.equal(output, 'current result');
  assert.equal(session.finish(first), false, 'old cleanup must not release the new operation');
  assert.equal(session.owns(second), true);
  assert.equal(session.finish(second), true);
});

test('starting a new operation cancels previous work and timeout cannot commit', async () => {
  const session = createRequestSession();
  const first = session.begin();
  const second = session.begin(5);
  assert.equal(first.signal.aborted, true);
  assert.equal(session.canCommit(first), false);
  await new Promise((resolve) => second.signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(session.canCommit(second), false);
  assert.equal(session.owns(second), true, 'timeout must still be able to display its error');
  assert.match(second.signal.reason.message, /请求超时/u);
  session.finish(second);
});

test('blank, fractional, negative and unsafe budgets are invalid instead of becoming zero', () => {
  const options = { label: '输出预算', field: 'budget', min: 0 };
  for (const value of ['', ' ', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
    assert.throws(() => integerField(value, options), (error) => error.field === 'budget');
  }
  assert.equal(integerField('0', options), 0);
  assert.equal(integerField('100', options), 100);
  assert.equal(integerField('-1', { label: '退出码', field: 'exit-code' }), -1);
  assert.throws(() => integerField('', { label: '退出码', field: 'exit-code' }), /不能为空/u);
});
