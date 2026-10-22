///|
priv struct EvidenceUnit {
  kind : String
  start : Int
  stop : Int
  required : Bool
}

///|
priv struct Parsed {
  units : Array[EvidenceUnit]
  error : String
}

///|
fn field(j : Json, key : String) -> Json {
  match j { Object(m) => m.get(key).unwrap_or(Json::null()); _ => Json::null() }
}

///|
fn str(j : Json) -> String? { match j { String(s) => Some(s); _ => None } }

///|
fn integer(j : Json) -> Int? {
  match j {
    Number(n, ..) => if n >= -2147483648.0 && n <= 2147483647.0 && n.to_int().to_double() == n { Some(n.to_int()) } else { None }
    _ => None
  }
}

///|
fn num(n : Int) -> Json { Json::number(n.to_double()) }

///|
fn obj(fields : Array[(String, Json)]) -> Json { Json::object(Map(fields)) }

///|
fn lines_of(s : String) -> Array[String] {
  let lines = s.split("\n").map(v => v.to_owned()).collect()
  if lines.length() > 0 && lines[lines.length()-1] == "" { ignore(lines.pop()) }
  lines
}

///|
fn excerpt(lines : Array[String], start : Int, stop : Int) -> String {
  let out : Array[String] = []
  for i = start; i < stop; i = i + 1 { out.push(lines[i]) }
  out.join("\n")
}

///|
fn failed(reason : String) -> Parsed { { units: [], error: reason } }

///|
fn parse_json(s : String) -> Json? {
  try { Some(@json.parse(s)) } catch { _ => None }
}

///|
// Bound recursion before handing untrusted text to the standard JSON parser.
fn json_depth_ok(s : String) -> Bool {
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for c in s.iter() {
    if quoted {
      if escaped { escaped = false } else if c == '\\' { escaped = true } else if c == '"' { quoted = false }
    } else if c == '"' { quoted = true }
    else if c == '{' || c == '[' { depth = depth + 1; if depth > 64 { return false } }
    else if c == '}' || c == ']' { depth = depth - 1 }
  }
  true
}
