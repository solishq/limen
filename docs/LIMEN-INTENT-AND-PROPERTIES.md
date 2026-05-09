<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Limen v5 — Intent and Properties

**Phase:** 0 (Intent & Property Derivation)
**SolisForge:** v1.4 §6
**Date:** 2026-05-09
**Status:** DRAFT — Remediated per Breaker findings F-001 through F-014

---

## 1. Intent Record

### 1.1 Purpose Statement

Limen exists to give AI agents an epistemic substrate — a governed layer where beliefs are stored with confidence scores and temporal decay, where contradictions are structurally detected rather than silently overwritten, and where every mutation is auditable. It solves the problem that AI agents currently treat memory as raw storage (key-value pairs, chat logs, vector embeddings) with no mechanism for expressing uncertainty, enforcing governance policy, or degrading stale knowledge. Limen makes agent memory a first-class cognitive system: beliefs weaken without reinforcement, governance rules enforce ceilings and access controls before data reaches storage, and self-healing cascades retract derived conclusions when their foundations collapse.

### 1.2 Success Definition

Limen v5 is complete when all of the following are simultaneously true:

| Criterion | Measurement | Source |
|-----------|-------------|--------|
| All 14 ratified contracts are implemented | Every public method traces to a contract clause; Traceability Scanner exit code 0 | Integration Contract §6.1 |
| Pluggable agent adapters function without kernel modification | A new framework adapter can be added by implementing `AgentAdapter` alone; no changes to `src/kernel/`, `src/governance/`, or `src/security/` | AGENT_ADAPTER_ARCHITECTURE §1 |
| Performance budgets are met under load | Governance check < 10ms, audit append < 50ms, provenance hash batched < 100ms per batch of 100 | SHARED_TYPES §20 |
| Full test suite passes with zero failures | 4258+ tests, 0 fail, TSC clean, npm audit 0 vulnerabilities | Integration Contract §3 |
| Governance headers on every file | Traceability Scanner validates 100% file coverage | Integration Contract §5.1, §5.2 |
| Defense set is monotonically non-decreasing | 10 defense mechanisms verified present; no mechanism removed without compensating control | Integration Contract §9, HB-37 |

### 1.3 Scope Boundary

**In scope:**

- Belief storage with confidence, temporal decay (FSRS power-decay), and freshness labeling (SHARED_TYPES §2: `FreshnessLabel`)
- Structural conflict detection and cascade retraction (SHARED_TYPES §2: `RelationshipType`)
- Governance engine: classification filtering, refusal rules, consent enforcement, PII detection (SHARED_TYPES §3, §10, §13, §19)
- Agent adapter architecture: pluggable translation layer for any agent framework (AGENT_ADAPTER_ARCHITECTURE §1)
- 5-level trust model with clearance-gated capabilities (SHARED_TYPES §5, §6)
- Audit trail: hash-chained, append-only, per-operation (SHARED_TYPES §10.3)
- GDPR Article 17 erasure with certificate generation (SHARED_TYPES §19)
- Retention and rate limiting policies (SHARED_TYPES §17, §18)
- Computer action governance: 17 action variants with sandbox, refusal, and escalation (SHARED_TYPES §11, §12, §13)
- Multi-branch merge with deterministic ordering (SHARED_TYPES §23)
- MCP server and CLI surface (full parity with programmatic API)
- Technique Graduation Protocol types (SHARED_TYPES §22)

**Out of scope:**

- LLM inference execution — Limen governs agent actions and stores beliefs; it does not run models
- Embedding generation — requires external provider; Limen consumes embeddings, does not produce them
- Distributed consensus / multi-node replication — SQLite WAL is the foundation; single-node is the deployment model
- Agent orchestration / task scheduling — Limen provides the memory and governance substrate, not the execution engine
- User interface — Limen is a library and CLI; no GUI, no dashboard (audit visualization schema is a data contract, not a UI)

### 1.4 Constraints Inherited from Prior Phases

| Constraint | Origin | Effect |
|------------|--------|--------|
| SolisForge v1.4 is sole governing doctrine | Integration Contract §2 | No dual standards; all prior governance (PES v2.2, CDM v2.1) superseded |
| No grandfather clauses | Integration Contract §2 | Existing artifacts retroactively governed; no exemptions |
| Frozen zones: `contracts/`, `src/kernel/crypto/` | CLAUDE.md | Amendment-only modification; security review required for crypto |
| Baseline freeze at commit `f4ead70` | Integration Contract §3 | All convergence measured against this commit |
| 1 production dependency (`better-sqlite3`) | README architecture | No new runtime dependencies without escalation |
| Node.js >= 22, ESM-only | package.json | Runtime floor; no CommonJS support |
| Contract-first gate | Integration Contract §9, defense #1 | No implementation without ratified contract |
| Monotonicity (HB-37) | Integration Contract §9, defense #9 | Defense set never shrinks |
| Interface/hash binding (HB-38) | Integration Contract §9, defense #10 | Contract hashes verified on CI |

