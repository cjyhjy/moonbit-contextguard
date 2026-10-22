import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const OPENCODE_PIN = Object.freeze({
  version: '1.2.0',
  commit: 'ffc000de8e446c63d41a2e352d119d9ff43530d0',
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Deliberately not a shell parser. Exact allowlisting is still required. */
export function inferFormat(command) {
  if (typeof command !== 'string' || /[\n\r;&|`$<>\\'"()]/u.test(command)) return null;
  const argv = command.trim().split(/\s+/u);
  if (argv[0] === 'rg' && argv.includes('--json')) return 'rg-json';
  if (argv[0] === 'node' && argv.includes('--test') && argv.includes('--test-reporter=tap')) return 'node-tap';
  return null;
}

function sameProcess(left, right) {
  return left?.exit_code === right.exit_code && left?.truncated === right.truncated
    && JSON.stringify(left?.scope) === JSON.stringify(right.scope);
}

/**
 * Returns an OpenCode 1.2.0 Plugin function. Does not execute commands, call a
 * model, or install itself. Only output.output is mutated; metadata is untouched.
 */
export function createContextGuardPlugin(options = {}) {
  const allowCommands = options.allowCommands ?? [];
  if (!Array.isArray(allowCommands)) throw new TypeError('allowCommands must be an array');
  const rules = allowCommands.map((entry) => {
    if (!entry || typeof entry.command !== 'string' || !Array.isArray(entry.scope)
      || entry.scope.length === 0 || entry.scope.some((x) => typeof x !== 'string' || !x)) {
      throw new TypeError('Each allowlist entry requires an exact command and explicit scope');
    }
    const inferred = inferFormat(entry.command);
    if (!inferred || (entry.format && entry.format !== inferred)) {
      throw new TypeError('Allowlist command must be plain rg --json or node --test --test-reporter=tap');
    }
    return { ...entry, scope: [...entry.scope], format: inferred };
  });
  const budget = options.maxOutputChars ?? 12000;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new TypeError('maxOutputChars must be a nonnegative integer');

  return async function ContextGuard(context) {
    const directory = resolve(context?.directory ?? '.');
    const evidenceDirectory = resolve(directory, options.evidenceDirectory ?? '.contextguard/evidence');
    let guard = options.guard;
    return {
      'tool.execute.after': async (input, output) => {
        // MCP and other tools have different contracts; never reinterpret them.
        if (input?.tool !== 'bash' || typeof output?.output !== 'string') return;
        const rule = rules.find((x) => x.command === input.args?.command
          && resolve(directory, x.workdir ?? '.') === resolve(directory, input.args?.workdir ?? '.'));
        if (!rule || !Number.isSafeInteger(output.metadata?.exit)
          || typeof output.metadata?.truncated !== 'boolean') return;
        const raw = output.output;
        const processContext = {
          exit_code: output.metadata.exit,
          scope: [...rule.scope],
          truncated: output.metadata.truncated,
        };
        try {
          // Persist the exact hook-visible text and metadata BEFORE any mutation.
          // OpenCode may already have truncated output; do not call this full stdout.
          const rawHash = sha256(raw);
          const record = {
            schema_version: 1,
            opencode: OPENCODE_PIN,
            observation_boundary: 'OpenCode tool.execute.after hook-visible output; stdout/stderr may already be combined or truncated',
            input,
            original: { title: output.title, metadata: output.metadata, attachments: output.attachments },
            process: processContext,
            format: rule.format,
            max_output_chars: budget,
            raw_sha256: rawHash,
            raw_file: `raw-${rawHash}.txt`,
          };
          const recordText = JSON.stringify(record, null, 2) + '\n';
          const receiptHash = sha256(recordText);
          await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
          await writeFile(resolve(evidenceDirectory, record.raw_file), raw, { mode: 0o600 });
          const receiptPath = resolve(evidenceDirectory, `receipt-${receiptHash}.json`);
          await writeFile(receiptPath, recordText, { mode: 0o600 });
          guard ??= (await import('../tools/api.mjs')).guard;
          const result = guard({ format: rule.format, raw, process: processContext, max_output_chars: budget });
          if (!result || typeof result.output !== 'string' || !sameProcess(result.process, processContext)) return;
          const decisionPath = resolve(evidenceDirectory, `decision-${receiptHash}.json`);
          // Trusted process context lives outside candidate text. The envelope has
          // measurable overhead and is not included in core output-only metrics.
          const header = JSON.stringify({
            contextguard: 1,
            process: processContext,
            decision: result.decision,
            reason: result.reason,
            output_kind: result.output_kind,
            raw_sha256: rawHash,
            receipt: receiptPath,
            evidence: decisionPath,
          });
          const rendered = header + '\n--- ContextGuard tool output ---\n' + result.output;
          const decisionText = JSON.stringify({ ...result, adapter_metrics: {
            char_unit: 'utf16_code_units',
            agent_visible_chars: rendered.length,
            envelope_chars: rendered.length - result.output.length,
            input_chars: raw.length,
          } }, null, 2) + '\n';
          await writeFile(decisionPath, decisionText, { mode: 0o600 });
          output.output = rendered;
        } catch {
          // Disk, build, parser, or bridge errors must not hide tool output.
          output.output = raw;
        }
      },
    };
  };
}
