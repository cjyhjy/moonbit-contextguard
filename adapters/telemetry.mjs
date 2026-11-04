import { appendFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// Private, append-only observation log. Raw output is stored separately by the adapter.
export function createTelemetry(directory, runId = randomUUID(), onError = () => {}) {
  if (typeof runId !== 'string' || !runId.trim()) throw new TypeError('runId must be a nonempty string');
  const path = resolve(directory, 'events.jsonl');
  const instanceId = randomUUID();
  let tail = Promise.resolve(), sequence = 0, failures = 0;
  return {
    path, runId, instanceId,
    get failures() { return failures; },
    write(event) {
      const record = { schema_version: 1, event_id: randomUUID(), timestamp: new Date().toISOString(),
        run_id: runId, instance_id: instanceId, sequence: ++sequence, ...event };
      const write = tail.then(async () => {
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await appendFile(path, JSON.stringify(record) + '\n', { mode: 0o600 });
          return true;
        } catch (error) {
          failures++;
          try { await onError(error); } catch { /* Observability must not break tools. */ }
          return false;
        }
      });
      tail = write;
      return write;
    },
  };
}