---

## 2. Property Derivation

### 2.1 Enumerated Invariants

Each invariant is derived from a contract requirement. The format is: `INV-NNN: statement [source]`.

**Belief System Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-001 | Every claim has a confidence score in [0.0, 1.0] that is stored at assertion time and never retroactively modified in the database | SHARED_TYPES §10.2 (`AgentMemoryEntry.confidence`) |
| INV-002 | `effectiveConfidence` is computed on every read using FSRS-based temporal decay; it is never stored. The specific decay formula derives from the FSRS algorithm, not from the contract text. | SHARED_TYPES §2 (`FreshnessLabel`), AGENT_MEMORY_BRIDGE §3.6 (`DecayInfo`) |
| INV-003 | Auto-extracted claims are capped at `maxAutoConfidence` (default 0.7); only `evidence_path` grounded claims may exceed the ceiling | SHARED_TYPES §2 (`GroundingMode`), AGENT_MEMORY_BRIDGE §3.2 (`AgentMemoryOptions`) |
| INV-004 | A retracted claim (`ClaimStatus = 'retracted'`) is never deleted from storage; it remains as an auditable tombstone | SHARED_TYPES §2 (`ClaimStatus`), AUDIT_VISUALIZATION_SCHEMA §2.6 (`MemoryDeleteDetail`) |
| INV-005 | When two claims on the same subject+predicate carry contradictory values, a `contradicts` relationship is automatically created | SHARED_TYPES §2 (`RelationshipType`), AGENT_MEMORY_BRIDGE §2.5 (`relateBelief`) |

**Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-006 | Every governance check completes in < 10ms (rule evaluation + verdict production only) | SHARED_TYPES §20 (`PerformanceBudget.governanceCheck`) |
| INV-007 | No operation returns success without a durable audit record appended first | SHARED_TYPES §20 (`auditAppend.guarantees: 'no_success_without_audit'`) |
| INV-008 | Audit append completes in < 50ms | SHARED_TYPES §20 (`PerformanceBudget.auditAppend`) |
| INV-009 | Governance verdict is one of exactly four values: `allow`, `refuse`, `escalate`, `sandbox` | SHARED_TYPES §10 (`GovernanceVerdict`) |
| INV-010 | Claims are classified at assertion time into exactly one of five levels: `unrestricted`, `internal`, `confidential`, `restricted`, `critical` | SHARED_TYPES §3 |
| INV-011 | Query and search results are filtered by the requesting agent's clearance level; an agent never receives claims above its clearance | SHARED_TYPES §5 (Trust and Clearance Model) |
| INV-012 | When `security.consent.required` is true, claim assertion about an entity is blocked without active consent | SHARED_TYPES §19 (`ConsentRequirement`) |
| INV-013 | Retention policies enforce per-classification lifetimes: unrestricted=90d, internal=1y, confidential=3y, restricted=5y, critical=7y | SHARED_TYPES §17 (`DEFAULT_RETENTION`) |
| INV-014 | GDPR erasure overrides retention policy when `gdprOverride` is true on the retention rule | SHARED_TYPES §17 (`RetentionPolicy.gdprOverride`) |

**Trust Model Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-015 | Trust progression has exactly 5 levels: untrusted (0), low (1), medium (2), high (3), verified (4) | SHARED_TYPES §5 |
| INV-016 | Capabilities are gated by trust level; an agent cannot exercise a capability above its trust tier's unlock set | SHARED_TYPES §6 (20-value `AgentCapability` enum, trust-gated) |
| INV-017 | `clearanceLevel` on an `OperationContext` equals `TRUST_TO_CLEARANCE[trustLevel]`; this mapping is deterministic and not overridable | SHARED_TYPES §7 validation rules |

**Adapter Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-018 | Adding a new agent framework requires implementing exactly one interface (`AgentAdapter`); no kernel, governance, or security code changes | AGENT_ADAPTER_ARCHITECTURE §1 |
| INV-019 | The adapter is a pure translation layer: it converts native agent formats to canonical `SHARED_TYPES` formats and does not contain governance logic | AGENT_ADAPTER_ARCHITECTURE §1 |
| INV-020 | Agent framework enum has exactly 10 values | SHARED_TYPES §21 (`AgentFramework`) |

