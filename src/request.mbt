///|
fn response(
  format : String,
  raw : String,
  output : String,
  process : Json,
  decision : String,
  reason : String,
  units : Array[EvidenceUnit],
  lines : Array[String],
  missing : Int32,
) -> String {
  let evidence : Array[Json] = []
  for i, unit in units {
    if unit.required {
      evidence.push(
        obj([
          ("id", Json::string("E\{i+1}")),
          ("kind", Json::string(unit.kind)),
          ("start_line", num(unit.start + 1)),
          ("end_line", num(unit.stop)),
          ("text", Json::string(excerpt(lines, unit.start, unit.stop))),
        ]),
      )
    }
  }
  obj([
    ("schema_version", num(1)),
    ("format", Json::string(format)),
    ("decision", Json::string(decision)),
    ("reason", Json::string(reason)),
    ("output", Json::string(output)),
    ("process", process),
    ("evidence", Json::array(evidence)),
    (
      "metrics",
      obj([
        ("input_chars", num(raw.length())),
        ("output_chars", num(output.length())),
        ("required_facts", num(evidence.length())),
        ("missing_facts", num(missing)),
        ("char_unit", Json::string("utf16_code_units")),
      ]),
    ),
    (
      "assurance",
      Json::string(
        if decision == "fallback" {
          "original_passthrough"
        } else {
          "required_source_units_verified"
        },
      ),
    ),
    (
      "output_kind",
      Json::string(
        if output == raw {
          "original"
        } else {
          "evidence_projection"
        },
      ),
    ),
  ]).stringify()
}

///|
/// JSON transport for the public MoonBit library. Raw output and trusted process
/// metadata are supplied by the caller. No model, network, or mutable global state.
pub fn guard_request(source : String) -> String {
  if source.length() > 8388608 || !json_depth_ok(source) {
    return obj([("error", Json::string("request_budget_exceeded"))]).stringify()
  }
  guard parse_json(source) is Some(request) else {
    return obj([("error", Json::string("invalid_json_request"))]).stringify()
  }
  guard str(field(request, "raw")) is Some(raw) else {
    return obj([("error", Json::string("raw_must_be_string"))]).stringify()
  }
  let format = str(field(request, "format")).unwrap_or("unknown")
  let process = field(request, "process")
  let fallback = fn(reason : String) {
    response(format, raw, raw, process, "fallback", reason, [], [], 0)
  }
  guard integer(field(process, "exit_code")) is Some(exit_code) else {
    return fallback("invalid_process_metadata")
  }
  guard field(process, "scope") is Array(scope) && scope.length() > 0 else {
    return fallback("missing_scope")
  }
  for item in scope {
    if !(str(item) is Some(s) && s != "") {
      return fallback("invalid_scope")
    }
  }
  guard field(process, "truncated") is False else {
    return fallback(
      if field(process, "truncated") is True {
        "source_truncated"
      } else {
        "invalid_process_metadata"
      },
    )
  }
  let input_limit = match field(request, "max_input_chars") {
    Null => 1048576
    x =>
      match integer(x) {
        Some(n) if n > 0 && n <= 4194304 => n
        _ => return fallback("invalid_input_budget")
      }
  }
  let output_limit = match field(request, "max_output_chars") {
    Null => 16000
    x =>
      match integer(x) {
        Some(n) if n >= 0 && n <= 4194304 => n
        _ => return fallback("invalid_output_budget")
      }
  }
  if raw.length() > input_limit {
    return fallback("input_budget_exceeded")
  }
  let lines = lines_of(raw)
  if lines.length() > 50000 {
    return fallback("line_budget_exceeded")
  }
  let parsed = match format {
    "rg-json" => parse_rg(lines, exit_code)
    "node-tap" => parse_tap(lines, exit_code)
    _ => return fallback("unknown_format")
  }
  if parsed.error != "" {
    return fallback(parsed.error)
  }
  let candidate = match field(request, "candidate") {
    Null => None
    String(s) => Some(s)
    _ => return fallback("invalid_candidate")
  }
  let produced = candidate.unwrap_or_else(fn() {
    compress(lines, parsed.units, raw.has_suffix("\n"))
  })
  if produced.length() > input_limit {
    return fallback("candidate_budget_exceeded")
  }
  let verdict = validate_candidate(lines, parsed.units, produced)
  let answer = fn(output : String, decision : String, reason : String) {
    response(
      format,
      raw,
      output,
      process,
      decision,
      reason,
      parsed.units,
      lines,
      verdict.missing,
    )
  }
  if !verdict.provenance {
    return answer(raw, "fallback", "candidate_changed_or_reordered_source")
  }
  if !verdict.whole_units || verdict.missing > 0 {
    let repaired = compress(lines, parsed.units, raw.has_suffix("\n"))
    let checked = validate_candidate(lines, parsed.units, repaired)
    if !checked.provenance || !checked.whole_units || checked.missing > 0 {
      return answer(raw, "fallback", "internal_validation_failed")
    }
    if repaired.length() > output_limit {
      return answer(raw, "fallback", "required_evidence_exceeds_budget")
    }
    return answer(repaired, "repaired", "missing_or_partial_source_units")
  }
  if produced.length() > output_limit {
    return answer(raw, "fallback", "output_budget_exceeded")
  }
  answer(
    produced,
    if candidate is Some(_) {
      "accepted"
    } else {
      "compressed"
    },
    "required_source_units_verified",
  )
}
