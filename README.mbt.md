# ContextGuard

MoonBit library for validating evidence in tool-output excerpts. Supports a bounded Node TAP profile with flat and nested tests/suites and ripgrep JSONL. It validates candidate text against the original, repairs missing complete evidence units, and returns the original on tampering, unknown formats, truncated capture, or insufficient budget.

The parser, compressor, independent validator, repair and budget decisions are implemented in MoonBit. There are no network or model calls. This package does not promise arbitrary semantic losslessness, token savings, lower billed cost or better online agent outcomes.

## Install

Tested with `moonc 0.10.18+6c83a7f62`; contest minimum is 0.10.16. Use the tested version to reproduce results.

```sh
moon add cjyhjy/contextguard@0.2.0
```

In your `moon.pkg`:

```moonbit nocheck
///|
import {
  "cjyhjy/contextguard" @guard,
}
```

Call the pure JSON entry point:

```moonbit nocheck
let result = @guard.guard_request(
  #|{"format":"unknown","raw":"hello\n","process":{"exit_code":0,"scope":["example"],"truncated":false}}
)
println(result)
```

This returns a JSON response with `decision: "fallback"`, `reason: "unknown_format"` and the unchanged `output: "hello\n"`. A complete supported TAP example ships in `cmd/example/`:

```sh
moon run cmd/example --target js
moon test --target js
moon test --target native
moon test --target wasm-gc
```

`guard_request(request_json : String) -> String` accepts `format`, `raw`, optional `candidate`, `max_input_chars` and `max_output_chars`, plus required trusted `process.exit_code`, `process.scope` and `process.truncated`. Budgets count UTF-16 code units, not model tokens. Invalid transport returns an `error` object. Ordinary results include `decision` (`compressed`, `accepted`, `repaired`, `fallback`), `reason`, `output`, evidence spans and metrics.

The caller is responsible for capturing the original output and process metadata faithfully. A verified excerpt is evidence, not a complete TAP/rg stream to parse again. Preserve the original for recall.

## Repository and license

[Repository, Node CLI, real-process wrapper, interactive demo and full API](https://github.com/cjyhjy/moonbit-contextguard). The registry contains the MoonBit source library, tests, example and license; the repository additionally provides Node integration tools, evaluation fixtures and third-party comparison material.

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`. No external comparison implementations are included in this registry archive; MoonBit's standard library remains under its upstream license.

## Nested TAP in 0.2.0

Nested `describe`/`it` suites and `t.test()` branches are validated recursively, including sibling numbering, child plans, suite/test totals and parent status. A root branch containing failure, skip or todo is retained as one complete source unit with all ancestor names and diagnostics. All-passing branches with only known timing/type fields can be omitted. Maximum child depth is 32 below the root; deeper trees, cancellation, custom logging and unknown grammar return the original.
