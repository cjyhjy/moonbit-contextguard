///|
/// Validate and repair a bounded tool-output excerpt supplied as a JSON request.
/// The caller supplies trusted process metadata. The result is a JSON response;
/// unsupported or unverifiable output passes through unchanged.
pub fn guard_request(request_json : String) -> String {
  @core.guard_request(request_json)
}
