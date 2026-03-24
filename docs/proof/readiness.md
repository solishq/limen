# Readiness -- Evidence Summary

> This document synthesizes Limen's proof pack into a single trust surface.
> Every claim links to a proof document. Every non-proof boundary is explicit.
>
> Generated: 2026-03-24
> Limen version: 3.3.0

---

## What Is Proven

| Claim | Evidence Class | Proof Document | Detail |
|---|---|---|---|
| 16 system calls with full A21 coverage | Verified | [system-calls.md](./system-calls.md) | All 16: interface + implementation + scaffold/contract tests + success and rejection paths. SC-1 through SC-10 follow orchestration layer pattern; SC-11 through SC-16 use handler factory pattern (CCP, WMP subsystems). |
| 134 invariants across 3 tiers | Mixed | [invariants.md](./invariants.md) | 114 Verified, 1 Measured, 4 Implemented, 11 Declared, 4 Out of Scope. Tier 1 (28 core frozen): 27 Verified + 1 Measured. Tier 2 (33 extended): 30 Verified + 3 Declared. Tier 3 (73 subsystem): 57 Verified + 4 Implemented + 8 Declared + 4 Out of Scope. |
| 21 failure mode defenses (of 45 specified) | Mixed | [failure-modes.md](./failure-modes.md) | 12 Verified, 8 Implemented, 1 Declared. 24 FM IDs (FM-21, FM-23 through FM-34, FM-36 through FM-45) have zero code presence anywhere in the codebase. |
| 8 security mechanisms | Verified (top-level) | [security-model.md](./security-model.md) | AES-256-GCM vault encryption, append-only audit trail, tenant isolation, RBAC, budget enforcement, migration safety, clock injection, error redaction / input validation. All 8 are Verified at mechanism level. Sub-mechanism properties include ~15 Implemented-class items. |
| Atomic audit (I-03) | Verified | [invariants.md](./invariants.md) | Every state mutation and its audit entry committed in the same SQLite transaction. Tested at `tests/invariants/i05_transactional_consistency.test.ts:129`. |
| Agent isolation (I-07) | Verified | [invariants.md](./invariants.md) | One agent's crash, misbehavior, or compromise cannot corrupt another agent's state. Tested at `tests/learning/test_convergence_subsystems.test.ts:405`. |
| Single production dependency (I-01) | Verified | [invariants.md](./invariants.md) | Only `better-sqlite3`. CI-enforced at `.github/workflows/ci.yml:45`. |
| Tenant data leakage defense (FM-10) | Verified | [failure-modes.md](./failure-modes.md) | TenantScopedConnection auto-injects tenant predicates. 40+ cross-tenant rejection tests across all stores. Adversarial bypass tests. Structural verification of every table. |
| Delegation cycle detection (FM-19) | Verified | [failure-modes.md](./failure-modes.md) | Visited-set algorithm with DELEGATION_CYCLE error code and full cycle path. Both success and rejection paths tested at API, gap, and contract levels. |
| SHA-256 hash-chained audit trail (FM-08) | Verified | [failure-modes.md](./failure-modes.md), [security-model.md](./security-model.md) | Append-only via SQLite triggers. Hash chain integrity verified. Tamper detection tested. Genesis anchor from well-known constant. |

---

## What Is NOT Proven

This section is the most important part of this document. It declares what Limen does NOT prove, does NOT guarantee, and does NOT claim. If an evaluator reads only this section, they should understand every limitation.

### Operational Non-Proofs

- **No production uptime claims.** Zero production deployments measured. No availability SLA of any kind.
- **No public load test at any concurrency level.** No throughput, latency, or saturation benchmarks published. I-14 (predictable latency) is Measured via test harness, not under production conditions.
- **No regulatory compliance.** No SOC 2, HIPAA, ISO 27001, GDPR certification. GDPR tombstoning exists (audit trail cascade re-hash), but no compliance audit has been performed.
- **Concurrent same-session calls are a documented limitation, not a resolved problem.** SQLite WAL mode with busy timeout is the defense (FM-05), but the concurrency stress tests are decorative (`assert.ok(true)`). FM-05 is classified Implemented, not Verified.

### Architectural Non-Proofs

