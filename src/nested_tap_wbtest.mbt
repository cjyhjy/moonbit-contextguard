///|
fn nested_sample(depth : Int32) -> String {
  let mut block = "# Subtest: leaf\nok 1 - leaf\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n"
  for i = 0; i < depth; i = i + 1 {
    let indented = block
      .split("\n")
      .filter(s => s != "")
      .map(s => "    " + s.to_owned())
      .collect()
      .join("\n")
    block = "# Subtest: suite \{i}\n" +
      indented +
      "\n    1..1\nok 1 - suite \{i}\n  ---\n  duration_ms: 1\n  type: 'suite'\n  ...\n"
  }
  "TAP version 13\n" +
  block +
  "1..1\n# tests 1\n# suites \{depth}\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 2\n"
}

///|
test "nested depth is bounded before untrusted recursive descent" {
  assert_eq(parse_tap(lines_of(nested_sample(32)), 0).error, "")
  assert_eq(parse_tap(lines_of(nested_sample(33)), 0).error, "tap_depth_limit")
}

///|
test "passing nested branches are removable only after validating all children" {
  let raw = nested_sample(2)
  let parsed = parse_tap(lines_of(raw), 0)
  assert_eq(parsed.error, "")
  assert_eq(parsed.units.length(), 3)
  assert_false(parsed.units[1].required)
  let bad = raw.replace(old="    ok 1 - suite 0", new="    ok 9 - suite 0")
  assert_eq(parse_tap(lines_of(bad), 0).error, "tap_identity_mismatch")
}

///|
test "unknown or duplicate diagnostics never vanish with a passing branch" {
  for
    extra in ["  type: 'test'\n", "  duration_ms: 2\n", "  error: unexpected\n"] {
    let raw = nested_sample(1).replace(
      old="  type: 'suite'\n",
      new="  type: 'suite'\n" + extra,
    )
    assert_true(parse_tap(lines_of(raw), 0).error != "")
  }
}
