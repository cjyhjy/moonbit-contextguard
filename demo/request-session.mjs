/** A response may commit only while its operation still owns this session. */
export function createRequestSession() {
  let active;
  return {
    begin(timeoutMs = 20000) {
      this.invalidate();
      const controller = new AbortController();
      const operation = { signal: controller.signal, controller };
      operation.timer = setTimeout(() => controller.abort(new Error('请求超时，请重新校验。')), timeoutMs);
      active = operation;
      return operation;
    },
    owns(operation) { return active === operation; },
    canCommit(operation) { return active === operation && !operation.signal.aborted; },
    finish(operation) {
      if (active !== operation) return false;
      clearTimeout(operation.timer);
      active = undefined;
      return true;
    },
    invalidate() {
      if (!active) return;
      clearTimeout(active.timer);
      active.controller.abort();
      active = undefined;
    },
  };
}

export function integerField(value, { label, field, min = -Infinity }) {
  const number = Number(value);
  if (String(value).trim() === '' || !Number.isSafeInteger(number) || number < min) {
    const error = new Error(`${label}必须是${min === 0 ? '非负' : ''}整数，且不能为空。`);
    error.field = field;
    throw error;
  }
  return number;
}
