///|
// ripgrep encodes non-UTF-8 content as base64. Exactly one representation is
// allowed; offsets and submatches are byte ranges, never UTF-16 indices.
fn rg_bytes(j : Json) -> Bytes? {
  guard j is Object(m) && m.length() == 1 else { return None }
  if str(field(j, "text")) is Some(s) {
    return Some(@utf8.encode(s))
  }
  if str(field(j, "bytes")) is Some(s) {
    return Some(@base64.decode(s)) catch { _ => None }
  }
  None
}

///|
fn rg_elapsed(j : Json) -> Bool {
  only_fields(j, ["secs", "nanos", "human"]) &&
  (integer(field(j, "secs")) is Some(n) && n >= 0) &&
  (integer(field(j, "nanos")) is Some(n) && n >= 0 && n < 1000000000) &&
  str(field(j, "human")) is Some(s) &&
  s.has_suffix("s") &&
  valid_duration(s[:s.length() - 1].to_owned())
}

///|
// Minimal fixtures may omit ancillary timing/byte counters, but any supplied
// fields must be known and well typed before a file boundary can be omitted.
fn rg_stats(j : Json) -> Bool {
  if !only_fields(j, [
      "elapsed", "searches", "searches_with_match", "bytes_searched", "bytes_printed",
      "matched_lines", "matches",
    ]) {
    return false
  }
  for
    key in [
      "searches", "searches_with_match", "bytes_searched", "bytes_printed", "matched_lines",
      "matches",
    ] {
    if has_field(j, key) && !(integer(field(j, key)) is Some(n) && n >= 0) {
      return false
    }
  }
  !has_field(j, "elapsed") || rg_elapsed(field(j, "elapsed"))
}

///|
// This profile covers single input lines. Multiline and NUL-delimited output
// are kept intact through the fallback path instead of interpreting offsets
// using an incompatible line model.
fn rg_single_line(bytes : Bytes) -> Bool {
  for i, byte in bytes {
    if byte == 0 || (byte == 10 && i != bytes.length() - 1) {
      return false
    }
  }
  true
}