- **Demo configuration is NOT production configuration.** Auto-generated dev key when no `masterKey` is provided to `createLimen()`. Temporary directory storage. These defaults are development conveniences, not production hardening.
- **24 failure modes from specification have zero code presence.** FM-21, FM-23 through FM-34, FM-36 through FM-45 are not implemented. The specification document defining these FMs is not available in the repository; their names and descriptions cannot be verified. The gap between the specification's 45 failure modes and the codebase's 21 traceable defenses is an open obligation.
- **RBAC is dormant in single-user mode.** All operations permitted until the first custom role is created (`src/kernel/rbac/rbac_engine.ts:101`). This is spec-intentional (S3.7) but means the default deployment has zero permission enforcement.
- **Reference agent is proof-of-architecture, not a production agent.** The reference agent demonstrates system call usage and checkpoint handling. It is not a production-ready cognitive agent.
- **No formal verification.** All proofs are test-based, not mathematical. No theorem prover, model checker, or formal specification language is used.
- **Post-quantum cryptography is forward-declared, not implemented.** ML-KEM-512 hybrid is mentioned in the spec as a compliance opt-in. No implementation exists.
- **No key rotation mechanism.** The `core_encryption_keys` table has `rotated_at` column and `active` flag, but no rotation logic is implemented. Keys are derived once and cached.
- **No distributed or multi-node deployment support.** Limen is a single-process, single-SQLite-file system. Horizontal scaling, cross-datacenter replication, and distributed consensus are outside v1.x scope.

### Evidence Non-Proofs

- **4 invariants classified Implemented** -- source enforcement exists but no dedicated test verifies the enforcement path. Specifically: DBA-I7 (frozen terminology, type-level only), DBA-I11 (deliberation dimension in EGP types), CCP-I6 (relationship append-only trigger), CCP-I11 (archive flag forward-only trigger).
- **11 invariants classified Declared** -- test or documentation references exist but no source code enforcement is present. Specifically: DBA-I6, DBA-I9 (no code reference -- may be documentation-only), EGP-I2 (no mid-execution rebalancing -- structural property), CGP-I8 (WMP scope filtering), CGP-I9 (eviction is selection), CCP-I16 (reserved namespace validation), I-68 (eviction order determinism), I-73 (replay record P4 details), I-75 (canonical serializer determinism), TGP-I7, TGP-I8 (no distinct enforcement beyond parent invariants).
- **4 invariants classified Out of Scope** -- no codebase presence at all. CCP-I3, CCP-I7, CCP-I8, CCP-I15 exist only in the CCP design source document.
- **8 failure mode defenses classified Implemented** -- defense code exists in production but tests are scaffold-only with decorative assertions (`assert.ok(true)`) or coverage is indirect. Specifically: FM-05 (state corruption / concurrency), FM-09 (tool poisoning), FM-11 (observability overhead), FM-12 (provider failover budget cascade), FM-15 (artifact entropy), FM-16 (mission drift), FM-18 (capability escalation), FM-20 (worker deadlock).
- **1 failure mode classified Declared** -- FM-04 (cascading agent failure) is referenced only in FM-19 scaffold as "broader category." No independent defense mechanism.
- **~15 security sub-mechanism properties classified Implemented** at the detail level within otherwise-Verified mechanisms: PBKDF2 iteration count (no dedicated test), master key minimum length (no dedicated test), batch audit append (no test), migration checksum computation/verification/error handling (no dedicated tests for the checksum path), RBAC restart persistence and default role seeding (no dedicated tests), TimeProvider and SystemTimeProvider interface definitions (no dedicated test), API key scrubbing in errors (no dedicated test). Full list in [security-model.md](./security-model.md) evidence tables.

### Security Non-Proofs

Consolidated from [security-model.md](./security-model.md) -- 25 declared non-protections grouped by domain:

**Encryption boundaries (4):** SQLite file is not encrypted (per-field vault only; filesystem access exposes unencrypted data). Post-quantum cryptography not implemented. No key rotation mechanism. Auto-generated dev key is not production-grade.

**Audit boundaries (4):** No gap detection before the first audit entry (empty trail indistinguishable from missing trail). Archive files are not cryptographically signed. GDPR tombstone destroys original hashes (post-tombstone chain proves integrity of the tombstoned chain, not the original). No independent witness (self-verifying hash chain, not externally attested).

**Authorization boundaries (3):** RBAC dormant by default (all operations permitted until first custom role). No resource-level permissions (operation-scoped only). No role hierarchy (flat permission sets).

