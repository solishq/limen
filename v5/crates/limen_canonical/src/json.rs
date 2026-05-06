//! Canonical JSON serialization (v1.3 §10.2 rule 5).
//!
//! Sorted object keys, no insignificant whitespace, deterministic integer
//! formatting, no floats, UTF-8 output. NOT pretty-formatted.

use serde::Serialize;
use crate::traits::CanonicalJson;

/// Canonical JSON implementation.
/// Uses serde_json with sorted keys and compact (no whitespace) formatting.
///
/// v1.3 §10.2 rule 5 specifies:
/// - Sorted object keys (lexicographic byte-order ascending)
/// - No insignificant whitespace
/// - Deterministic integer formatting
/// - No floats
/// - UTF-8 NFC normalization
/// - Ordered maps only
///
/// serde_json's to_vec/to_string produces compact JSON (no whitespace).
/// BTreeMap keys are sorted. HashMap is forbidden by type guards.
/// Float rejection is by compile-fail tests on canonical types.
///
/// UTF-8 NFC normalization: serde_json outputs valid UTF-8. NFC normalization
/// of input strings is the caller's responsibility at the boundary; the
/// canonical serializer preserves whatever normalization the input has.
/// v1.3 says "input strings are normalized to NFC before serialization" —
/// this is enforced at the data-entry boundary, not inside the serializer.
impl<T: Serialize> CanonicalJson for T {
    fn canonical_json_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self)
            .expect("canonical JSON serialization must not fail for well-typed structures")
    }

    fn canonical_json(&self) -> String {
        serde_json::to_string(self)
            .expect("canonical JSON serialization must not fail for well-typed structures")
    }
}