**Rate Limiting Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-021 | Per-agent rate limit: 1000 all_operations / 60s, hard refuse | SHARED_TYPES §18 (`DEFAULT_RATE_LIMITS[0]`) |
| INV-022 | Per-agent computer actions: 100 / 60s, hard refuse | SHARED_TYPES §18 (`DEFAULT_RATE_LIMITS[1]`) |
| INV-023 | Rate limit precedence: most specific scope wins (per_agent > per_session > per_adapter > global) | SHARED_TYPES §18 precedence rule |

**Structural Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-024 | Every file in the repository contains an explicit SolisForge v1.4 governance declaration header | Integration Contract §5.1 |
| INV-025 | The `Result<T>` type is the sole return type for fallible operations; exceptions are not used for control flow | SHARED_TYPES §1.5 |
| INV-026 | All IDs are branded types; raw strings are not assignable to ID-typed positions | SHARED_TYPES §1.1a, §1.1b, §4 |
| INV-027 | Types defined in `SHARED_TYPES.md` are the sole definitions; no contract may redefine any shared type | SHARED_TYPES header rule |
| INV-028 | Multi-branch merge follows a deterministic 5-step algorithm; no merge produces non-deterministic output | SHARED_TYPES §23 |

**Event System Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-029 | Every governed operation SHALL emit an `AgentEventPayload` via the unified event bus (~110 event types). Events SHALL be ordered within a session | SHARED_TYPES §16 (`AgentEventBus`, `AgentEventPayload`) |
| INV-030 | All temporal logic SHALL use injected `TimeProvider`. Direct `Date.now()` / `performance.now()` is forbidden (Hard Stop 7) | Integration Contract §9, defense #7 (clock injection) |

**Trust Promotion Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-031 | Trust promotions SHALL be monotonic and single-step; an agent cannot skip trust levels (e.g., untrusted -> high is forbidden). Each promotion requires meeting the specific threshold for the next level | SHARED_TYPES §5.2, AGENT_LIFECYCLE_MANAGEMENT §2.10 (`promoteAgent`) |

**Audit Integrity Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-032 | Audit records SHALL form a hash chain where each entry's hash includes the previous entry's hash. The chain SHALL be tamper-evident and append-only | SHARED_TYPES §10.3 (`AuditLogEntry.previousHash`), COMPUTER_USE_GOVERNANCE §1.3 |

**PII and Erasure Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-033 | PII detection SHALL scan content before persistence. Personal data predicates (`personal.*`, `user.*`, `identity.*`) SHALL trigger consent checks | SHARED_TYPES §19 (`PiiDetectionConfig`, `ConsentRequirement`) |
| INV-034 | GDPR erasure SHALL produce a certificate with SHA-256 hash, scope, and chain verification result | COMPUTER_USE_GOVERNANCE §3 (provenance chain), SHARED_TYPES §19 (`ErasureCertificate`) |

**Lifecycle Management Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-035 | Agent registration SHALL create an identity BEFORE any adapter can be bound; an adapter SHALL NOT be bound to a non-existent agent identity | AGENT_LIFECYCLE_MANAGEMENT §1.06, §1.07 (LM-1.06, LM-1.07) |
| INV-036 | All state transitions SHALL produce audit entries; all capability changes SHALL require evidence | AGENT_LIFECYCLE_MANAGEMENT §1.03, §1.04 (LM-1.03, LM-1.04) |
| INV-037 | Decommissioning an agent SHALL cascade: revoke all capabilities, invalidate all sessions, and produce a decommission audit record | AGENT_LIFECYCLE_MANAGEMENT §2.05 (`decommissionAgent`), §1.02 (clean lifecycle boundaries) |

**Memory Bridge Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-038 | `LimenAgentClient` SHALL be session-bound; after `endSession()`, subsequent calls SHALL return `{ ok: false, error: { code: 'SESSION_ENDED' } }` | AGENT_MEMORY_BRIDGE §2.19, §2.26 (MB-2.19, MB-2.26) |
| INV-039 | Branch merge SHALL follow `MergeStrategy` rules; manual merge conflicts SHALL block until resolved via `resolveConflict()` | AGENT_MEMORY_BRIDGE §2.7, §2.13 (MB-2.7, MB-2.13) |
| INV-040 | Confidence on recalled beliefs SHALL reflect temporal decay via `DecayInfo`; the `currentConfidence` in view SHALL equal FSRS-computed effective confidence | AGENT_MEMORY_BRIDGE §3.6 (MB-3.11, MB-3.12, MB-3.13) |

