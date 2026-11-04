import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTelemetry } from './telemetry.mjs';

export const OPENCODE_PIN = Object.freeze({
  version: '1.19.5',
  commit: '810c0eba1a7348036f8bdf61e6632d0c36c6876c',
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const recallScript = fileURLToPath(new URL('./recall.mjs', import.meta.url));

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
 * Returns an OpenCode 1.19.5 Plugin function. Does not execute commands, call a
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
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 4194304) throw new TypeError('maxOutputChars must be an integer from 0 to 4194304');
  const mode = options.mode ?? 'guard';
  if (!['guard', 'observe'].includes(mode)) throw new TypeError('mode must be guard or observe');

  return async function ContextGuard(context) {
    const directory = resolve(context?.directory ?? '.');
    const evidenceDirectory = resolve(directory, options.evidenceDirectory ?? '.contextguard/evidence');
    const audit = createTelemetry(evidenceDirectory, options.runId, async error => {
      if (options.onAuditError) await options.onAuditError(error);
      await context?.client?.app?.log?.({ body: { service: 'contextguard', level: 'error',
        message: 'Telemetry unavailable; preserving original tool output.', extra: { code: error.code ?? 'write_error' } } });
    });
    const identity = input => ({ session_id: input?.sessionID ?? null, call_id: input?.callID ?? null,
      tool: input?.tool ?? 'unknown' });
    await audit.write({ event: 'plugin.loaded', contract_pin: OPENCODE_PIN, mode, max_output_chars: budget,
      rules_sha256: sha256(JSON.stringify(rules)), boundary: 'hook-visible output; not necessarily full stdout' });
    let guard = options.guard;
    return {
      'tool.execute.before': async (input, output) => {
        await audit.write({ event: 'tool.started', ...identity(input),
          args_sha256: sha256(JSON.stringify(output?.args ?? null)) });
      },
      event: async ({ event }) => {
        if (event?.type === 'session.status' && event.properties?.status?.type === 'retry') {
          const status = event.properties.status;
          await audit.write({ event: 'session.retry', session_id: event.properties.sessionID,
            attempt: status.attempt, next: status.next });
          return;
        }
        if (event?.type !== 'message.part.updated') return;
        const part = event.properties?.part;
        if (part?.type !== 'tool' || !['completed', 'error'].includes(part.state?.status)) return;
        await audit.write({ event: 'tool.runtime', session_id: part.sessionID, call_id: part.callID, tool: part.tool,
          status: part.state.status, interrupted: part.state.metadata?.interrupted === true,
          ...(typeof part.state.output === 'string' ? { visible_chars: part.state.output.length,
            visible_sha256: sha256(part.state.output) } : {}) });
      },
      'tool.execute.after': async (input, output) => {
        const raw = output?.output;
        const base = { event: 'tool.finished', ...identity(input), mode,
          input_chars: typeof raw === 'string' ? raw.length : null,
          visible_chars: typeof raw === 'string' ? raw.length : null,
          visible_sha256: typeof raw === 'string' ? sha256(raw) : null, char_unit: 'utf16_code_units',
          contract_eligible: false, outcome: 'skip' };
        const skip = reason => audit.write({ ...base, reason });
        // MCP and other tools have different contracts; never reinterpret them.
        if (input?.tool !== 'bash') { await skip('unsupported_tool'); return; }
        if (typeof raw !== 'string') { await skip('non_text_output'); return; }
        const commandRules = rules.filter(x => x.command === input.args?.command);
        if (!commandRules.length) {
          if (input.args?.command?.startsWith(`node ${quote(recallScript)} `)) {
            await audit.write({ ...base, reason: 'recall_cli', exit_code: output.metadata?.exit ?? null });
          } else await skip('command_not_allowlisted');
          return;
        }
        const rule = commandRules.find((x) =>
          resolve(directory, x.workdir ?? '.') === resolve(directory, input.args?.workdir ?? '.'));
        if (!rule) { await skip('workdir_mismatch'); return; }
        if (!Number.isSafeInteger(output.metadata?.exit)) { await skip('missing_exit_code'); return; }
        if (typeof output.metadata?.truncated !== 'boolean') { await skip('missing_truncation_status'); return; }
        base.contract_eligible = true;
        const processContext = {
          exit_code: output.metadata.exit,
          scope: [...rule.scope],
          truncated: output.metadata.truncated,
        };
        base.process = processContext;
        if (mode === 'observe') { await audit.write({ ...base, outcome: 'observed', reason: 'baseline_observation' }); return; }
        if (audit.failures) { await audit.write({ ...base, outcome: 'error', reason: 'audit_unavailable' }); return; }
        let stage = 'evidence_storage';
        try {
          // Persist the exact hook-visible text and metadata BEFORE any mutation.
          // OpenCode may already have truncated output; do not call this full stdout.
          const rawHash = sha256(raw);
          const record = {
            schema_version: 1,
            opencode: OPENCODE_PIN,
            run_id: audit.runId,
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
          stage = 'core_execution';
          guard ??= (await import('../tools/api.mjs')).guard;
          const result = guard({ format: rule.format, raw, process: processContext, max_output_chars: budget });
          if (!result || typeof result.output !== 'string' || !sameProcess(result.process, processContext)) {
            await audit.write({ ...base, outcome: 'error', reason: 'invalid_core_result_or_process_context' }); return;
          }
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
            recall_command: `node ${quote(recallScript)} ${quote(receiptPath)} START END`,
            original_lines: raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0),
          });
          const rendered = header + '\n--- ContextGuard tool output ---\n' + result.output;
          // A shorter core payload is useful only when the whole hook-visible
          // envelope is shorter. Keep fallbacks and small results byte-for-byte.
          const apply = result.decision !== 'fallback' && rendered.length < raw.length;
          const visible = apply ? rendered : raw;
          const adapterDecision = result.decision === 'fallback'
            ? 'original_kept_core_fallback'
            : apply ? 'applied' : 'original_kept_no_visible_reduction';
          const decisionRecord = { ...result, adapter_decision: adapterDecision, adapter_metrics: {
            char_unit: 'utf16_code_units',
            agent_visible_chars: visible.length,
            envelope_chars: apply ? rendered.length - result.output.length : 0,
            input_chars: raw.length,
            net_reduction_chars: raw.length - visible.length,
            proposed_agent_visible_chars: rendered.length,
          } };
          stage = 'decision_storage';
          await writeFile(decisionPath, JSON.stringify(decisionRecord, null, 2) + '\n', { mode: 0o600 });
          const logged = await audit.write({ ...base, outcome: result.decision === 'fallback' ? 'fallback' : apply ? 'applied' : 'skip',
            reason: result.decision === 'fallback' ? result.reason : apply ? 'required_source_units_verified' : 'no_visible_reduction',
            core_decision: result.decision, receipt: receiptPath, decision: decisionPath,
            raw_sha256: rawHash, visible_chars: visible.length, visible_sha256: sha256(visible),
            net_reduction_chars: raw.length - visible.length });
          if (logged) output.output = visible;
          else {
            decisionRecord.adapter_decision = 'original_kept_audit_error';
            decisionRecord.adapter_metrics.agent_visible_chars = raw.length;
            decisionRecord.adapter_metrics.envelope_chars = 0;
            decisionRecord.adapter_metrics.net_reduction_chars = 0;
            await writeFile(decisionPath, JSON.stringify(decisionRecord, null, 2) + '\n', { mode: 0o600 });
          }
        } catch (error) {
          // Disk, build, parser, or bridge errors must not hide tool output.
          output.output = raw;
          await audit.write({ ...base, outcome: 'error', reason: `${stage}_failed`, error_code: error.code ?? error.name ?? 'error' });
        }
      },
    };
  };
}
