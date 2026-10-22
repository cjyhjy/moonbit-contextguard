///|
fn rg_text(j : Json) -> Bool {
  str(field(j, "text")) is Some(_) || str(field(j, "bytes")) is Some(_)
}

///|
fn parse_rg(lines : Array[String], exit_code : Int) -> Parsed {
  let units : Array[EvidenceUnit] = []
  let mut active = ""
  let mut summary = false
  let mut match_lines = 0
  let mut matches = 0
  let mut searched = 0
  for i, line in lines {
    if summary { return failed("rg_records_after_summary") }
    if !json_depth_ok(line) { return failed("json_depth_limit") }
    guard parse_json(line) is Some(j) else { return failed("rg_invalid_json") }
    let data = field(j, "data")
    guard str(field(j, "type")) is Some(kind) else { return failed("rg_missing_type") }
    let required = match kind {
      "begin" => {
        if active != "" || !rg_text(field(data, "path")) { return failed("rg_invalid_begin") }
        active = field(data, "path").stringify()
        searched = searched + 1
        false
      }
      "end" => {
        if active == "" || active != field(data, "path").stringify() { return failed("rg_invalid_end") }
        active = ""
        false
      }
      "match" | "context" => {
        if active == "" || active != field(data, "path").stringify() || !rg_text(field(data, "lines")) {
          return failed("rg_invalid_record")
        }
        guard integer(field(data, "line_number")) is Some(n) && n > 0 else { return failed("rg_missing_position") }
        guard integer(field(data, "absolute_offset")) is Some(n) && n >= 0 else { return failed("rg_missing_offset") }
        guard field(data, "submatches") is Array(subs) else { return failed("rg_missing_submatches") }
        if kind == "match" {
          if subs.length() == 0 { return failed("rg_empty_match") }
          match_lines = match_lines + 1
          matches = matches + subs.length()
        }
        for sub in subs {
          guard integer(field(sub, "start")) is Some(start) && start >= 0 else { return failed("rg_invalid_submatch") }
          guard integer(field(sub, "end")) is Some(stop) && stop >= start else { return failed("rg_invalid_submatch") }
          if !rg_text(field(sub, "match")) { return failed("rg_invalid_submatch") }
        }
        true
      }
      "summary" => {
        if active != "" { return failed("rg_unclosed_file") }
        let stats = field(data, "stats")
        if integer(field(stats, "matched_lines")) != Some(match_lines) || integer(field(stats, "matches")) != Some(matches) {
          return failed("rg_count_mismatch")
        }
        guard integer(field(stats, "searches")) is Some(n) && n >= searched else { return failed("rg_missing_scope_count") }
        summary = true
        true
      }
      _ => return failed("rg_unknown_record")
    }
    units.push({ kind, start: i, stop: i + 1, required })
  }
  if !summary { return failed("rg_missing_summary") }
  if exit_code != (if matches > 0 { 0 } else { 1 }) { return failed("rg_exit_mismatch") }
  { units, error: "" }
}
