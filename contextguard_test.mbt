///|
fn response(
  raw : String,
  candidate : Json,
  limit : Int32,
  format : String,
) -> Json raise {
  let request : Json = {
    "format": format,
    "raw": raw,
    "candidate": candidate,
    "max_output_chars": limit,
    "process": {
      "exit_code": 0,
      "scope": ["node", "--test"],
      "truncated": false,
    },
  }
  @json.parse(@contextguard.guard_request(request.stringify())) catch {
    _ => fail("invalid response JSON")
  }
}

///|
fn tap() -> String {
  "TAP version 13\n# Subtest: example\nok 1 - example\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n"
}

///|
test "public library compresses supported evidence" {
  let result = response(tap(), Json::null(), 16000, "node-tap")
  assert_eq(field(result, "decision"), Some(Json::string("compressed")))
  assert_eq(
    field(result, "assurance"),
    Some(Json::string("required_source_units_verified")),
  )
}

///|
test "public library accepts original candidate" {
  let result = response(tap(), Json::string(tap()), 16000, "node-tap")
  assert_eq(field(result, "decision"), Some(Json::string("accepted")))
}

///|
test "public library repairs missing evidence" {
  let result = response(tap(), Json::string(""), 16000, "node-tap")
  assert_eq(field(result, "decision"), Some(Json::string("repaired")))
}

///|
test "public library falls back on tampering and small budget" {
  for candidate in [Json::string("invented evidence\n"), Json::null()] {
    let result = response(tap(), candidate, 0, "node-tap")
    assert_eq(field(result, "decision"), Some(Json::string("fallback")))
    assert_eq(field(result, "output"), Some(Json::string(tap())))
  }
}

///|
test "public library preserves unknown formats" {
  let raw = "unknown output\nUnicode: 月兔\n"
  let result = response(raw, Json::null(), 16000, "unknown")
  assert_eq(field(result, "decision"), Some(Json::string("fallback")))
  assert_eq(field(result, "output"), Some(Json::string(raw)))
}

///|
test "public library rejects malformed and duplicate key requests" {
  for request in ["{", "{\"raw\":\"a\",\"raw\":\"b\"}"] {
    assert_eq(
      @contextguard.guard_request(request),
      "{\"error\":\"invalid_json_request\"}",
    )
  }
}

///|
fn field(value : Json, key : String) -> Json? {
  match value {
    Object(fields) => fields.get(key)
    _ => None
  }
}

///|
fn nested_public_sample() -> String {
  "TAP version 13\n# Subtest: parent suite\n    # Subtest: ordinary pass\n    ok 1 - ordinary pass\n      ---\n      duration_ms: 1\n      type: 'test'\n      ...\n    # Subtest: skipped child\n    ok 2 - skipped child # SKIP\n      ---\n      duration_ms: 1\n      type: 'test'\n      ...\n    1..2\nok 1 - parent suite\n  ---\n  duration_ms: 2\n  type: 'suite'\n  ...\n1..1\n# tests 2\n# suites 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 3\n"
}

///|
test "public library keeps nested skipped evidence with its enclosing scope" {
  let raw = nested_public_sample()
  let result = response(raw, Json::null(), 16000, "node-tap")
  assert_eq(field(result, "decision"), Some(Json::string("compressed")))
  assert_eq(field(result, "output"), Some(Json::string(raw)))
}

///|
test "public library repairs nested source deletions without accepting changed child status" {
  let raw = nested_public_sample()
  let missing = raw.replace(old="    ok 2 - skipped child # SKIP\n", new="")
  let repaired = response(raw, Json::string(missing), 16000, "node-tap")
  assert_eq(field(repaired, "decision"), Some(Json::string("repaired")))
  assert_eq(field(repaired, "output"), Some(Json::string(raw)))
  let changed = raw.replace(
    old="skipped child # SKIP",
    new="skipped child # TODO",
  )
  let rejected = response(raw, Json::string(changed), 16000, "node-tap")
  assert_eq(field(rejected, "decision"), Some(Json::string("fallback")))
  assert_eq(field(rejected, "output"), Some(Json::string(raw)))
}
