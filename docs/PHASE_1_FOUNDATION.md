# Phase 1 Foundation

Status: Builder implementation complete pending independent Breaker/Certifier review.

Governing inputs:
- `MASTER-INDEX-v2.2-FINAL.md` §2.2
- `contracts/SHARED_TYPES.md` v1.4.1
- `contracts/AGENT_ADAPTER_ARCHITECTURE.md` v2.3.0
- `contracts/CREWAI_ADAPTER_CONTRACT.md` v1.0.0
- `contracts/AUDIT_VISUALIZATION_SCHEMA.md` v1.2.0

## Scope

The Phase 1 foundation is implemented additively under `release/v5`. It does not modify `v5/**`, Limen Core, or ratified contracts. TypeScript and Rust projections are isolated from the existing v4 root package so current stable surfaces remain untouched.

## Bidirectional Traceability Matrix

| # | Code artifact | Symbol / behavior | Contract clause | Proof |
|---:|---|---|---|---|
| 1 | `release/v5/src/types/index.ts` | `TenantId`, `UserId`, `AgentId`, `SessionId` branded IDs | `SHARED_TYPES.md` §1.1a | Branded string aliases preserve inherited Core IDs. |
| 2 | `release/v5/crates/limen_foundation/src/types/mod.rs` | Kernel ID newtypes | `SHARED_TYPES.md` §25 | Rust newtypes serialize as canonical strings. |
| 3 | `release/v5/src/types/index.ts` | Protocol branded IDs | `SHARED_TYPES.md` §1.1b | `ClaimId`, `RelationshipId`, EGP/TGP IDs included. |
| 4 | `release/v5/src/types/index.ts` | `Permission` 31-value union | `SHARED_TYPES.md` §1.2 | Closed union plus `PERMISSIONS` runtime list. |
| 5 | `release/v5/crates/limen_foundation/src/types/mod.rs` | `Permission` enum | `SHARED_TYPES.md` §1.2, §25 | `serde(rename_all = "snake_case")` matches TS literals. |
| 6 | `release/v5/src/types/index.ts` | `OperationContext` | `SHARED_TYPES.md` §1.3 | Explicit tenant/user/agent/session/clearance fields. |
| 7 | `release/v5/src/types/index.ts` | `Result<T, E>` | `SHARED_TYPES.md` §1.5 | Fallible TS operations return `Result`, not throws, except sync subscription contract cases. |
| 8 | `release/v5/src/types/index.ts` | CCP literal unions | `SHARED_TYPES.md` §2 | `ObjectType`, `ClaimStatus`, `GroundingMode`, etc. |
| 9 | `release/v5/src/types/index.ts` | `ClassificationLevel`, `CLASSIFICATION_NUMERIC` | `SHARED_TYPES.md` §3 | Numeric clearance mapping is explicit. |
| 10 | `release/v5/src/types/index.ts` | Phase X branded IDs | `SHARED_TYPES.md` §4 | `AdapterId`, `AgentBranchId`, `ConsentId`, etc. |
| 11 | `release/v5/src/types/index.ts` | Trust mappings | `SHARED_TYPES.md` §5 | `TRUST_TO_CLEARANCE`, `PHASE_X_TO_CORE_TRUST`. |
| 12 | `release/v5/src/types/index.ts` | `AgentCapability` 20-value union | `SHARED_TYPES.md` §6 | Closed union plus capability list. |
| 13 | `release/v5/src/types/index.ts` | `effectiveCapabilities` | `SHARED_TYPES.md` §5.1, §6.1 | Effective capabilities are requested intersection trust-unlocked. |
| 14 | `release/v5/src/types/index.ts` | `AgentSession` validation | `SHARED_TYPES.md` §7 | Clearance/core trust/capability invariants checked. |
| 15 | `release/v5/src/types/index.ts` | `sessionToContext` | `SHARED_TYPES.md` §8 | Agents are not users; permissions derive from capabilities. |
| 16 | `release/v5/src/types/index.ts` | `derivePermissions` | `SHARED_TYPES.md` §8.1 | Complete capability-to-permission table copied verbatim. |
| 17 | `release/v5/src/types/index.ts` | `GovernanceAction` | `SHARED_TYPES.md` §9 | 10 domains and operations included. |
| 18 | `release/v5/src/types/index.ts` | `GovernanceVerdict` | `SHARED_TYPES.md` §10 | allow/refuse/escalate/sandbox discriminated union. |
| 19 | `release/v5/crates/limen_foundation/src/types/mod.rs` | `GovernanceVerdict` serde enum | `SHARED_TYPES.md` §10, §25 | Tagged with `verdict`; camelCase fields match TS wire names. |
| 20 | `release/v5/src/governance/GovernanceEngine.ts` | Decision validation | `SHARED_TYPES.md` §10.1 | `allowed` must match allow verdict; refusals include cause. |
| 21 | `release/v5/src/client/LimenAgentClient.ts` | `remember` governance before persistence | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.4 | Governance gate executes before `CorePort.remember`. |
| 22 | `release/v5/src/client/LimenAgentClient.ts` | `recall` clearance filter | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.5 | Core recall filters by session clearance and requested classification. |
| 23 | `release/v5/src/client/LimenAgentClient.ts` | `createBranch` permissions | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.6 | Requires branching permissions and medium clearance. |
| 24 | `release/v5/src/client/LimenAgentClient.ts` | `mergeBranches` manual result | `SHARED_TYPES.md` §14.2, §23; Claim 1.7 | Manual multi-branch merge returns pending conflict. |
| 25 | `release/v5/src/client/LimenAgentClient.ts` | `resolveConflict` validation | `CREWAI_ADAPTER_CONTRACT.md` Claims 1.11, 2.9 | Unknown merge/conflict and incomplete new value are rejected. |
| 26 | `release/v5/src/types/index.ts` | `AuditLogEntry` | `SHARED_TYPES.md` §10.3 | Canonical append-only hash-chain record. |
| 27 | `release/v5/src/audit/AuditLogger.ts` | `append` fail-closed audit | `SHARED_TYPES.md` §10.3, §20 | Operation receives no success unless append succeeds. |
| 28 | `release/v5/src/audit/AuditLogger.ts` | `verifyChain` | `AUDIT_VISUALIZATION_SCHEMA.md` §8.1 | Chain integrity is queryable from audit entries. |
| 29 | `release/v5/src/types/index.ts` | `AgentEvent` closed union | `SHARED_TYPES.md` §16.1 | All 120 event literals and wildcard included. |
| 30 | `release/v5/crates/limen_foundation/src/types/mod.rs` | `AgentEvent` serde enum | `SHARED_TYPES.md` §16.1, §25 | Each event variant has exact `serde(rename = "...")`. |
| 31 | `release/v5/src/types/index.ts` | `AgentFramework` 10-value union | `SHARED_TYPES.md` §21 | Includes `crew_ai`, `auto_gen`, `semantic_kernel`, `llama_index`. |
| 32 | `release/v5/crates/limen_foundation/src/types/mod.rs` | `AgentFramework` enum | `SHARED_TYPES.md` §21, §25 | Rust test proves serialized wire literals. |
| 33 | `release/v5/src/adapter/AgentAdapter.ts` | `AgentAdapter` interface | `AGENT_ADAPTER_ARCHITECTURE.md` §3 | Identity, lifecycle, translation, session, event, health methods. |
| 34 | `release/v5/crates/limen_foundation/src/adapter/mod.rs` | `AgentAdapter` trait | `AGENT_ADAPTER_ARCHITECTURE.md` §9; Phase 1 action 4 | Rust trait includes canonical methods plus governed `execute`. |
| 35 | `release/v5/src/adapter/AgentAdapter.ts` | `LimenOperation` union | `AGENT_ADAPTER_ARCHITECTURE.md` §5.2 | Canonical adapter-produced operation surface. |
| 36 | `release/v5/src/lifecycle/AgentLifecycle.ts` | Five-state machine | Phase 1 prompt action 5 | Exact states and transition matrix exported. |
| 37 | `release/v5/crates/limen_foundation/src/lifecycle/mod.rs` | Rust lifecycle machine | Phase 1 prompt action 5 | Proptest verifies transition matrix. |
| 38 | `release/v5/src/client/LimenAgentClient.ts` | DEGRADED fail-closed operations | Phase 1 prompt actions 3, 6 | All core operations call `assertReadyForCoreOperation`. |
| 39 | `release/v5/src/client/LimenAgentClient.ts` | `healthCheck` live probe | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.12 | Health allowed outside core operation path. |
| 40 | `release/v5/src/client/LimenAgentClient.ts` | `getHealth` sync cached health | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.8 | No I/O, reports last-known state. |
| 41 | `release/v5/src/client/LimenAgentClient.ts` | `on` / `off` subscription behavior | `CREWAI_ADAPTER_CONTRACT.md` Claim 1.13 | Allowed before shutdown, rejected after shutdown, unknown off is no-op. |
| 42 | `release/v5/src/governance/GovernanceEngine.ts` | `validateGovernedFlag` | `CREWAI_ADAPTER_CONTRACT.md` Claim 2.1 | `governed:false` rejected for all callers. |
| 43 | `release/v5/tests/phase1_foundation.test.ts` | Mutation harness | Phase 1 prompt action 8 | Lifecycle mutants killed at 100 percent. |
| 44 | `release/v5/tests/phase1_foundation.test.ts` | Invariant property sweep | Phase 1 prompt action 8 | All 10 Phase X invariants asserted. |