**Execution Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-041 | Mission state transitions SHALL follow the defined state machine; `completed`, `failed`, and `cancelled` are terminal states with zero valid outgoing transitions | AGENT_EXECUTION_GOVERNANCE §3.5 (EG-3.32 through EG-3.41) |
| INV-042 | Budget reservations SHALL be consumed before work proceeds; consumption SHALL NOT exceed the reserved amount | AGENT_EXECUTION_GOVERNANCE §2.13, §2.14 (EG-2.13, EG-2.14) |
| INV-043 | Wave scheduling SHALL produce deterministic execution order within a mission | AGENT_EXECUTION_GOVERNANCE §2.17 (EG-2.17) |

**Context Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-044 | Context assembly SHALL enforce a hard token cap; claims exceeding the budget SHALL be excluded, not truncated | AGENT_CONTEXT_GOVERNANCE §2.2 (CG-2.2) |
| INV-045 | Eviction decisions SHALL produce audit trails and SHALL be deterministic given the same importance scores and budget | AGENT_CONTEXT_GOVERNANCE §1.3, §1.4 (CG-1.3, CG-1.4) |
| INV-046 | Working memory entries SHALL be session-scoped and ephemeral; `flushWorkingMemory` SHALL remove all entries in the namespace | AGENT_CONTEXT_GOVERNANCE §3.17 (CG-3.17) |

**Search Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-047 | Every search operation SHALL respect agent clearance level, produce an audit entry, and operate within tenant isolation boundaries | AGENT_SEARCH_GOVERNANCE §1.3, §1.4, §1.5 (SG-1.3, SG-1.4, SG-1.5) |
| INV-048 | Duplicate detection SHALL use configurable similarity threshold; duplicates SHALL be flagged before persistence, not after | AGENT_SEARCH_GOVERNANCE §3.4, §3.5 (SG-3.4, SG-3.5) |

**Output Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-049 | Every agent-produced artifact SHALL be a governed claim subject to CCP invariants, FSRS decay, and retention policy enforcement | AGENT_OUTPUT_GOVERNANCE §1.4 (OG-1.4) |
| INV-050 | Output retraction SHALL follow the same tombstone semantics as belief retraction: the entry persists with `retracted` status | AGENT_OUTPUT_GOVERNANCE §3.3 (`retractOutput`) |

**Computer Use Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-051 | All computer actions SHALL flow through a governance gate that evaluates risk, enforces policy, and records provenance in the immutable hash-chained audit trail | COMPUTER_USE_GOVERNANCE §1.3 (CU-1.3) |
| INV-052 | Action risk assessment SHALL produce a score (0-100) with weighted risk factors; `forbidden` risk level SHALL always result in `refuse` verdict | COMPUTER_USE_GOVERNANCE §3.1, §3.3 (CU-3.1, CU-3.4) |

**Coordination Governance Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-053 | All coordination operations SHALL be tenant-scoped and governance-checked; A2A actions between agents SHALL be validated via `validateA2AAction()` before execution | AGENT_COORDINATION_GOVERNANCE §1.3, §1.4, §3.4 (CO-1.3, CO-1.4, CO-3.4) |
| INV-054 | Session forks SHALL preserve the audit chain from the fork point; merged forks SHALL produce deterministic output per `MergeStrategy` | AGENT_COORDINATION_GOVERNANCE §3.6, §3.8 (CO-3.6, CO-3.8) |

**Intelligence Bridge Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-055 | The Intelligence Bridge SHALL be the sole sanctioned pathway for agent intelligence operations; direct manipulation of technique claims or cognitive state outside this interface is a governance violation | AGENT_INTELLIGENCE_BRIDGE §1.3, §1.4 (IB-1.3, IB-1.4) |
| INV-056 | Self-heal operations SHALL cascade: invalidated evidence SHALL trigger retraction of all derived conclusions via `invalidateEvidence()` producing an `InvalidationCascade` | AGENT_INTELLIGENCE_BRIDGE §3.14 (IB-3.14) |

**Audit Visualization Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-057 | All visualization data SHALL derive from the append-only hash-chained audit log as single source of truth; no visualization projection may introduce data not present in the audit log | AUDIT_VISUALIZATION_SCHEMA §1.3 (AV-1.3) |

