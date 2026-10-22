import { guard_request } from '../dist/contextguard.mjs';
/** All parsing, selection, validation, repair and budget decisions are MoonBit. */
export function guard(request) {
  const result = JSON.parse(guard_request(JSON.stringify(request)));
  if (result.error) throw new TypeError(result.error);
  return result;
}
