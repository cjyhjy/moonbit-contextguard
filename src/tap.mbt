///|
fn after_prefix(s : String, prefix : String) -> String {
  s[prefix.length():].to_owned()
}

///|
fn valid_duration(s : String) -> Bool {
  if s == "" || s.has_prefix(".") || s.has_suffix(".") {
    return false
  }
  let mut dots = 0
  for c in s.iter() {
    if c == '.' {
      dots = dots + 1
      if dots > 1 {
        return false
      }
    } else if c < '0' || c > '9' {
      return false
    }
  }
  true
}

///|
priv struct TapNode {
  stop : Int32
  tests : Int32
  suites : Int32
  failures : Int32
  skipped : Int32
  todos : Int32
  failed : Bool
  required : Bool
  kind : String
}

///|
// A complete top-level branch is one atomic evidence unit. Recursive parsing
// validates child identities/plans/counts but never flattens their parent scope.
fn parse_tap_node(
  lines : Array[String],
  start : Int32,
  index : Int32,
  depth : Int32,
) -> Result[TapNode, String] {
  if depth > 32 {
    return Err("tap_depth_limit")
  }
  let prefix = "    ".repeat(depth)
  let child_prefix = prefix + "    "
  let title = after_prefix(lines[start], prefix + "# Subtest: ")
  if title == "" {
    return Err("tap_empty_title")
  }
  let mut i = start + 1
  let mut children = 0
  let mut tests = 0
  let mut suites = 0
  let mut failures = 0
  let mut skipped = 0
  let mut todos = 0
  let mut child_failed = false
  let mut child_required = false
  while i < lines.length() && lines[i].has_prefix(child_prefix + "# Subtest: ") {
    let node = match parse_tap_node(lines, i, children + 1, depth + 1) {
      Ok(node) => node
      Err(reason) => return Err(reason)
    }
    i = node.stop
    children = children + 1
    tests = tests + node.tests
    suites = suites + node.suites
    failures = failures + node.failures
    skipped = skipped + node.skipped
    todos = todos + node.todos
    child_failed = child_failed || node.failed
    child_required = child_required || node.required
  }
  if children > 0 {
    if i >= lines.length() || lines[i] != child_prefix + "1..\{children}" {
      return Err("tap_child_plan_mismatch")
    }
    i = i + 1
  }
  if i >= lines.length() {
    return Err("tap_incomplete_test")
  }
  let fail = lines[i].has_prefix(prefix + "not ok ")
  if !fail && !lines[i].has_prefix(prefix + "ok ") {
    return Err("tap_nested_or_unknown")
  }
  let status = after_prefix(
    lines[i],
    prefix + (if fail { "not ok " } else { "ok " }),
  )
  let expected = "\{index} - \{title}"
  let skip = status == expected + " # SKIP" ||
    status.has_prefix(expected + " # SKIP ")
  let todo = status == expected + " # TODO" ||
    status.has_prefix(expected + " # TODO ")
  if status != expected && !skip && !todo {
    return Err("tap_identity_mismatch")
  }
  if child_failed && !fail {
    return Err("tap_parent_status_mismatch")
  }
  i = i + 1
  if i >= lines.length() || lines[i] != prefix + "  ---" {
    return Err("tap_missing_diagnostics")
  }
  i = i + 1
  let mut error_seen = false
  let mut failure_seen = false
  let mut location_seen = false
  let mut has_duration = false
  let mut node_type = ""
  while i < lines.length() && lines[i] != prefix + "  ..." {
    let line = lines[i]
    if !line.has_prefix(prefix + "  ") {
      return Err("tap_broken_diagnostics")
    }
    let diagnostic = after_prefix(line, prefix)
    if diagnostic.has_prefix("  duration_ms: ") {
      if has_duration ||
        !valid_duration(after_prefix(diagnostic, "  duration_ms: ")) {
        return Err("tap_invalid_duration")
      }
      has_duration = true
    }
    if diagnostic.has_prefix("  type: ") {
      if node_type != "" {
        return Err("tap_invalid_type")
      }
      node_type = after_prefix(diagnostic, "  type: ")
      if node_type != "'test'" && node_type != "'suite'" {
        return Err("tap_invalid_type")
      }
    }
    if diagnostic.has_prefix("  error: ") {
      error_seen = true
    }
    if diagnostic.has_prefix("  failureType: ") {
      failure_seen = true
    }
    if diagnostic.has_prefix("  location: ") {
      location_seen = true
    }
    // Ordinary passing branches can disappear only if all their diagnostics
    // are the exact timing/type fields understood by this profile.
    if !fail &&
      !skip &&
      !todo &&
      !diagnostic.has_prefix("  duration_ms: ") &&
      diagnostic != "  type: 'test'" &&
      diagnostic != "  type: 'suite'" {
      return Err("tap_extra_pass_diagnostics")
    }
    i = i + 1
  }
  if i >= lines.length() || !has_duration {
    return Err("tap_incomplete_diagnostics")
  }
  if fail && (!error_seen || !failure_seen || !location_seen) {
    return Err("tap_missing_failure_evidence")
  }
  if children > 0 && node_type == "" {
    return Err("tap_invalid_type")
  }
  let suite = node_type == "'suite'"
  if suite {
    suites = suites + 1
  } else {
    tests = tests + 1
    if skip {
      skipped = skipped + 1
    } else if todo {
      todos = todos + 1
    } else if fail {
      failures = failures + 1
    }
  }
  Ok({
    stop: i + 1,
    tests,
    suites,
    failures,
    skipped,
    todos,
    failed: (fail && !todo && !skip) || child_failed,
    required: fail || skip || todo || child_required,
    kind: if suite {
      "suite"
    } else if children > 0 {
      "subtests"
    } else if fail {
      "failure"
    } else if skip {
      "skip"
    } else if todo {
      "todo"
    } else {
      "pass"
    },
  })
}

///|
// Bounded Node TAP profile, including recursively numbered nested test branches.
// Unknown logs, bailouts, cancellation and partial/contradictory streams pass through.
fn parse_tap(lines : Array[String], exit_code : Int32) -> Parsed {
  if lines.length() < 10 || lines[0] != "TAP version 13" {
    return failed("tap_missing_header")
  }
  let units : Array[EvidenceUnit] = [
    { kind: "header", start: 0, stop: 1, required: true, },
  ]
  let mut i = 1
  let mut count = 0
  let mut tests = 0
  let mut suites = 0
  let mut failures = 0
  let mut skipped = 0
  let mut todos = 0
  let mut any_failed = false
  while i < lines.length() && lines[i].has_prefix("# Subtest: ") {
    let start = i
    let node = match parse_tap_node(lines, i, count + 1, 0) {
      Ok(node) => node
      Err(reason) => return failed(reason)
    }
    i = node.stop
    count = count + 1
    tests = tests + node.tests
    suites = suites + node.suites
    failures = failures + node.failures
    skipped = skipped + node.skipped
    todos = todos + node.todos
    any_failed = any_failed || node.failed
    units.push({ kind: node.kind, start, stop: i, required: node.required, })
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
    tests,
    suites,
    tests - failures - skipped - todos,
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
  if !valid_duration(after_prefix(lines[i], "# duration_ms ")) {
    return failed("tap_invalid_duration")
  }
  i = i + 1
  if i != lines.length() {
    return failed("tap_unknown_tail")
  }
  if exit_code != (if any_failed { 1 } else { 0 }) {
    return failed("tap_exit_mismatch")
  }
  units.push({ kind: "summary", start: tail_start, stop: i, required: true, })
  { units, error: "", }
}