## Dual-Projection Parity Proof

TypeScript closed literal unions are represented by Rust serde enums with matching wire names:

- `AgentFramework`: TS `AGENT_FRAMEWORKS` equals Rust `AGENT_FRAMEWORKS` serialized strings. Rust unit test `agent_framework_serializes_to_typescript_literals` proves all 10 values.
- `GovernanceVerdict`: TS discriminant is `verdict`; Rust uses `#[serde(tag = "verdict", rename_all = "snake_case")]` and variant field `#[serde(rename_all = "camelCase")]`. Rust unit test `governance_verdict_uses_typescript_discriminant` proves `escalate` and `requiredApproval`.
- `AgentEvent`: TS `AGENT_EVENTS` contains all event literals from `SHARED_TYPES.md` §16.1; Rust `AgentEvent` assigns exact `serde(rename = "...")` for each event and wildcard.
- `Permission`, `AgentCapability`, `AgentTrustLevel`, `ClassificationLevel`, `MergeStrategy`, and `ComputerActionType`: Rust uses `snake_case` or exact explicit serde renames matching the TS literal unions.

## Phase X Invariant Enforcement

| Invariant | Enforcement |
|---|---|
| Core Isolation | Implementation is additive under `release/v5`; tests assert root `v5` remains absent. |
| Client Mediation | Core operations reject before `createSession`; all core port calls are private behind `LimenAgentClient`. |
| Governance Non-Optionality | `GovernanceEngine` is mandatory; public operations call `govern` before core port mutation. |
| Unified Audit Chain | `AuditLogger.append` hash-chains every public method audit; audit failure rejects operation. |
| Adapter Purity | `AgentAdapter` only translates into `LimenOperation`/`ComputerAction`; client owns execution. |
| Classification Enforcement | Recall and write gates compare explicit clearance against classification. |
| Session Isolation | Session-derived `OperationContext` carries explicit agent/session IDs; test clients do not share memory. |
| CCP Conflict Authority | Manual merge cannot silently complete; `resolveConflict` is the only resolution path. |
| Additive Migration | No existing root `src/**` or contracts are modified by this implementation. |
| Performance Budget | Governance checks are local and budgeted; audit append is bounded and fail-closed. |

## Verification Commands

```bash
npx tsc -p release/v5/tsconfig.json
npx tsx --test release/v5/tests/*.test.ts
cd release/v5/crates/limen_foundation && cargo fmt -- --check
cd release/v5/crates/limen_foundation && cargo clippy -- -D warnings
cd release/v5/crates/limen_foundation && cargo test
```

## Verification Results

- TypeScript strict compile: passing.
- TypeScript unit/property/parity tests: 7/7 passing.
- TypeScript mutation harness: 7/7 lifecycle mutants killed, 100 percent kill rate.
- Rust unit/proptest/parity tests: 4/4 passing.
- Rust clippy with `-D warnings`: passing.
- Rust formatting: passing after `cargo fmt`.

