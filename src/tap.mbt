///|
fn after_prefix(s : String, prefix : String) -> String {
  s[prefix.length():].to_owned()
}

///|
// Deliberately a flat Node TAP profile, not a general TAP/YAML parser.
// Unknown comments, nested suites, bailouts and partial output pass through.
fn parse_tap(lines : Array[String], exit_code : Int32) -> Parsed {
  if lines.length() < 10 || lines[0] != "TAP version 13" {
    return failed("tap_missing_header")
  }
  let units : Array[EvidenceUnit] = [
    { kind: "header", start: 0, stop: 1, required: true, },
  ]
  let mut i = 1
  let mut count = 0
  let mut failures = 0
  let mut skipped = 0
  let mut todos = 0
  while i < lines.length() && lines[i].has_prefix("# Subtest: ") {
    let start = i
    let title = after_prefix(lines[i], "# Subtest: ")
    if title == "" {
      return failed("tap_empty_title")
    }
    i = i + 1
    if i >= lines.length() {
      return failed("tap_incomplete_test")
    }
    let fail = lines[i].has_prefix("not ok ")
    if !fail && !lines[i].has_prefix("ok ") {
      return failed("tap_nested_or_unknown")
    }
    let status = after_prefix(lines[i], if fail { "not ok " } else { "ok " })
    count = count + 1
    let expected = "\{count} - \{title}"
    let skip = status == expected + " # SKIP" ||
      status.has_prefix(expected + " # SKIP ")
    let todo = status == expected + " # TODO" ||
      status.has_prefix(expected + " # TODO ")
    if status != expected && !skip && !todo {
      return failed("tap_identity_mismatch")
    }
    if skip {
      skipped = skipped + 1
    }
    if todo {
      todos = todos + 1
    }
    if fail && !todo {
      failures = failures + 1
    }
    i = i + 1
    if i >= lines.length() || lines[i] != "  ---" {
      return failed("tap_missing_diagnostics")
    }
    i = i + 1
    let mut error_seen = false
    let mut failure_seen = false
    let mut location_seen = false
    let mut has_duration = false
    while i < lines.length() && lines[i] != "  ..." {
      let line = lines[i]
      if !line.has_prefix("  ") {
        return failed("tap_broken_diagnostics")
      }
      if line.has_prefix("  duration_ms: ") {
        has_duration = true
      }
      if line.has_prefix("  error: ") {
        error_seen = true
      }
      if line.has_prefix("  failureType: ") {
        failure_seen = true
      }
      if line.has_prefix("  location: ") {
        location_seen = true
      }
      // Optional pass blocks may contain only these unneeded timing/type fields.
      if !fail &&
        !skip &&
        !todo &&
        !line.has_prefix("  duration_ms: ") &&
        line != "  type: 'test'" {
        return failed("tap_extra_pass_diagnostics")
      }
      i = i + 1
    }
    if i >= lines.length() || !has_duration {
      return failed("tap_incomplete_diagnostics")
    }
    if fail && (!error_seen || !failure_seen || !location_seen) {
      return failed("tap_missing_failure_evidence")
    }
    i = i + 1
    units.push({
      kind: if fail {
        "failure"
      } else if skip {
        "skip"
      } else if todo {
        "todo"
      } else {
        "pass"
      },
      start,
      stop: i,
      required: fail || skip || todo,
    })
  }
  if i >= lines.length() || lines[i] != "1..\{count}" {
    return failed("tap_missing_plan")
  }
  let tail_start = i
  i = i + 1
  let names = [
    "tests", "suites", "pass", "fail", "cancelled", "skipped", "todo",
  ]
  let values = [
    count,
    0,
    count - failures - skipped - todos,
    failures,
    0,
    skipped,
    todos,
  ]
  for k, name in names {
    if i >= lines.length() || lines[i] != "# \{name} \{values[k]}" {
      return failed("tap_summary_mismatch")
    }
    i = i + 1
  }
  if i >= lines.length() || !lines[i].has_prefix("# duration_ms ") {
    return failed("tap_missing_duration")
  }
  i = i + 1
  if i != lines.length() {
    return failed("tap_unknown_tail")
  }
  if exit_code != (if failures > 0 { 1 } else { 0 }) {
    return failed("tap_exit_mismatch")
  }
  units.push({ kind: "summary", start: tail_start, stop: i, required: true, })
  { units, error: "", }
}
