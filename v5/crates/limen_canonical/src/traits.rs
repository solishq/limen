//! Canonical serialization traits (v1.3 §10.3).
//!
//! CONTRACT: `canonical_bytes()` and `canonical_json_bytes()` serialize from
//! the in-memory structured Rust value (`self`). They NEVER accept previously
//! serialized text and re-canonicalize it. Re-canonicalizing stored JSON text
//! is forbidden in the digest path (v1.3 §8.2, §10.3).

use serde::Serialize;

/// Produces canonical MessagePack bytes per v1.3 §10.2 rules.
///
/// Rules enforced:
/// 1. Sorted map keys (lexicographic byte-order ascending)
/// 2. Deterministic field order (struct declaration order)
/// 3. Deterministic integer width (declared Rust type width, no auto-narrowing)
/// 4. No floats in canonical structures
/// 6. No MessagePack extension types
/// 7. Fixed length-prefix encoding
pub trait CanonicalSerialize: Serialize {
    /// Produce canonical MessagePack bytes from this structured value.
    fn canonical_bytes(&self) -> Vec<u8>;
}

/// Produces canonical JSON bytes per v1.3 §10.2 rule 5.
///
/// Rules enforced:
/// - Sorted object keys (lexicographic byte-order ascending)
/// - No insignificant whitespace
/// - Deterministic integer formatting (no leading zeros, no scientific notation)
/// - No floats
/// - UTF-8 NFC normalization
/// - Ordered maps only
pub trait CanonicalJson: Serialize {
    /// Produce canonical JSON bytes. NOT pretty-formatted.
    fn canonical_json_bytes(&self) -> Vec<u8>;

    /// Produce canonical JSON as UTF-8 string. Same bytes as `canonical_json_bytes`.
    fn canonical_json(&self) -> String;
}
