//! # limen_projection
//!
//! Projection storage, projector, certification, and validity states for Limen v5.
//! The view is non-authoritative (v1.3 §1.1 / DOC-19 §1).
//! Contains: projection schema (v1.3 §7.2), projector with determinism enforcement
//! (v1.3 §7.3.1), certification with full-state digest (v1.3 §8), validity states,
//! checkpointing (v1.3 §9), refusal_records projection.