**Isolation boundaries (4):** No SQLite-level row-level security (application-layer facade only). INSERT pass-through (tenant_id in INSERTs is caller responsibility). Database-per-tenant incomplete (Phase 1 is single-connection). Complex SQL throws fail-closed (safe but noisy).

**Transport boundaries (3):** No TLS for localhost (by design for Ollama; local traffic unencrypted). No certificate pinning. No independent rate limiting on error responses (error probing possible).

**Budget boundaries (3):** Soft defaults, not hard caps (operators can set arbitrary budgets). Overage recorded, not prevented (post-invocation reconciliation, not mid-invocation interruption). Estimated deliberation is not provider-authoritative.

**Verification boundaries (4):** No formal verification (test-based proofs only). Error redaction is pattern-based (novel leakage patterns may bypass). No NTP validation (host clock trusted without verification). No monotonicity guarantee on timestamps (clock jumps not detected).

### Community Non-Proofs

- **Near-zero community adoption evidence.** No download statistics, no known production users, no community-contributed fixes or extensions.
- **No third-party security audit.** All security analysis is internal.
- **No independent benchmark verification.** All performance measurements are self-reported.
- **No public bug bounty program.**

---

## Evidence Classes Explained

| Class | Definition | What It Means |
|---|---|---|
| **Verified** | Source enforcement + meaningful test coverage | Highest confidence. Defense exists and is tested with non-decorative assertions. Both success and rejection paths exercised where applicable. |
| **Implemented** | Source enforcement exists, test coverage weak or absent | Defense exists in code but is not independently verified by tests. Scaffold tests with `assert.ok(true)` do not qualify as verification (Hard Ban #8). |
| **Measured** | Quantitative measurement with defined threshold | Property is a benchmark, not a binary assertion (e.g., I-14 latency thresholds). Measurement is via test harness, not production telemetry. |
| **Declared** | Specification or documentation only, no source enforcement | Claimed but not proven. Test references may exist but enforcement is in documentation or design only. Forward obligation. |
| **Out of Scope** | Not applicable to current version or deployment model | Explicitly excluded from v1.x scope. Either the invariant exists only in a design source document or the failure mode applies to a deployment context (distributed, multi-node) not supported by the current architecture. |

---

## Proof Document Index

| Document | Scope | Key Numbers |
|---|---|---|
| [system-calls.md](./system-calls.md) | 16 system calls -- interface, implementation, test evidence | 16/16 Verified |
| [invariants.md](./invariants.md) | 134 invariants across 3 tiers -- Tier 1 (core frozen), Tier 2 (extended), Tier 3 (subsystem) | 114 Verified, 1 Measured, 4 Implemented, 11 Declared, 4 Out of Scope |
| [failure-modes.md](./failure-modes.md) | 45 specified failure modes -- traceable defense inventory | 12 Verified, 8 Implemented, 1 Declared, 24 zero code presence |
| [security-model.md](./security-model.md) | 8 security mechanisms -- per-property evidence tables with non-protections | 8/8 Verified (mechanism level), 25 non-protections declared |

---

## How to Verify

For any claim in this document:

1. Follow the proof document link
2. Find the specific evidence table row
3. Open the referenced `file:line` in the source
4. Run the referenced test

Every proof document is CI-governed -- stale `file:line` references fail the build via `scripts/verify-proof-pack.ts`.

### Verification Commands

```bash
# Run the full test suite (2,447+ tests)
npm test

# Run proof pack reference verification
npx tsx scripts/verify-proof-pack.ts

# Run a specific invariant test
npx vitest tests/invariants/i11_encryption_at_rest.test.ts

# Run a specific contract test suite
npx vitest tests/contract/test_contract_ccp.test.ts
```

---

## Honest Summary

Limen proves its constitutional layer through 16 verified system calls, 114 verified invariants, 12 verified failure mode defenses, and 8 verified security mechanisms. The evidence is test-based, CI-governed, and traceable to source file and line number.

Limen does NOT prove the remaining 20 invariants (1 Measured, 4 Implemented, 11 Declared, 4 Out of Scope), the remaining 33 failure modes (8 Implemented, 1 Declared, 24 absent), or any of the 25 security non-protections. It has zero production deployments, zero third-party audits, zero formal verification, and near-zero community adoption evidence.

The total claim is: **a well-tested specification-derived engine with honest boundaries.** Not a production-hardened platform. Not a formally verified system. Not a community-validated project. A precisely scoped, deeply tested foundation with every gap declared.