///|
fn parse_rg(lines : Array[String], exit_code : Int32) -> Parsed {
  let units : Array[EvidenceUnit] = []
  let mut active : Bytes? = None
  let mut begin_index = 0
  let mut summary = false
  let mut match_lines = 0
  let mut matches = 0
  let mut searched = 0
  let mut matched_files = 0
  let mut file_lines = 0
  let mut file_matches = 0
  let mut file_records = 0
  let mut previous_line = 0
  let mut previous_end = 0
  let mut previous_terminated = true
  for i, line in lines {
    if summary {
      return failed("rg_records_after_summary")
    }
    if !json_depth_ok(line) {
      return failed("json_depth_limit")
    }
    guard parse_json(line) is Some(j) else { return failed("rg_invalid_json") }
    if !json_keys_unique(line) {
      return failed("rg_duplicate_json_key")
    }
    if !only_fields(j, ["type", "data"]) {
      return failed("rg_unknown_fields")
    }
    let data = field(j, "data")
    guard str(field(j, "type")) is Some(kind) else {
      return failed("rg_missing_type")
    }
    let required = match kind {
      "begin" => {
        if !only_fields(data, ["path"]) {
          return failed("rg_unknown_fields")
        }
        guard active is None &&
          rg_bytes(field(data, "path")) is Some(path) &&
          path.length() > 0 else {
          return failed("rg_invalid_begin")
        }
        active = Some(path)
        begin_index = units.length()
        searched = searched + 1
        file_lines = 0
        file_matches = 0
        file_records = 0
        previous_line = 0
        previous_end = 0
        previous_terminated = true
        false
      }
      "end" => {
        if !only_fields(data, ["path", "binary_offset", "stats"]) {
          return failed("rg_unknown_fields")
        }
        guard active is Some(path) &&
          rg_bytes(field(data, "path")) == Some(path) else {
          return failed("rg_invalid_end")
        }
        if !has_field(data, "binary_offset") {
          return failed("rg_missing_binary_offset")
        }
        if !(field(data, "binary_offset") is Null) {
          return failed("rg_binary_output")
        }
        let stats = field(data, "stats")
        if !rg_stats(stats) {
          return failed("rg_invalid_stats")
        }
        if integer(field(stats, "matched_lines")) != Some(file_lines) ||
          integer(field(stats, "matches")) != Some(file_matches) {
          return failed("rg_file_count_mismatch")
        }
        let has_matches = if file_lines > 0 { 1 } else { 0 }
        if (
            has_field(stats, "searches") &&
            integer(field(stats, "searches")) != Some(1)
          ) ||
          (
            has_field(stats, "searches_with_match") &&
            integer(field(stats, "searches_with_match")) != Some(has_matches)
          ) {
          return failed("rg_file_count_mismatch")
        }
        matched_files = matched_files + has_matches
        active = None
        // Otherwise a zero-record file's only path evidence would disappear.
        if file_records == 0 {
          units[begin_index] = {
            kind: "begin",
            start: units[begin_index].start,
            stop: units[begin_index].stop,
            required: true,
          }
        }
        file_records == 0
      }
      "match" | "context" => {
        if !only_fields(data, [
            "path", "lines", "line_number", "absolute_offset", "submatches",
          ]) {
          return failed("rg_unknown_fields")
        }
        guard active is Some(path) &&
          rg_bytes(field(data, "path")) == Some(path) &&
          rg_bytes(field(data, "lines")) is Some(content) else {
          return failed("rg_invalid_record")
        }
        if !rg_single_line(content) {
          return failed("rg_unsupported_line_encoding")
        }
        guard integer(field(data, "line_number")) is Some(line_number) &&
          line_number > 0 else {
          return failed("rg_missing_position")
        }
        guard integer(field(data, "absolute_offset")) is Some(offset) &&
          offset >= 0 &&
          offset <= 2147483647 - content.length() else {
          return failed("rg_missing_offset")
        }
        if line_number <= previous_line ||
          offset < previous_end ||
          !previous_terminated ||
          (
            previous_line > 0 &&
            line_number == previous_line + 1 &&
            offset != previous_end
          ) {
          return failed("rg_inconsistent_position")
        }
        previous_line = line_number
        previous_end = offset + content.length()
        previous_terminated = content.length() > 0 &&
          content[content.length() - 1] == 10
        file_records = file_records + 1
        guard field(data, "submatches") is Array(subs) else {
          return failed("rg_missing_submatches")
        }
        if kind == "match" {
          if subs.length() == 0 {
            return failed("rg_empty_match")
          }
          match_lines = match_lines + 1
          matches = matches + subs.length()
          file_lines = file_lines + 1
          file_matches = file_matches + subs.length()
        }
        let mut sub_end = 0
        for sub in subs {
          if !only_fields(sub, ["match", "start", "end"]) {
            return failed("rg_unknown_fields")
          }
          guard integer(field(sub, "start")) is Some(start) && start >= sub_end else {
            return failed("rg_invalid_submatch")
          }
          guard integer(field(sub, "end")) is Some(stop) &&
            stop >= start &&
            stop <= content.length() else {
            return failed("rg_invalid_submatch")
          }
          guard rg_bytes(field(sub, "match")) is Some(matched) &&
            matched.length() == stop - start else {
            return failed("rg_invalid_submatch")
          }
          for k = 0; k < matched.length(); k = k + 1 {
            if content[start + k] != matched[k] {
              return failed("rg_submatch_content_mismatch")
            }
          }
          sub_end = stop
        }
        true
      }
      "summary" => {
        if active is Some(_) {
          return failed("rg_unclosed_file")
        }
        if !only_fields(data, ["elapsed_total", "stats"]) ||
          (
            has_field(data, "elapsed_total") &&
            !rg_elapsed(field(data, "elapsed_total"))
          ) {
          return failed("rg_unknown_fields")
        }
        let stats = field(data, "stats")
        if !rg_stats(stats) {
          return failed("rg_invalid_stats")
        }
        if integer(field(stats, "matched_lines")) != Some(match_lines) ||
          integer(field(stats, "matches")) != Some(matches) ||
          (
            has_field(stats, "searches_with_match") &&
            integer(field(stats, "searches_with_match")) != Some(matched_files)
          ) {
          return failed("rg_count_mismatch")
        }
        guard integer(field(stats, "searches")) is Some(n) && n >= searched else {
          return failed("rg_missing_scope_count")
        }
        summary = true
        true
      }
      _ => return failed("rg_unknown_record")
    }
    units.push({ kind, start: i, stop: i + 1, required, })
  }
  if !summary {
    return failed("rg_missing_summary")
  }
  if exit_code != (if matches > 0 { 0 } else { 1 }) {
    return failed("rg_exit_mismatch")
  }
  { units, error: "", }
}
