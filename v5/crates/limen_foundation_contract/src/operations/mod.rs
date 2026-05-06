//! Foundation operations co-located in limen_foundation_contract (M5.1 amendment).
//!
//! These operations were originally in `limen_foundation_ops` (M5). They are
//! co-located here so that the substrate dispatch loop (M6) can invoke them
//! with `pub(crate)` mint authority — structurally enforced by Rust visibility.
//!
//! Semantics are EXACTLY preserved from M5. No policy invention.

pub mod refusal;
pub mod authority;
pub mod governance;
pub mod cascade;
