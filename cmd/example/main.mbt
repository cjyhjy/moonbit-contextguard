///|
fn main {
  let request =
    #|{"format":"node-tap","raw":"TAP version 13\n# Subtest: example\nok 1 - example\n  ---\n  duration_ms: 1\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n","process":{"exit_code":0,"scope":["node","--test","example.test.cjs"],"truncated":false}}
  println(@guard.guard_request(request))
}