**CrewAI Adapter Invariants**

| ID | Invariant | Contract Source |
|----|-----------|----------------|
| INV-058 | The CrewAI adapter SHALL NOT modify Limen Core; it is a pure translation layer. Limen Core SHALL reject CrewAI-originated operations missing registered adapter identity, session identity, governance decision, or audit-chain linkage | CREWAI_ADAPTER_CONTRACT §1.05, §1.06 (CA-1.05, CA-1.06) |
| INV-059 | CrewAI tool invocations SHALL be translated to `LimenOperation[]` via `translateToolCall`; `tool_name` is the ONLY authoritative tool identifier | CREWAI_ADAPTER_CONTRACT §1.11, §1.17 (CA-1.11, CA-1.17) |

### 2.2 Non-Goals

These are permanent architectural boundaries, not deferred work.

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG-001 | Limen will not execute LLM inference | Limen is an epistemic substrate, not an inference engine. It governs and stores the outputs of inference performed elsewhere. Conflating these concerns would violate the downward-only dependency rule (README: "The kernel knows nothing about AI"). |
| NG-002 | Limen will not generate embeddings | Embedding generation is delegated to an external provider via a function interface (`EmbeddingProvider`). Bundling a model would add hundreds of MB to the dependency footprint and couple Limen to a specific embedding architecture. |
| NG-003 | Limen will not provide distributed/multi-node deployment | SQLite WAL is the storage foundation. This is a deliberate constraint that keeps the dependency count at 1 and eliminates consensus protocol complexity. Scaling beyond single-node is out of scope. |
| NG-004 | Limen will not orchestrate agent task execution | Agent orchestration (task graphs, scheduling, multi-agent coordination) is the responsibility of the agent framework. Limen provides memory and governance services to those frameworks via adapters. |
| NG-005 | Limen will not provide a graphical user interface | Limen exposes a programmatic API, an MCP server, and a CLI. Any visual interface is a separate product that consumes Limen's API. |
| NG-006 | Limen will not guarantee real-time performance at arbitrary scale | Performance budgets (§20) define bounded latencies for governance and audit operations. These are validated at single-node scale with SQLite. No SLA is offered for unbounded concurrent load. |
| NG-007 | Limen will not perform ML-based cognitive analysis | Consolidation, narrative, and importance scoring use deterministic heuristic algorithms. They are approximate by design. Limen does not train or run ML models for these features. |
| NG-008 | No encryption at rest | SQLite WAL stores data unencrypted. Encryption at rest is a deployment concern, not a kernel concern. Limen's security model covers classification-gated access, consent enforcement, and audit integrity — not storage-layer encryption. |

### 2.3 Quality Targets

| ID | Metric | Target | Measurement Method | Contract Source |
|----|--------|--------|--------------------|----------------|
| QT-001 | Test suite pass rate | 100% (0 failures) | `npm test` exit code 0, 4258+ tests | Integration Contract §3 |
| QT-002 | TypeScript strict compilation | 0 errors | `npx tsc --noEmit` exit code 0 | Integration Contract §3 (TSC clean) |
| QT-003 | Dependency vulnerabilities | 0 | `npm audit` exit code 0 | Integration Contract §3 |
| QT-004 | Governance check latency | < 10ms | Benchmark harness against `PerformanceBudget` | SHARED_TYPES §20 |
| QT-005 | Audit append latency | < 50ms | Benchmark harness against `PerformanceBudget` | SHARED_TYPES §20 |
| QT-006 | Provenance hash throughput | batched < 100ms per batch of 100 | Benchmark harness against `PerformanceBudget` | SHARED_TYPES §20 |
| QT-007 | File governance coverage | 100% | Traceability Scanner exit code 0 | Integration Contract §6.1 |
| QT-008 | Defense set size | >= 10 mechanisms | Defense set audit against Integration Contract §9 | Integration Contract §9 |
| QT-009 | Production dependencies | <= 1 | `package.json` dependencies count | README architecture |
| QT-010 | Mutation test score | >= 80% killed | `npx stryker run` report | CLAUDE.md verification stack |
| QT-011 | Branded type coverage | 100% of ID fields use branded types | Static analysis / code review | SHARED_TYPES §1.1a, §1.1b, §4 |
| QT-012 | Contract traceability | Every public method links to a contract clause | Traceability Scanner + manual review | Integration Contract §9, defense #2 |

---

## 3. Derivation Record

### 3.1 Reasoning Chain

