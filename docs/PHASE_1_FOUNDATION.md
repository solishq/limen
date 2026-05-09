<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Phase 1 Foundation Traceability Matrix

> **NOTE (Finding-16):** This document was originally written for the v5 Rust substrate
> (`release/v5` branch, `v5/crates/` directory). The traceability matrix below references
> Rust crate implementations. The TypeScript kernel implementation in `src/kernel/` provides
> equivalent functionality but is traced separately in `CONTRACT-COMPLIANCE-v2.1.md`.
> This document is retained as the Rust v5 design source; it is NOT the traceability
> reference for the TypeScript implementation.

**Version:** 5.0.0-alpha.1
**Generated:** 2026-05-07
**Scope:** All public types, functions, and modules in the foundation crates
**Crates covered:** `limen_types`, `limen_foundation_contract`, `limen_chain`, `limen_foundation_ops`, `limen_canonical`

---

## Legend

- **Contract Clause:** Reference to governing spec section (v1.3 §N.M)
- **LCI Element:** Limen Contract Interface element classification
- **Test:** Test function name(s) that verify the element
- **Evidence:** Verification evidence type

---

## Traceability Matrix

| # | Implementation Element | Contract Clause | LCI Element | Test | Evidence |
|---|----------------------|-----------------|-------------|------|----------|
| 1 | `Blake3Hash` (limen_types) | v1.3 §0.7 Type Ownership | Primitive Type | `test_determinism_blake3_stable` (canonical) | 32-byte fixed-width hash, Copy+Eq+Hash+Serialize |
| 2 | `ChainSequence` (limen_types) | v1.3 §0.7, §6.1 | Primitive Type | `test_a_schema_semantic_introspection` | Monotonic u64, genesis()/next() methods |
| 3 | `TenantScope` (limen_types) | v1.3 §0.7, Property 5 | Primitive Type | `test_g_multi_tenant` | String-wrapped tenant identifier |
| 4 | `RequestedTenantScope` (limen_types) | v1.3 §4.1 | Primitive Type | `test_all_pass_produces_commit` (dispatch) | Proposer-claimed tenant, distinct from TenantScope |
| 5 | `SubstrateInstant` (limen_types) | v1.3 §0.7 | Primitive Type | `test_mint_envelope_fresh_per_operation` | Substrate-issued monotonic clock value |
| 6 | `ProposerTimestamp` (limen_types) | v1.3 §4.1 | Primitive Type | `test_refusal_accepts_valid_input` (ops) | Proposer-claimed time, treated as claim |
| 7 | `Actor` (limen_types) | v1.3 §0.7 | Primitive Type | `test_authority_rejects_identity_mismatch` (ops) | Authority/proposer actor identifier |
| 8 | `PolicyId` (limen_types) | v1.3 §0.7, Property 6 | Primitive Type | `test_governance_permits_when_no_policies` (ops) | Governance policy identifier |
| 9 | `InvocationId` (limen_types) | v1.3 §3.2 | Primitive Type | `test_dispatch_per_operation_field_independence` | Per-operation unique invocation identifier |
| 10 | `SchemaVersion` (limen_types) | v1.3 §4.1 | Primitive Type | `test_all_pass_produces_commit` (dispatch) | Payload schema version |
| 11 | `ProposerIdentity` (limen_types) | v1.3 §4.1 | Primitive Type | `test_authority_accepts_matching_identity` (ops) | Authenticated proposer identity |
| 12 | `ActorIdentity` (limen_types) | v1.3 §3.1 | Primitive Type | `test_authority_short_circuits_on_identity_mismatch` | Substrate-authenticated principal |
| 13 | `RequestBoundary` (limen_types) | v1.3 §3.1 | Primitive Type | `test_mint_transaction_context` | Request entry-point identifier |
| 14 | `TraceIdentity` (limen_types) | v1.3 §3.1 | Primitive Type | `test_mint_transaction_context` | Observability correlation identifier |
| 15 | `OperationType` (limen_types) | v1.3 §1.1 | Enum Type | `test_refusal_implements_trait`, `test_authority_implements_trait`, `test_governance_implements_trait`, `test_cascade_implements_trait` | 4-variant: Refusal, Authority, Governance, Cascade |
| 16 | `ExecutionContext` (limen_types) | v1.3 §3.2 | Enum Type | `test_dispatch_per_operation_field_independence` | 5-variant deployment profile discriminant |
| 17 | `FreshnessMarker` (limen_types) | v1.3 §2.1 | Struct Type | `test_f_transaction_bound_reads` | Substrate-attested read freshness |
| 18 | `ChainReadContext` trait (capabilities) | v1.3 §2.1 | Trait Interface | `test_mint_capability_produces_valid_cap` | 6-method opaque chain-read interface |
| 19 | `FoundationReadCapability` (capabilities) | v1.3 §2.1 | Capability Type | `test_mint_capability_produces_valid_cap`, compile_fail `construct_foundation_capability` | Unforgeable, lifetime-bound, no public constructor |
| 20 | `ProjectionReadCapability` (capabilities) | v1.3 §2.1, §2.3 | Capability Type | compile_fail `convert_projection_to_foundation` | No conversion to/from FoundationReadCapability |
| 21 | `NonAuthoritative<T>` (capabilities) | v1.3 §2.3 | Wrapper Type | — | Non-authoritative marker, no into_inner |
| 22 | `ChainEntry` enum (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked`, `test_e_tamper_detection` | Committed or Refusal variant |
| 23 | `CommittedEntry` (chain) | v1.3 §6.1 | Domain Type | `test_b_concurrent_commit_stress` | Hash-chained committed transition record |
| 24 | `RefusalEntry` (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked` | Hash-chained refusal record with evidence |
| 25 | `CommittedTransition` (chain) | v1.3 §6.1 | Domain Type | `test_dispatch_returns_actual_verdict_set` | Proposed + verdicts + commit path + timestamp |
| 26 | `GoverningEvidence` (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked` | Chain/governance/authority/cascade state snapshot |
| 27 | `ChainStateSnapshot` (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked` | Sequence + head hash at evaluation time |
| 28 | `AuthorityStateSnapshot` (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked` | Actor + authority state at refusal time |
| 29 | `GovernanceState` (chain) | v1.3 §6.1 | Domain Type | `test_governance_permits_when_no_policies` (ops) | Per-policy governance state |
| 30 | `AuthorityState` (chain) | v1.3 §6.1 | Domain Type | `test_authority_accepts_matching_identity` (ops) | Per-actor authority state |
| 31 | `CascadeLink` (chain) | v1.3 §6.1, Property 8 | Domain Type | `test_cascade_intact_when_no_links` (ops) | Source → target hash relationship |
| 32 | `CascadeCheckResult` (chain) | v1.3 §6.1 | Domain Type | `test_d_refusal_durable_and_chain_linked` | Intact or Broken with missing link |
| 33 | `TenantChainState` (chain) | v1.3 §6.1 | Domain Type | `test_g_multi_tenant` | Per-tenant next_sequence + last_hash |
| 34 | `ChainReadError` (chain) | v1.3 §2.1 | Error Type | `test_refusal_on_chain_unreadable` (ops) | NotFound, StorageError, IntegrityViolation |
| 35 | `ProjectionReadError` (chain) | v1.3 §2.3 | Error Type | — | Unavailable, StorageError |
| 36 | `TransactionRuntimeContext` (envelope) | v1.3 §3.1 | Context Type | `test_mint_transaction_context`, compile_fail `construct_transaction_context` | No public constructor, pub(crate) mint |
| 37 | `SubstrateRuntimeEnvelope` (envelope) | v1.3 §3.1, §3.3 | Context Type | `test_mint_envelope_fresh_per_operation`, compile_fail `construct_runtime_envelope` | Per-operation envelope, no public constructor |
| 38 | `OperationScopedFields` (envelope) | v1.3 §3.2 | Struct Type | `test_dispatch_per_operation_field_independence`, `test_fields_no_carryover` | Fresh per foundation operation |
| 39 | `CommitEnvelope` (envelope) | v1.3 §6.1 | Struct Type | `test_d_refusal_durable_and_chain_linked` | Serializable substrate metadata at commit time |
| 40 | `ProposedTransitionEnvelope` (proposed) | v1.3 §4.1 | Domain Type | `test_all_pass_produces_commit` (dispatch) | Third input class, no public seal access |
| 41 | `ProposedTransition` (proposed) | v1.3 §4.1 | Domain Type | `test_refusal_rejects_empty_payload` (ops) | Payload + transition_type |
| 42 | `ExternalWitness` (proposed) | v1.3 §4.1 | Domain Type | `test_witness_does_not_replace_chain_reads` (ops) | Source + content + timestamps |
| 43 | `ExternalWitnessSource` (proposed) | v1.3 §4.1 | Enum Type | `test_witness_does_not_replace_chain_reads` (ops) | Human, Llm, ThirdParty variants |
| 44 | `WitnessContent` (proposed) | v1.3 §4.1 | Domain Type | `test_witness_does_not_replace_chain_reads` (ops) | Byte-array witness content |
| 45 | `RefusalVerdict` (verdict) | v1.3 §1.2, Property 3 | Verdict Type | `test_refusal_accepts_valid_input`, `test_refusal_rejects_empty_payload` | Accept or Refuse(RefusalReason) |
| 46 | `RefusalReason` (verdict) | v1.3 §1.2 | Struct Type | `test_refusal_short_circuits_on_empty_payload` (dispatch) | Category + detail string |
| 47 | `RefusalCategory` (verdict) | v1.3 §1.2 | Enum Type | `test_refusal_short_circuits_on_empty_payload` | 6-variant: Evidence, Authority, Governance, Freshness, Typing, OperationalIntegrity |
| 48 | `AuthorityVerdict` (verdict) | v1.3 §1.2, Property 5 | Verdict Type | `test_authority_accepts_matching_identity`, `test_authority_rejects_identity_mismatch` | Authorized, Unauthorized, RouteVia |
| 49 | `AuthorizationFailure` (verdict) | v1.3 §1.2 | Struct Type | `test_authority_rejects_identity_mismatch` (ops) | Reason string |
| 50 | `CommitPath` (verdict) | v1.3 §1.2, Property 2 | Enum Type | `test_all_pass_produces_commit` (dispatch) | Default or Named(String) |
| 51 | `GovernanceVerdict` (verdict) | v1.3 §1.2, Property 6 | Verdict Type | `test_governance_permits_when_no_policies` | Permitted or Blocked(PolicyId, reason) |
| 52 | `GovernanceBlockReason` (verdict) | v1.3 §1.2 | Struct Type | — | Governance block reason string |
| 53 | `CascadeVerdict` (verdict) | v1.3 §1.2, Property 8 | Verdict Type | `test_cascade_intact_when_no_links` | Intact or Broken(CascadeBreak) |
| 54 | `CascadeBreak` (verdict) | v1.3 §1.2 | Struct Type | — | Missing link string |
| 55 | `VerdictSet` (verdict) | v1.3 §1.3 | Struct Type | `test_dispatch_returns_actual_verdict_set` | Combined refusal+authority+governance+cascade |
| 56 | `CommitDecision` (verdict) | v1.3 §1.3 | Enum Type | `test_all_pass_produces_commit`, `test_refusal_short_circuits_on_empty_payload` | Commit{path} or Refused(reason) |
| 57 | `FoundationOperation` trait (operation) | v1.3 §1.1 | Trait Interface | `test_refusal_implements_trait`, `test_authority_implements_trait`, `test_governance_implements_trait`, `test_cascade_implements_trait`, compile_fail `foundation_op_fourth_param` | Three-input-class signature, no fourth parameter |
| 58 | `RefusalEvaluation` (operations/refusal) | v1.3 §1.2, Property 3 | Operation Impl | `test_refusal_accepts_valid_input`, `test_refusal_rejects_empty_payload`, `test_refusal_on_chain_unreadable` | Structural: empty payload → Evidence refusal; chain unreadable → OperationalIntegrity |
| 59 | `AuthorityAndCommitEvaluation` (operations/authority) | v1.3 §1.2, Property 5+2 | Operation Impl | `test_authority_accepts_matching_identity`, `test_authority_rejects_identity_mismatch` | Identity match: authenticated actor vs claimed proposer |
| 60 | `GovernanceEvaluation` (operations/governance) | v1.3 §1.2, Property 6 | Operation Impl | `test_governance_permits_when_no_policies` | Structural shell: Permitted when no chain governance state |
| 61 | `CascadeIntegrityEvaluation` (operations/cascade) | v1.3 §1.2, Property 8 | Operation Impl | `test_cascade_intact_when_no_links` | Structural shell: Intact when no chain cascade links |
| 62 | `execute_dispatch_loop` (dispatch) | v1.3 §1.3 | Core Function | `test_dispatch_per_operation_field_independence`, `test_dispatch_returns_actual_verdict_set` | Fixed order: Refusal→Authority→Governance→Cascade; returns DispatchOutcome with actual VerdictSet |
| 63 | `run_commit_transaction` (dispatch) | v1.3 §1.3 | Public Entry Point | `test_all_pass_produces_commit`, `test_refusal_short_circuits_on_empty_payload`, `test_authority_short_circuits_on_identity_mismatch`, `test_determinism`, `test_entry_point_returns_commit_decision_only` | Legacy entry point; data-only inputs, CommitDecision output |
| 64 | `run_commit_transaction_gated` (dispatch) | v1.3 §1.3 + P0 Amendment | Public Entry Point | `test_dispatch_returns_actual_verdict_set` (internal) | Lifecycle-gated, audit-before-success fused entry point |
| 65 | `ChainCommitSink` trait (dispatch) | P0 Amendment: Audit-Before-Success | Trait Interface | `test_b_concurrent_commit_stress` (chain, via impl) | Durable chain entry persistence, F-03 actual verdicts |
| 66 | `CommitTransactionError` (dispatch) | P0 Amendment | Error Type | `test_require_ready_when_not_ready` (lifecycle, via LifecycleError) | LifecycleNotReady or ChainCommitFailed |
| 67 | `LifecycleState` (lifecycle) | P0 Amendment: Lifecycle State Machine | Enum Type | `test_initial_state_is_uninitialized`, `test_valid_startup_sequence` | 5-state: Uninitialized, Initializing, Ready, Degraded, Shutdown |
| 68 | `LifecycleError` (lifecycle) | P0 Amendment | Error Type | `test_invalid_transition_uninitialized_to_ready`, `test_require_ready_when_not_ready`, `test_display_formatting` | InvalidTransition, NotReady, LockPoisoned |
| 69 | `LifecycleGuard` (lifecycle) | P0 Amendment | Guard Type | `test_valid_startup_sequence`, `test_ready_to_degraded_and_back`, `test_ready_to_shutdown`, `test_degraded_to_shutdown`, `test_thread_safety` | Thread-safe RwLock-backed state machine |
| 70 | `LifecycleGuard::new` (lifecycle) | P0 Amendment | Constructor | `test_initial_state_is_uninitialized` | Starts in Uninitialized |
| 71 | `LifecycleGuard::current` (lifecycle) | P0 Amendment | Method | `test_initial_state_is_uninitialized`, `test_valid_startup_sequence` | RwLock read of current state |
| 72 | `LifecycleGuard::transition` (lifecycle) | P0 Amendment | Method | `test_valid_startup_sequence`, `test_invalid_transition_uninitialized_to_ready`, `test_invalid_transition_shutdown_to_ready`, `test_invalid_transition_initializing_to_shutdown`, `test_self_transition_is_invalid` | Validates transition then writes |
| 73 | `LifecycleGuard::require_ready` (lifecycle) | P0 Amendment | Method | `test_require_ready_when_ready`, `test_require_ready_when_not_ready`, `test_require_ready_when_degraded`, `test_require_ready_when_shutdown`, `test_thread_safety` | Returns Ok iff Ready |
| 74 | `substrate_authority::mint_capability` (substrate_authority) | M2.1 Option F | Mint Function | `test_mint_capability_produces_valid_cap` | pub(crate) FoundationReadCapability constructor |
| 75 | `substrate_authority::mint_transaction_context` (substrate_authority) | M2.1 Option F | Mint Function | `test_mint_transaction_context` | pub(crate) TransactionRuntimeContext constructor |
| 76 | `substrate_authority::mint_envelope` (substrate_authority) | M2.1 Option F | Mint Function | `test_mint_envelope_fresh_per_operation` | pub(crate) SubstrateRuntimeEnvelope constructor |
| 77 | `substrate_authority::dispatch_operation` (substrate_authority) | M2.1 Option F | Dispatch Function | `test_dispatch_dummy_operation_end_to_end` | Generic foundation operation dispatch via trait |
| 78 | `SqliteChainStorage` (limen_chain/storage) | v1.3 §6.3 | Storage Type | `test_b_concurrent_commit_stress`, `test_c_toctou_impossible` | Mutex-wrapped SQLite connection |
| 79 | `SqliteChainStorage::open` (limen_chain/storage) | v1.3 §6.3 | Constructor | `test_c_toctou_impossible`, `test_f_transaction_bound_reads` | WAL mode + sync mode + schema apply |
| 80 | `SqliteChainStorage::open_in_memory` (limen_chain/storage) | v1.3 §6.3 | Constructor | `test_a_schema_semantic_introspection`, `test_b_concurrent_commit_stress` | In-memory for testing |
| 81 | `SqliteChainStorage::lock_conn` (limen_chain/storage) | v1.3 §6.3 | Method | `test_a_schema_semantic_introspection`, `test_g_multi_tenant` | Direct connection access for inspection |
| 82 | `SyncMode` enum (limen_chain/storage) | v1.3 §6.3 | Enum Type | `test_a_schema_semantic_introspection` | Normal (Profile 1) or Full (Profile 2) |
| 83 | `ChainStorageError` (limen_chain/storage) | v1.3 §6.3 | Error Type | `test_c_toctou_impossible` | Sqlite, IntegrityViolation, LockPoisoned |
| 84 | `commit_entry` (limen_chain/commit) | v1.3 §6.4 Steps 1-8 | Core Function | `test_b_concurrent_commit_stress`, `test_d_refusal_durable_and_chain_linked`, `test_g_multi_tenant` | IMMEDIATE transaction, sequence allocation, hash chaining, VerdictSet threading (F-03) |
| 85 | `ChainCommitSink` impl for `SqliteChainStorage` (limen_chain/commit) | P0 Amendment | Trait Impl | `test_b_concurrent_commit_stress` (via commit_entry) | Delegates to commit_entry with error mapping |
| 86 | `SqliteTransactionReadContext` (limen_chain/read_context) | v1.3 §2.1 | ChainReadContext Impl | `test_f_transaction_bound_reads` | IMMEDIATE-transaction-bound reads, TOCTOU-free |
| 87 | `verify_chain` (limen_chain/verify) | v1.3 §14.1 | Verification Function | `test_e_tamper_detection`, `test_d_refusal_durable_and_chain_linked`, `test_g_multi_tenant` | Content hash recomputation + previous_hash linkage |
| 88 | `ChainVerifyReport` (limen_chain/verify) | v1.3 §14.1 | Result Type | `test_e_tamper_detection` | verified_count, integrity_ok, first_break |
| 89 | `ChainBreak` (limen_chain/verify) | v1.3 §14.1 | Result Type | `test_e_tamper_detection` | Sequence + expected/actual hash |
| 90 | `CHAIN_SCHEMA_DDL` (limen_chain/schema) | v1.3 §6.3 | Schema Constant | `test_a_schema_ddl_source_matches` | Canonical byte-for-byte DDL |
| 91 | `apply_schema` (limen_chain/schema) | v1.3 §6.3 | Schema Function | `test_a_schema_semantic_introspection` | Creates tables + initializes global_chain_state |
| 92 | `to_canonical_bytes` (limen_chain/canonical_temp) | v1.3 §6.4 | Serialization | `test_e_tamper_detection` (via hash verification) | Delegates to limen_canonical::CanonicalSerialize |
| 93 | `CanonicalSerialize` trait (limen_canonical) | v1.3 §6.4 | Trait Interface | `test_determinism_repeated`, `test_no_compact_prefix_in_struct` | Fixed-width MessagePack serialization |
| 94 | `CanonicalMsgPackSerializer` (limen_canonical) | v1.3 §6.4 | Serializer | `test_u8_fixed_width` through `test_u64_fixed_width`, `test_i8_fixed_width` through `test_i64_fixed_width`, `test_string_uses_str32`, `test_bytes_use_bin32`, `test_array_uses_array32`, `test_map_uses_map32`, `test_map_sorted_keys` | Deterministic: fixed-width integers, str32, bin32, array32, map32, sorted keys |
| 95 | `CanonicalJsonSerializer` (limen_canonical) | v1.3 §6.4 | Serializer | `test_canonical_json_determinism`, `test_canonical_json_no_whitespace` | Deterministic JSON: sorted keys, no whitespace |
| 96 | Compile-fail: `construct_foundation_capability` | v1.3 §2.1 | Negative Test | compile_fail_tests (limen_foundation_contract) | Cannot construct FoundationReadCapability from outside crate |
| 97 | Compile-fail: `construct_runtime_envelope` | v1.3 §3.1 | Negative Test | compile_fail_tests (limen_foundation_contract) | Cannot construct SubstrateRuntimeEnvelope from outside crate |
| 98 | Compile-fail: `construct_transaction_context` | v1.3 §3.1 | Negative Test | compile_fail_tests (limen_foundation_contract) | Cannot construct TransactionRuntimeContext from outside crate |
| 99 | Compile-fail: `convert_projection_to_foundation` | v1.3 §2.3 | Negative Test | compile_fail_tests (limen_foundation_contract) | No conversion between capability types |
| 100 | Compile-fail: `foundation_op_fourth_param` | v1.3 §1.1 | Negative Test | compile_fail_tests (limen_foundation_contract) | FoundationOperation trait signature rejects fourth parameter |
| 101 | Compile-fail: `hashmap_in_canonical` | v1.3 §6.4 | Negative Test | compile_fail_tests (limen_canonical) | HashMap rejected in canonical serialization |
| 102 | `limen_foundation_ops` re-export shell | M5.1 Amendment | Module Structure | `test_refusal_implements_trait` through `test_cascade_implements_trait` (ops_tests) | Backward-compatible re-exports from limen_foundation_contract::operations |

---

## Summary

- **Total rows:** 102
- **Public types covered:** 56 (limen_types: 17, foundation_contract/chain: 14, foundation_contract/verdict: 12, foundation_contract/envelope: 4, foundation_contract/proposed: 4, foundation_contract/capabilities: 3, foundation_contract/lifecycle: 3, foundation_contract/dispatch: 2)
- **Public functions covered:** 17 (dispatch: 3, substrate_authority: 4, chain: 6, schema: 2, lifecycle: 4)
- **Trait interfaces:** 4 (ChainReadContext, FoundationOperation, ChainCommitSink, CanonicalSerialize)
- **Trait implementations:** 2 (SqliteTransactionReadContext, ChainCommitSink for SqliteChainStorage)
- **Operation implementations:** 4 (Refusal, Authority, Governance, Cascade)
- **Compile-fail tests:** 6 (capability construction, envelope construction, context construction, capability conversion, fourth parameter, hashmap)
- **Contract clauses referenced:** v1.3 §0.2, §0.3, §0.4, §0.7, §1.1, §1.2, §1.3, §2.1, §2.3, §3.1, §3.2, §3.3, §4.1, §5.1, §6.1, §6.3, §6.4, §14.1, M2.1 Option F, M5.1 Amendment, P0 Amendment

---

## P0 Remediation Coverage

| Finding | Implementation | Tests |
|---------|---------------|-------|
| P0-1: Lifecycle State Machine | `lifecycle.rs`: LifecycleState, LifecycleError, LifecycleGuard | 12 tests: state transitions, invalid transitions, require_ready, thread safety |
| P0-2: Audit-Before-Success Fusion | `dispatch.rs`: ChainCommitSink trait, run_commit_transaction_gated; `commit.rs`: ChainCommitSink impl | Chain commit inside dispatch, no Commit without durable entry |
| F-03: Fabricated Verdicts | `dispatch.rs`: DispatchOutcome with actual VerdictSet; `commit.rs`: VerdictSet parameter | `test_dispatch_returns_actual_verdict_set` verifies real verdicts flow through |
