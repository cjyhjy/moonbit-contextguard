///|
fn sample_tap() -> String {
  "TAP version 13\n# Subtest: pass\nok 1 - pass\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n# Subtest: broken\nnot ok 2 - broken\n  ---\n  duration_ms: 2\n  location: 'a.mjs:4:1'\n  failureType: 'testCodeFailure'\n  error: 'expected 1 got 2'\n  expected: 1\n  actual: 2\n  ...\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 3\n"
}

///|
fn request_for(raw : String, candidate : String?, limit : Int32) -> Json {
  parse_json(
    guard_request(
      obj([
        ("format", Json::string("node-tap")),
        ("raw", Json::string(raw)),
        (
          "candidate",
          match candidate {
            Some(s) => Json::string(s)
            None => Json::null()
          },
        ),
        ("max_output_chars", num(limit)),
        (
          "process",
          obj([
            ("exit_code", num(1)),
            ("scope", Json::array([Json::string("node --test")])),
            ("truncated", Json::boolean(false)),
          ]),
        ),
      ]).stringify(),
    ),
  ).unwrap()
}

///|
test "compressor drops pass units and preserves all failure fields" {
  let result = request_for(sample_tap(), None, 10000)
  assert_eq(str(field(result, "decision")), Some("compressed"))
  let output = str(field(result, "output")).unwrap()
  assert_true(output.contains("actual: 2"))
  assert_true(output.contains("location: 'a.mjs:4:1'"))
  assert_false(output.contains("ok 1 - pass"))
}

///|
test "whole missing middle block is repaired" {
  let raw = sample_tap()
  let lines = lines_of(raw)
  let candidate = excerpt(lines, 0, 7) +
    "\n" +
    excerpt(lines, 17, lines.length()) +
    "\n"
  let result = request_for(raw, Some(candidate), 10000)
  assert_eq(str(field(result, "decision")), Some("repaired"))
  assert_true(str(field(result, "output")).unwrap().contains("expected: 1"))
}

///|
test "altered assertion cannot pass as evidence" {
  let raw = sample_tap()
  let result = request_for(
    raw,
    Some(raw.replace(old="actual: 2", new="actual: 1")),
    10000,
  )
  assert_eq(str(field(result, "decision")), Some("fallback"))
  assert_eq(str(field(result, "output")), Some(raw))
}

///|
test "partial failure diagnostics repaired as complete atomic block" {
  let raw = sample_tap()
  let result = request_for(
    raw,
    Some(raw.replace(old="  actual: 2\n", new="")),
    10000,
  )
  assert_eq(str(field(result, "decision")), Some("repaired"))
  assert_true(str(field(result, "output")).unwrap().contains("actual: 2"))
}

///|
test "head tail omission marker is not source evidence" {
  let raw = sample_tap()
  let result = request_for(
    raw,
    Some("TAP version 13\n... truncated ...\n# fail 1\n"),
    10000,
  )
  assert_eq(str(field(result, "decision")), Some("fallback"))
}

///|
test "zero output budget fails open preserving original" {
  let raw = sample_tap()
  let result = request_for(raw, None, 0)
  assert_eq(str(field(result, "decision")), Some("fallback"))
  assert_eq(str(field(result, "output")), Some(raw))
}

///|
test "exact output budget is inclusive" {
  let raw = sample_tap()
  let output = str(field(request_for(raw, None, 10000), "output")).unwrap()
  assert_eq(
    str(field(request_for(raw, None, output.length()), "decision")),
    Some("compressed"),
  )
  assert_eq(
    str(field(request_for(raw, None, output.length() - 1), "decision")),
    Some("fallback"),
  )
}

///|
test "summary inconsistency falls back" {
  let raw = sample_tap().replace(old="# fail 1", new="# fail 0")
  assert_eq(
    str(field(request_for(raw, None, 10000), "reason")),
    Some("tap_summary_mismatch"),
  )
}

///|
test "unknown comments fail open" {
  let raw = sample_tap().replace(
    old="# Subtest: pass",
    new="# custom potentially meaningful log\n# Subtest: pass",
  )
  assert_eq(
    str(field(request_for(raw, None, 10000), "decision")),
    Some("fallback"),
  )
}

///|
test "truncated diagnostic block fails open" {
  let raw = "TAP version 13\n# Subtest: broken\nnot ok 1 - broken\n  ---\n  duration_ms: 2\n  location: a\n  error: x\n  expected: 1\n  actual: 2\n  failureType: x\n"
  assert_eq(
    str(field(request_for(raw, None, 10000), "decision")),
    Some("fallback"),
  )
}

///|
test "reordered original lines rejected" {
  let raw = sample_tap()
  let candidate = raw.replace(
    old="  expected: 1\n  actual: 2",
    new="  actual: 2\n  expected: 1",
  )
  assert_eq(
    str(field(request_for(raw, Some(candidate), 10000), "decision")),
    Some("fallback"),
  )
}

///|
test "deep JSON rejected before recursive parse" {
  let source = "[".repeat(65) + "0" + "]".repeat(65)
  assert_true(guard_request(source).contains("request_budget_exceeded"))
}

///|
test "malformed JSON request is a transport error" {
  assert_true(guard_request("{").contains("invalid_json_request"))
}

///|
test "candidate cannot add independent status assertions" {
  let raw = sample_tap()
  assert_eq(
    str(
      field(
        request_for(raw, Some(raw + "All tests passed.\n"), 10000),
        "decision",
      ),
    ),
    Some("fallback"),
  )
}

///|
test "Unicode evidence is preserved byte for code unit" {
  let raw = sample_tap().replace(
    old="expected 1 got 2",
    new="预期 1，实际 2 🐈",
  )
  assert_true(
    str(field(request_for(raw, None, 10000), "output"))
    .unwrap()
    .contains("预期 1，实际 2 🐈"),
  )
}
