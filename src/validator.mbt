///|
priv struct Verdict {
  missing : Int32
  whole_units : Bool
  provenance : Bool
}

///|
// This validator never consults the compressor's selection or candidate metadata.
// It scans candidate CONTENT against source units and checks every required unit.
fn validate_candidate(
  raw_lines : Array[String],
  units : Array[EvidenceUnit],
  candidate : String,
) -> Verdict {
  let lines = lines_of(candidate)
  let mut cursor = 0
  let mut missing = 0
  for unit in units {
    let size = unit.stop - unit.start
    let mut same = cursor + size <= lines.length()
    if same {
      for k = 0; k < size; k = k + 1 {
        if lines[cursor + k] != raw_lines[unit.start + k] {
          same = false
          break
        }
      }
    }
    if same {
      cursor = cursor + size
    } else if unit.required {
      missing = missing + 1
    }
  }
  // Partial units can be repaired, but novel text or reordering is rejected.
  let mut p = 0
  for line in raw_lines {
    if p < lines.length() && line == lines[p] {
      p = p + 1
    }
  }
  {
    missing,
    whole_units: cursor == lines.length(),
    provenance: p == lines.length(),
  }
}
