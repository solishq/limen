#![forbid(unsafe_code)]
//! # limen_canonical
//!
//! Canonical serialization for Limen v5.
//! Authority: Document 27 v1.3 Section 10.
//!
//! Two traits:
//! - `CanonicalSerialize` — canonical MessagePack bytes (§10.2 rules 1-4, 6-7)
//! - `CanonicalJson` — canonical JSON bytes (§10.2 rule 5)
//!
//! Data flow contract (§10.3): `canonical_bytes()` serializes from in-memory
//! structured data (`self`), never from stored `payload_json` text.

pub mod traits;
pub mod msgpack;
pub mod json;
pub mod guards;

pub use traits::{CanonicalSerialize, CanonicalJson};
pub use guards::CanonicalBTreeMap;
