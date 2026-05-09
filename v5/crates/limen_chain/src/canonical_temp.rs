// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Canonical serialization adapter — delegates to `limen_canonical::CanonicalMsgPackSerializer`.
//!
//! M3 originally had a standalone `rmp_serde::to_vec` helper. M4 v1.1 replaced
//! the implementation with a custom fixed-width serializer in `limen_canonical`.
//! This wrapper delegates to `CanonicalSerialize::canonical_bytes()` which uses
//! `CanonicalMsgPackSerializer` (not `rmp_serde`).
//!
//! DISPOSITION: This wrapper remains for M4. Removal scheduled separately.

use serde::Serialize;
use limen_canonical::CanonicalSerialize;

/// Canonical MessagePack bytes via limen_canonical.
/// Thin wrapper delegating to `CanonicalSerialize::canonical_bytes()`.
pub(crate) fn to_canonical_bytes<T: Serialize>(value: &T) -> Vec<u8> {
    value.canonical_bytes()
}