1. **Purpose** was derived by asking: what problem does Limen solve that raw storage does not? The contracts reveal three capabilities absent from conventional memory: (a) confidence with temporal decay (SHARED_TYPES §2, `FreshnessLabel`), (b) governance enforcement before storage (SHARED_TYPES §10, §13, §19), (c) self-healing via cascade retraction (AGENT_INTELLIGENCE_BRIDGE §3.14, `invalidateEvidence` -> `InvalidationCascade`). These three capabilities define the purpose.

2. **Invariants** were derived by extracting every "MUST", default value, and structural constraint from the contracts. Each invariant is falsifiable: it can be tested by constructing a scenario that violates it and verifying the system rejects or prevents that scenario.

3. **Non-goals** were derived by examining what Limen explicitly does not claim to do (README "What is not" section) and what the adapter architecture deliberately excludes from the kernel (AGENT_ADAPTER_ARCHITECTURE §1: "no core code changes, no kernel recompilation, no governance model alterations").

4. **Quality targets** were derived from the numeric thresholds in SHARED_TYPES §20 (performance budgets), Integration Contract §3 (baseline metrics), and the verification stack in CLAUDE.md.

### 3.2 Rejections

| Considered | Rejected | Reason |
|------------|----------|--------|
| Including "ML-powered cognitive engine" as a goal | Rejected | README explicitly states heuristic algorithms, not ML models. Claiming ML capability would violate C3 identity integrity. |
| Setting governance latency target at < 5ms | Rejected | Contract specifies < 10ms (SHARED_TYPES §20). Tightening the budget without evidence would create an unfounded constraint. |
| Including PostgreSQL migration as in-scope | Rejected | `docs/MIGRATION_SQLITE_TO_POSTGRES.md` exists as a guide, but no contract mandates it. SQLite WAL is the architectural choice. Migration is an optional deployment concern, not a v5 deliverable. |
| Including distributed agent coordination | Rejected | Adapter architecture explicitly separates Limen (substrate) from agent frameworks (orchestration). Crossing this boundary would violate the downward-only dependency rule. |

---

## 4. Remediation Log

Findings remediated from Breaker review (2026-05-09):

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| F-001 | P1 | Added 31 invariants (INV-029 through INV-059) covering all 11 previously-uncovered contracts: Lifecycle Management, Memory Bridge, Execution Governance, Context Governance, Search Governance, Output Governance, Computer Use, Coordination Governance, Intelligence Bridge, Audit Visualization, CrewAI Adapter. Total invariants: 59 (up from 28). |
| F-002 | P1 | INV-015: Changed trust level names from "probationary/trusted/elevated" to "low/medium/high" per SHARED_TYPES §5. |
| F-003 | P2 | Added INV-029: Event system invariant requiring AgentEventPayload emission via unified event bus, with session-ordered events. |
| F-004 | P2 | Added INV-031: Trust promotion monotonicity and single-step invariant. |
| F-005 | P2 | Added INV-032: Audit hash-chain invariant requiring tamper-evident, append-only chain. |
| F-006 | P2 | Added INV-033: PII detection invariant requiring pre-persistence scanning and consent triggers on personal data predicates. |
| F-007 | P2 | Added INV-034: GDPR erasure certificate invariant with SHA-256 hash, scope, and chain verification. |
| F-008 | P2 | QT-004/005/006: Removed "p99" qualifier. Now reads "< 10ms", "< 50ms", "batched < 100ms per batch of 100" matching contract wording. |
| F-009 | P2 | INV-001: Changed source from "SHARED_TYPES §2 (ClaimStatus, GroundingMode)" to "SHARED_TYPES §10.2 (AgentMemoryEntry.confidence)". |
| F-010 | P3 | Added NG-008: No encryption at rest. SQLite WAL stores data unencrypted; encryption is a deployment concern. |
| F-011/012 | P3 | INV-002, INV-003, INV-004, INV-005: Replaced README citations with contract-traceable sources (SHARED_TYPES §2, AGENT_MEMORY_BRIDGE §3.6, §3.2, AUDIT_VISUALIZATION_SCHEMA §2.6). |
| F-013 | P3 | Added INV-030: Clock injection invariant requiring TimeProvider; forbids direct Date.now()/performance.now(). |
| F-014 | P3 | Removed "36 tools" specific count from scope (line "MCP server and CLI surface"). Tool count is implementation detail, not contract property. |

---

**Document Status:** DRAFT — Remediated, pending Breaker re-review
**Next:** Breaker re-review against SolisForge v1.4 §6 Phase 0 requirements
