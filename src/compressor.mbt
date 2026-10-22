///|
// Simple extractive producer. An external producer can replace this entire function.
// Acceptance is decided independently by validator.mbt.
fn compress(
  lines : Array[String],
  units : Array[EvidenceUnit],
  newline : Bool,
) -> String {
  let chosen : Array[String] = []
  for unit in units {
    if unit.required {
      for i = unit.start; i < unit.stop; i = i + 1 {
        chosen.push(lines[i])
      }
    }
  }
  chosen.join("\n") + (if newline && chosen.length() > 0 { "\n" } else { "" })
}
