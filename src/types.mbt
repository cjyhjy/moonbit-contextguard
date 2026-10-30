///|
priv struct EvidenceUnit {
  kind : String
  start : Int32
  stop : Int32
  required : Bool
}

///|
priv struct Parsed {
  units : Array[EvidenceUnit]
  error : String
}

///|
fn field(j : Json, key : String) -> Json {
  match j {
    Object(m) => m.get(key).unwrap_or(Json::null())
    _ => Json::null()
  }
}

///|
fn str(j : Json) -> String? {
  match j {
    String(s) => Some(s)
    _ => None
  }
}

///|
fn integer(j : Json) -> Int32? {
  match j {
    Number(n, ..) =>
      if n >= -2147483648.0 && n <= 2147483647.0 && n.to_int().to_double() == n {
        Some(n.to_int())
      } else {
        None
      }
    _ => None
  }
}

///|
fn num(n : Int32) -> Json {
  Json::number(n.to_double())
}

///|
fn obj(fields : Array[(String, Json)]) -> Json {
  Json::object(Map(fields))
}

///|
fn lines_of(s : String) -> Array[String] {
  let lines = s.split("\n").map(v => v.to_owned()).collect()
  if lines.length() > 0 && lines[lines.length() - 1] == "" {
    ignore(lines.pop())
  }
  lines
}

///|
// Enforce the line budget before allocating a split array. A final newline
// terminates the preceding line; it does not create another source unit.
fn line_budget_ok(s : String) -> Bool {
  let mut count = if s == "" || s.has_suffix("\n") { 0 } else { 1 }
  for c in s.iter() {
    if c == '\n' {
      count = count + 1
      if count > 50000 {
        return false
      }
    }
  }
  true
}

///|
fn excerpt(lines : Array[String], start : Int32, stop : Int32) -> String {
  let out : Array[String] = []
  for i = start; i < stop; i = i + 1 {
    out.push(lines[i])
  }
  out.join("\n")
}

///|
fn failed(reason : String) -> Parsed {
  { units: [], error: reason, }
}

///|
fn parse_json(s : String) -> Json? {
  Some(@json.parse(s)) catch {
    _ => None
  }
}

///|
fn has_field(j : Json, key : String) -> Bool {
  match j {
    Object(m) => m.get(key) is Some(_)
    _ => false
  }
}

///|
fn only_fields(j : Json, allowed : Array[String]) -> Bool {
  guard j is Object(m) else { return false }
  for key, _ in m {
    if !allowed.contains(key) {
      return false
    }
  }
  true
}

///|
// Call only after successful JSON parsing. The parser folds duplicate object
// keys; scan the original tokens so alternate consumers cannot interpret an
// event differently. Decode escaped keys before comparing them. Arrays have
// their own stack frame, and repeated keys in separate objects are valid.
fn json_keys_unique(s : String) -> Bool {
  let frames : Array[Map[String, Bool]?] = []
  let chars = s.code_units()
  let mut i = 0
  while i < chars.length() {
    match chars[i].to_int() {
      123 => frames.push(Some(Map([]))) // {
      91 => frames.push(None) // [
      125 | 93 => ignore(frames.pop())
      34 => {
        let start = i
        i = i + 1
        while i < chars.length() && chars[i].to_int() != 34 {
          if chars[i].to_int() == 92 { // escaped code unit
            i = i + 1
          }
          i = i + 1
        }
        let stop = i + 1
        let mut next = stop
        while next < chars.length() &&
              (
                chars[next].to_int() == 32 ||
                chars[next].to_int() == 9 ||
                chars[next].to_int() == 10 ||
                chars[next].to_int() == 13
              ) {
          next = next + 1
        }
        if next < chars.length() && chars[next].to_int() == 58 {
          guard frames.length() > 0 && frames[frames.length() - 1] is Some(keys) else {
            return false
          }
          guard parse_json(s[start:stop].to_owned()) is Some(String(key)) else {
            return false
          }
          if keys.get(key) is Some(_) {
            return false
          }
          keys[key] = true
        }
      }
      _ => ()
    }
    i = i + 1
  }
  true
}

///|
// Bound recursion before handing untrusted text to the standard JSON parser.
fn json_depth_ok(s : String) -> Bool {
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for c in s.iter() {
    if quoted {
      if escaped {
        escaped = false
      } else if c == '\\' {
        escaped = true
      } else if c == '"' {
        quoted = false
      }
    } else if c == '"' {
      quoted = true
    } else if c == '{' || c == '[' {
      depth = depth + 1
      if depth > 64 {
        return false
      }
    } else if c == '}' || c == ']' {
      depth = depth - 1
    }
  }
  true
}
