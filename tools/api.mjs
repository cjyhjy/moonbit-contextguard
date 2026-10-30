import { guard_request } from '../dist/contextguard.mjs';
/** All parsing, selection, validation, repair and budget decisions are MoonBit. */
export function guard(request) {
  return guardJson(JSON.stringify(request));
}

/** Raw JSON transport, parsed once by MoonBit (also retains duplicate-key checks). */
export function guardJson(source) {
  if(typeof source!=='string')throw new TypeError('request must be a JSON string');
  const result = JSON.parse(guard_request(source));
  if (result.error) throw new TypeError(result.error);
  return result;
}
