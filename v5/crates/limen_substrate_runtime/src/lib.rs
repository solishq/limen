#![forbid(unsafe_code)]
//! # limen_substrate_runtime
//!
//! Dispatcher, capability minting, envelope construction, sealed FoundationOpsRegistry.
//! Contains: `dispatch_foundation` helper (v1.3 §3.3), `commit_decision` (v1.3 §1.3),
//! capability minting protocol (v1.3 §2.2), sealed operation registration (v1.3 §0.3).
//!
//! MUST NOT depend on: limen_projection (v1.3 §0.2).
