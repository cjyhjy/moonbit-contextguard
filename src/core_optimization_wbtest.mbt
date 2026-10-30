///|
fn rg_sample() -> String {
  "{\"type\":\"begin\",\"data\":{\"path\":{\"text\":\"a.txt\"}}}\n{\"type\":\"match\",\"data\":{\"path\":{\"text\":\"a.txt\"},\"lines\":{\"text\":\"猫needle\\n\"},\"line_number\":1,\"absolute_offset\":0,\"submatches\":[{\"match\":{\"text\":\"needle\"},\"start\":3,\"end\":9}]}}\n{\"type\":\"end\",\"data\":{\"path\":{\"text\":\"a.txt\"},\"binary_offset\":null,\"stats\":{\"matched_lines\":1,\"matches\":1}}}\n{\"type\":\"summary\",\"data\":{\"stats\":{\"matched_lines\":1,\"matches\":1,\"searches\":1}}}\n"
}

///|
fn rg_result(raw : String, exit_code : Int32, candidate : String?) -> Json {
  parse_json(
    guard_request(
      obj([
        ("format", Json::string("rg-json")),
        ("raw", Json::string(raw)),
        (
          "candidate",
          match candidate {
            Some(s) => Json::string(s)
            None => Json::null()
          },
        ),
        (
          "process",
          obj([
            ("exit_code", num(exit_code)),
            ("scope", Json::array([Json::string("fixture")])),
            ("truncated", Json::boolean(false)),
          ]),
        ),
      ]).stringify(),
    ),
  ).unwrap()
}

///|
test "rg UTF8 and base64 ranges are byte ranges" {
  let raw = rg_sample()
  assert_eq(str(field(rg_result(raw, 0, None), "decision")), Some("compressed"))
  let encoded = raw.replace(
    old="\"text\":\"猫needle\\n\"",
    new="\"bytes\":\"54yrbmVlZGxlCg==\"",
  )
  assert_eq(
    str(field(rg_result(encoded, 0, None), "decision")),
    Some("compressed"),
  )
  let wrong = raw.replace(
    old="\"start\":3,\"end\":9",
    new="\"start\":1,\"end\":7",
  )
  assert_eq(
    str(field(rg_result(wrong, 0, None), "reason")),
    Some("rg_submatch_content_mismatch"),
  )
}

///|
test "rg unknown dropped boundary metadata stays in original" {
  let raw = rg_sample().replace(
    old="\"binary_offset\":null",
    new="\"binary_offset\":null,\"error\":\"permission denied\"",
  )
  let result = rg_result(raw, 0, None)
  assert_eq(str(field(result, "decision")), Some("fallback"))
  assert_eq(str(field(result, "output")), Some(raw))
  let missing = rg_sample().replace(old="\"binary_offset\":null,", new="")
  assert_eq(
    str(field(rg_result(missing, 0, None), "reason")),
    Some("rg_missing_binary_offset"),
  )
}

///|
test "rg malformed or ambiguous tagged bytes cannot be verified" {
  for
    replacement in [
      "\"text\":\"猫needle\\n\",\"bytes\":\"54yrbmVlZGxlCg==\"", "\"bytes\":\"not base64!\"",
    ] {
    let raw = rg_sample().replace(
      old="\"text\":\"猫needle\\n\"",
      new=replacement,
    )
    assert_eq(str(field(rg_result(raw, 0, None), "decision")), Some("fallback"))
  }
}

///|
test "duplicate escaped event keys cannot hide an earlier interpretation" {
  let raw = rg_sample().replace(
    old="\"type\":\"begin\"",
    new="\"ty\\u0070e\":\"error\",\"type\":\"begin\"",
  )
  assert_eq(
    str(field(rg_result(raw, 0, None), "reason")),
    Some("rg_duplicate_json_key"),
  )
  assert_false(json_keys_unique("{\"a\":1,\"\\u0061\":2}"))
  assert_false(json_keys_unique("{\"x\":[{\"a\":1,\"a\":2}]}"))
  assert_true(
    json_keys_unique("{\"a\":[{\"a\":1},{\"a\":2}],\"b\":\"\\\"a\\\":,{}[]\"}"),
  )
}

///|
test "raw request duplicate keys fail before selecting raw or process" {
  let result = parse_json(
    guard_request("{\"raw\":\"first\",\"r\\u0061w\":\"second\"}"),
  ).unwrap()
  assert_eq(str(field(result, "error")), Some("invalid_json_request"))
}

///|
test "zero record file retains only occurrence of path" {
  let raw = "{\"type\":\"begin\",\"data\":{\"path\":{\"text\":\"only-path.txt\"}}}\n{\"type\":\"end\",\"data\":{\"path\":{\"text\":\"only-path.txt\"},\"binary_offset\":null,\"stats\":{\"matched_lines\":0,\"matches\":0}}}\n{\"type\":\"summary\",\"data\":{\"stats\":{\"matched_lines\":0,\"matches\":0,\"searches\":1}}}\n"
  assert_eq(str(field(rg_result(raw, 1, None), "output")), Some(raw))
  let lines = lines_of(raw)
  let repaired = rg_result(raw, 1, Some(lines[2] + "\n"))
  assert_eq(str(field(repaired, "decision")), Some("repaired"))
  assert_eq(str(field(repaired, "output")), Some(raw))
}

///|
test "identical required units need independent occurrences" {
  let raw = ["same", "same", "tail"]
  let units = [
    { kind: "record", start: 0, stop: 1, required: true, },
    { kind: "record", start: 1, stop: 2, required: true, },
    { kind: "summary", start: 2, stop: 3, required: true, },
  ]
  let verdict = validate_candidate(raw, units, "same\ntail\n")
  assert_eq(verdict.missing, 1)
  assert_true(verdict.provenance)
  assert_true(verdict.whole_units)
}

///|
test "matching lines from partial units cannot be accepted as all whole units" {
  let raw = ["same", "first", "same", "second", "tail"]
  let units = [
    { kind: "record", start: 0, stop: 2, required: true, },
    { kind: "record", start: 2, stop: 4, required: true, },
    { kind: "summary", start: 4, stop: 5, required: true, },
  ]
  let verdict = validate_candidate(raw, units, "same\nsecond\ntail\n")
  assert_eq(verdict.missing, 1)
  assert_true(verdict.provenance)
}

///|
test "line count budget includes exact limit before split allocation" {
  assert_true(line_budget_ok(""))
  assert_true(line_budget_ok("\n".repeat(50000)))
  assert_true(line_budget_ok("\n".repeat(49999) + "tail"))
  assert_false(line_budget_ok("\n".repeat(50001)))
  assert_false(line_budget_ok("\n".repeat(50000) + "tail"))
  let result = request_for(sample_tap(), Some("\n".repeat(50001)), 10000)
  assert_eq(
    str(field(result, "reason")),
    Some("candidate_line_budget_exceeded"),
  )
}
