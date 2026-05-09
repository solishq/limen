// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! # limen_api
//!
//! Public API surface for Limen v5 substrate (v1.3 §14).
//! Application code (Tiva, Accipio, Veridion) depends on this crate only.
//! Exposes six operations: submit_transition, query_projection,
//! get_projection_status, rebuild_projection, verify_chain, export_audit_slice.
//!
//! Does NOT expose: direct chain mutation, direct projection mutation,
//! capability minting, substrate-internal AI, structural parameter config.
