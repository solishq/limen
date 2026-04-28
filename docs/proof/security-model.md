# Security Model -- Evidence Index

> CI-governed. Every `file:line` reference is verified by `scripts/verify-proof-pack.ts`.
> Stale references fail the build.
>
> Generated: 2026-03-24
> Limen version: 3.3.0 (internal spec version; npm package: v2.0.0)

## Evidence Classes

| Class | Definition | Criteria |
|---|---|---|
| **Verified** | Source enforcement AND test coverage exist | Mechanism enforced in source code with at least one passing test exercising the enforcement path |
| **Implemented** | Source enforcement exists, no dedicated test | Code enforces the mechanism but no test exercises this specific security property |
| **Measured** | Runtime measurement confirms the property | Security property confirmed via benchmark, timing analysis, or measurement harness |
| **Declared** | Design/documentation references exist, no source enforcement | Security property referenced in design but enforcement is structural/architectural only |
| **Out of Scope** | Not applicable to current build phase | Security mechanism deferred to a future phase or not yet implemented |

## Summary Table

| # | Mechanism | Evidence Class | Key Invariant | Implementation | Tests |
|---|---|---|---|---|---|
| 1 | AES-256-GCM Encryption (Vault) | Verified | I-11 | `src/kernel/crypto/crypto_engine.ts` | `tests/invariants/i11_encryption_at_rest.test.ts` |
| 2 | Append-Only Audit Trail | Verified | I-06, I-03, FM-08 | `src/kernel/audit/audit_trail.ts` | `tests/gap/test_gap_004_audit_tamper.test.ts` |
| 3 | Tenant Isolation | Verified | FM-10, RDD-3 | `src/kernel/tenant/tenant_scope.ts` | `tests/unit/test_tenant_scope.test.ts` |
| 4 | RBAC (Role-Based Access Control) | Verified | I-13, S34, S3.7 | `src/kernel/rbac/rbac_engine.ts` | `tests/rbac/rbac_enforcement.test.ts` |
| 5 | Budget Enforcement | Verified | FM-02, I-20 | `src/budget/impl/dba_impl.ts` | `tests/gap/test_gap_005_budget_enforcement.test.ts` |
| 6 | Migration Safety | Verified | C-05 | `src/kernel/database/database_lifecycle.ts` | `tests/contract/test_governance_migrations.test.ts` |
| 7 | Clock Injection (TimeProvider) | Verified | Hard Stop #7 | `src/kernel/time/time_provider.ts` | Throughout (30+ test files import TimeProvider) |
| 8 | Error Redaction / Input Validation | Verified | S39 IP-4, I-20, FPD-3 | `src/api/errors/limen_error.ts` | `tests/gap/test_gap_014_public_api_boundary.test.ts` |

**Evidence class counts:** Verified: 8, Implemented: 0, Measured: 0, Declared: 0, Out of Scope: 0

---

## 1. AES-256-GCM Encryption (Vault)

### What It Protects

Per-field encryption of secrets stored in the `core_vault` table using AES-256-GCM with PBKDF2-derived keys (600,000 iterations), plus string-level encryption for LLM gateway payloads and webhook content.

### What It Does NOT Protect

1. **The SQLite file itself is NOT encrypted.** Encryption is per-field via the vault subsystem. An attacker with filesystem access can read unencrypted columns (mission objectives, task graphs, audit entries, etc.). Only vault-stored secrets and explicitly encrypted payloads are protected.
2. **Post-quantum cryptography is forward-declared, NOT implemented.** ML-KEM-512 hybrid is mentioned in the spec as a compliance opt-in. No implementation exists. Evidence class for post-quantum: Out of Scope.
3. **No key rotation mechanism.** The `core_encryption_keys` table has a `rotated_at` column and `active` flag, but no rotation logic is implemented. Keys are derived once and cached.
4. **Auto-generated dev key is NOT production-grade.** When no `masterKey` is provided to `createLimen()`, a generated key is used. This is acceptable for development only.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| AES-256-GCM cipher selection | `src/kernel/crypto/crypto_engine.ts:27` | `tests/invariants/i11_encryption_at_rest.test.ts:91` | Verified |
| 256-bit key length enforcement | `src/kernel/crypto/crypto_engine.ts:28` | `tests/invariants/i11_encryption_at_rest.test.ts:122` | Verified |
| 96-bit IV per NIST SP 800-38D | `src/kernel/crypto/crypto_engine.ts:29` | `tests/invariants/i11_encryption_at_rest.test.ts:136` | Verified |
| 128-bit auth tag | `src/kernel/crypto/crypto_engine.ts:30` | `tests/invariants/i11_encryption_at_rest.test.ts:147` | Verified |
| Unique random IV per encryption | `src/kernel/crypto/crypto_engine.ts:91` | `tests/invariants/i11_encryption_at_rest.test.ts:234` | Verified |
| Encrypt/decrypt round-trip | `src/kernel/crypto/crypto_engine.ts:77` | `tests/invariants/i11_encryption_at_rest.test.ts:104` | Verified |
| Wrong key rejection | `src/kernel/crypto/crypto_engine.ts:122` | `tests/invariants/i11_encryption_at_rest.test.ts:163` | Verified |
| Tampered ciphertext rejection (GCM auth) | `src/kernel/crypto/crypto_engine.ts:136` | `tests/invariants/i11_encryption_at_rest.test.ts:182` | Verified |
| PBKDF2 key derivation (600k iterations) | `src/kernel/crypto/crypto_engine.ts:33` | — | Implemented |
| Vault store (atomic upsert) | `src/kernel/crypto/crypto_engine.ts:197` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| Vault retrieve (re-derive + decrypt) | `src/kernel/crypto/crypto_engine.ts:264` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| String-level encryption (LLM/webhook) | `src/kernel/crypto/crypto_engine.ts:402` | `tests/contract/test_contract_webhook_delivery.test.ts` | Verified |
| Timing-safe HMAC comparison | `src/kernel/crypto/crypto_engine.ts:447` | `tests/contract/test_contract_webhook_delivery.test.ts` | Verified |
| Master key minimum length (32 bytes) | `src/kernel/crypto/crypto_engine.ts:48` | — | Implemented |

### Trust Boundary

Encrypted data crosses trust boundaries at:
- **Vault store/retrieve**: Plaintext exists only in memory during the store/retrieve call. Ciphertext is written to SQLite as base64.
- **String encryption**: Used at the LLM gateway and webhook delivery boundary. Plaintext payload is encrypted before persistence, decrypted on read.
- **API key resolution**: Keys resolved once at adapter creation (`src/substrate/transport/transport_engine.ts:19`), never persisted to database, never included in error messages or audit trails.

---

## 2. Append-Only Audit Trail

### What It Protects

Every state mutation is recorded in a SHA-256 hash-chained, monotonically sequenced, append-only audit log. The audit entry is committed in the same SQLite transaction as the mutation itself (I-03 atomicity). Hash chain integrity is verifiable on demand. GDPR tombstoning preserves chain integrity via cascade re-hash.

### What It Does NOT Protect

1. **Does NOT detect gaps before the first entry.** The chain anchors from `SHA-256("")` (genesis hash). If the system is started and no mutations occur, there is no audit trail. No mechanism detects a "missing first entry" scenario.
2. **Archive files are NOT cryptographically signed.** The `archive()` function copies entries to a sealed SQLite file and records the segment metadata (including `final_hash`), but the archive file itself has no digital signature. An attacker with filesystem access could replace the archive file.
3. **Tombstone operation is destructive to original hashes.** GDPR tombstoning (`tombstone()`) replaces PII fields and cascade re-hashes the entire chain from the first tombstoned entry forward. The original hashes are lost. This is by design (GDPR Art. 17 compliance), but means post-tombstone chain verification proves integrity of the tombstoned chain, not the original.
4. **No independent witness.** The audit trail is self-verifying (hash chain), not externally attested. A sufficiently privileged attacker who can modify both the audit table and the verification code could forge a valid chain.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| SHA-256 hash chain computation | `src/kernel/audit/audit_trail.ts:47` | `tests/gap/test_gap_004_audit_tamper.test.ts:57` | Verified |
| Genesis hash anchor (SHA-256 of empty string) | `src/kernel/audit/audit_trail.ts:26` | `tests/gap/test_gap_004_audit_tamper.test.ts:58` | Verified |
| Append-only: UPDATE trigger (I-06) | `src/kernel/database/migrations.ts:49` | `tests/gap/test_gap_004_audit_tamper.test.ts:25` | Verified |
| Append-only: DELETE trigger (I-06) | `src/kernel/database/migrations.ts:63` | `tests/gap/test_gap_004_audit_tamper.test.ts:40` | Verified |
| Atomic audit in same transaction (I-03) | `src/kernel/audit/audit_trail.ts:77` | `tests/invariants/i05_transactional_consistency.test.ts:129` | Verified |
| Monotonic sequence numbers | `src/kernel/audit/audit_trail.ts:90` | `tests/gap/test_gap_004_audit_tamper.test.ts:58` | Verified |
| Chain verification (verifyChain) | `src/kernel/audit/audit_trail.ts:302` | `tests/gap/test_gap_004_audit_tamper.test.ts:57` | Verified |
| Tamper detection (broken chain) | `src/kernel/audit/audit_trail.ts:385` | `tests/gap/test_gap_004_audit_tamper.test.ts:57` | Verified |
| Archive to sealed file (I-06) | `src/kernel/audit/audit_trail.ts:425` | `tests/gap/test_gap_011_system_operations.test.ts` | Verified |
| Archive bypass flag (SEC-004) | `src/kernel/audit/audit_trail.ts:525` | `tests/gap/test_gap_011_system_operations.test.ts` | Verified |
| GDPR tombstone with cascade re-hash | `src/kernel/audit/audit_trail.ts:572` | `tests/gap/test_gap_018_data_integrity.test.ts` | Verified |
| Tombstone meta-audit entry (FO-001) | `src/kernel/audit/audit_trail.ts:669` | `tests/gap/test_gap_018_data_integrity.test.ts` | Verified |
| Global chain (tenant-agnostic sequencing) | `src/kernel/audit/audit_trail.ts:36` | `tests/gap/test_gap_004_audit_tamper.test.ts:57` | Verified |
| Batch append for observational audits | `src/kernel/audit/audit_trail.ts:139` | — | Implemented |

### Trust Boundary

- **Audit entries cross no external trust boundary.** All entries are written to and read from the same SQLite database. The chain verification is a self-consistency check, not an external attestation.
- **The `raw` connection escape hatch** (`tenant_scope.ts:40`) is used by audit chain queries because the hash chain is global, not per-tenant. This is documented at `src/kernel/audit/audit_trail.ts:36`.

---

## 3. Tenant Isolation

### What It Protects

Row-level tenant isolation via automatic `tenant_id` injection into all SELECT/UPDATE/DELETE queries. The `TenantScopedConnection` facade wraps the raw `DatabaseConnection` and intercepts all query methods. Complex SQL (JOINs, CTEs, subqueries, set operations) throws immediately rather than silently mis-positioning the tenant predicate.

### What It Does NOT Protect

1. **Complex SQL throws instead of silently mis-filtering.** This is safe (fail-closed) but noisy. Any query using JOIN, CTE, subquery, UNION, EXISTS, etc. through a scoped connection will throw with a descriptive error. The developer must use `.raw` with a `// SYSTEM_SCOPE` annotation. This is by design (CORR1-01, AUDIT-001).
2. **No row-level security at the SQLite level.** SQLite has no native row-level security (RLS). Isolation is enforced at the application layer via the `TenantScopedConnection` facade. A direct SQLite connection (bypassing the facade) has unrestricted access.
3. **INSERT statements pass through without injection.** The caller is responsible for including `tenant_id` in INSERT values. The facade only injects predicates on SELECT/UPDATE/DELETE. This is documented at `src/kernel/tenant/tenant_scope.ts:103`.
4. **Empty string tenantId treated as falsy (AUDIT-002).** An empty string `""` for tenantId is treated the same as `null` -- no scoping applied. This prevents a class of bypass where an empty string tenant could access all data.
5. **Database-per-tenant mode is not fully implemented.** Phase 1 routes all tenants through the primary connection. Full DB-per-tenant routing is a Phase 2 capability (`src/kernel/tenant/tenant_context.ts:63`).

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| Auto-inject AND tenant_id (SELECT with WHERE) | `src/kernel/tenant/tenant_scope.ts:120` | `tests/unit/test_tenant_scope.test.ts:45` | Verified |
| Auto-inject WHERE tenant_id (SELECT without WHERE) | `src/kernel/tenant/tenant_scope.ts:121` | `tests/unit/test_tenant_scope.test.ts:53` | Verified |
| Position before ORDER BY/GROUP BY/LIMIT | `src/kernel/tenant/tenant_scope.ts:124` | `tests/unit/test_tenant_scope.test.ts:61` | Verified |
| INSERT pass-through (no injection) | `src/kernel/tenant/tenant_scope.ts:104` | `tests/unit/test_tenant_scope.test.ts` | Verified |
| Complex SQL fail-safe (CORR1-01) | `src/kernel/tenant/tenant_scope.ts:56` | `tests/unit/test_tenant_scope.test.ts` | Verified |
| JOIN detection and throw | `src/kernel/tenant/tenant_scope.ts:57` | `tests/unit/test_tenant_scope.test.ts` | Verified |
| CTE (WITH) detection and throw | `src/kernel/tenant/tenant_scope.ts:58` | `tests/unit/test_tenant_scope.test.ts` | Verified |
| Subquery detection and throw | `src/kernel/tenant/tenant_scope.ts:59` | `tests/unit/test_tenant_scope.test.ts` | Verified |
| Raw escape hatch (.raw property) | `src/kernel/tenant/tenant_scope.ts:39` | `tests/gap/test_gap_004_audit_tamper.test.ts` | Verified |
| Falsy tenantId bypass prevention (AUDIT-002) | `src/kernel/tenant/tenant_scope.ts:155` | `tests/gap/test_gap_012_adversarial_tenant.test.ts` | Verified |
| Row-level mode scoping | `src/kernel/tenant/tenant_scope.ts:186` | `tests/gap/test_gap_001_tenant_isolation.test.ts:32` | Verified |
| Single mode pass-through | `src/kernel/tenant/tenant_scope.ts:156` | `tests/gap/test_gap_001_tenant_isolation.test.ts:77` | Verified |
| TENANT_ID_REQUIRED in row-level mode | `src/kernel/tenant/tenant_context.ts:44` | `tests/gap/test_gap_001_tenant_isolation.test.ts:32` | Verified |
| Cross-tenant query prevention | `src/kernel/tenant/tenant_scope.ts:194` | `tests/gap/test_gap_009_cross_tenant_isolation.test.ts` | Verified |

### Trust Boundary

- **The facade IS the connection.** Orchestration code receives a `TenantScopedConnection`, not a raw `DatabaseConnection`. The raw connection is only accessible via the `.raw` escape hatch, which requires explicit `// SYSTEM_SCOPE` annotation in the code.
- **Audit hash chain uses `.raw`** because the chain is global across all tenants. This is correct -- the audit trail must not be partitioned by tenant.

---

## 4. RBAC (Role-Based Access Control)

### What It Protects

Permission enforcement on every operation via five default roles (admin, developer, operator, viewer, auditor) with configurable custom roles. Permission check is invoked before every API-layer operation.

### What It Does NOT Protect

1. **CRITICAL: RBAC is dormant in single-user mode.** When `rbacActive` is `false` (the default), `checkPermission()` returns `true` for ALL operations (`src/kernel/rbac/rbac_engine.ts:101`). RBAC activates only when the first custom (non-default) role is created via `createRole()`. This means: **in the default deployment, there is zero permission enforcement.** This is by spec design (S3.7) but must be declared honestly.
2. **No fine-grained resource-level permissions.** Permissions are operation-scoped (e.g., `chat`, `create_mission`), not resource-scoped. A user with `chat` permission can chat with any agent. There is no per-agent or per-mission permission scoping.
3. **No role hierarchy or inheritance.** Roles are flat sets of permissions. There is no concept of role inheritance (e.g., admin inherits developer permissions). Each role explicitly lists all its permissions.
4. **CF-006 restart persistence.** On engine restart, RBAC active state is restored from the database by checking for custom roles (`src/kernel/rbac/rbac_engine.ts:83`). Without this fix, a restart after role creation would leave RBAC dormant.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| Dormant mode (single-user default) | `src/kernel/rbac/rbac_engine.ts:78` | `tests/rbac/rbac_enforcement.test.ts:36` | Verified |
| checkPermission returns true when dormant | `src/kernel/rbac/rbac_engine.ts:101` | `tests/rbac/rbac_enforcement.test.ts:36` | Verified |
| Permission check when active | `src/kernel/rbac/rbac_engine.ts:106` | `tests/rbac/rbac_enforcement.test.ts:59` | Verified |
| Five default roles (admin, developer, operator, viewer, auditor) | `src/kernel/rbac/rbac_engine.ts:23` | `tests/rbac/rbac_enforcement.test.ts:57` | Verified |
| Custom role creation activates RBAC | `src/kernel/rbac/rbac_engine.ts:145` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| Role assignment to principals | `src/kernel/rbac/rbac_engine.ts:164` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| Role revocation | `src/kernel/rbac/rbac_engine.ts:211` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| Permission resolution (union of assigned roles) | `src/kernel/rbac/rbac_engine.ts:240` | `tests/gap/test_gap_015_security_enforcement.test.ts` | Verified |
| Restart persistence (CF-006) | `src/kernel/rbac/rbac_engine.ts:83` | — | Implemented |
| Seed default roles | `src/kernel/rbac/rbac_engine.ts:276` | — | Implemented |
| Audit query requires view_audit permission | `src/kernel/audit/audit_trail.ts:209` | `tests/rbac/rbac_enforcement.test.ts:85` | Verified |
| API-level RBAC enforcement (I-13) | `src/api/governance/governed_orchestration.ts:20` | `tests/rbac/rbac_enforcement.test.ts:1` | Verified |

### Trust Boundary

- **RBAC is enforced at two layers**: (1) the API boundary (`governed_orchestration.ts`) checks permissions before delegating, and (2) individual subsystems (e.g., audit trail query) check their own permissions as defense-in-depth.
- **The dormant-to-active transition is one-way.** Once RBAC activates (first custom role created), it cannot be deactivated without deleting all custom roles from the database.

---

## 5. Budget Enforcement

### What It Protects

Three-tier budget governance preventing cost explosion (FM-02): admission tier (per-mission reservation), mission tier (cumulative consumption tracking with threshold events at 25/50/75/90%), and invocation tier (per-reconcile fresh allocation). Token and deliberation dimensions are independent (DBA-I1). Budget remaining is never negative (DBA-I13) -- overage is recorded explicitly.

### What It Does NOT Protect

1. **Budget limits are soft defaults, not hard caps.** The default budgets (1,000 admission tokens, 10,000 mission tokens, 200 invocation tokens) are configurable. An operator with `manage_budgets` permission can set arbitrarily large budgets.
2. **Overage is recorded but not prevented.** DBA-I13 clamps `remaining` to zero but records the overage amount. The provider call that caused the overage has already consumed the tokens. Budget enforcement is pre-invocation admission + post-invocation reconciliation, not mid-invocation interruption.
3. **Estimated deliberation is not provider-authoritative.** When a provider does not report thinking tokens, deliberation is estimated via the `DeliberationEstimator`. These estimates carry an explicit `'estimated'` accounting mode (DBA-I4) and are not as accurate as provider-reported values.
4. **No cross-mission budget aggregation.** Each mission has independent budgets. There is no global "organization spend cap" across all missions.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| BUDGET_EXCEEDED rejection | `src/orchestration/budget/budget_governance.ts:68` | `tests/gap/test_gap_005_budget_enforcement.test.ts:29` | Verified |
| Remaining never negative (CHECK constraint) | `src/orchestration/migration/003_orchestration.ts:179` | `tests/gap/test_gap_005_budget_enforcement.test.ts:68` | Verified |
| Three-tier budget model | `src/budget/impl/dba_impl.ts:8` | `tests/contract/test_contract_dba.test.ts:1` | Verified |
| Token/deliberation independence (DBA-I1) | `src/budget/impl/dba_impl.ts:28` | `tests/contract/test_contract_dba.test.ts` | Verified |
| Pre-invocation admissibility check | `src/budget/impl/dba_impl.ts` | `tests/contract/test_contract_dba.test.ts` | Verified |
| Post-invocation reconciliation | `src/budget/impl/dba_impl.ts` | `tests/contract/test_contract_dba.test.ts` | Verified |
| Threshold events at 25/50/75/90% | `src/budget/impl/dba_impl.ts:66` | `tests/contract/test_contract_dba.test.ts` | Verified |
| Overage recording (DBA-I13) | `src/budget/interfaces/dba_types.ts:69` | `tests/contract/test_contract_dba.test.ts` | Verified |
| ECB computation (non-negative, DBA-I14) | `src/budget/interfaces/dba_types.ts:416` | `tests/contract/test_contract_dba.test.ts` | Verified |
| Context policy ceiling inheritance (DBA-I8) | `src/budget/interfaces/dba_types.ts:110` | `tests/contract/test_contract_dba.test.ts` | Verified |
| SC-8 request_budget integration | `src/orchestration/syscalls/request_budget.ts:3` | `tests/contract/test_contract_sc8_request_budget.test.ts` | Verified |

### Trust Boundary

- **Budget enforcement sits between the orchestrator and the LLM gateway.** Pre-invocation check happens before the provider call. Post-invocation reconciliation happens after. The provider call itself is not budget-aware -- it executes fully and reports consumption afterward.
- **Budget events (threshold, exceeded) propagate through the event system** and can trigger checkpoint participation, mission pausing, or human approval gates.

---

## 6. Migration Safety

### What It Protects

Forward-only, hash-checked database migrations. Every migration file produces a SHA-256 checksum at definition time. At migration execution time, the checksum is recomputed and compared. A mismatch (indicating the migration file was modified after initial application) is a hard error. Migrations are recorded in the `core_migrations` table with version, name, checksum, and status.

### What It Does NOT Protect

1. **No rollback mechanism.** Migrations are forward-only (C-05). There is no `down()` or `rollback()` function. If a migration introduces a defect, the fix is a new forward migration.
2. **Checksum verification is at runtime, not CI.** The checksum is verified when `migrate()` is called. There is no standalone CI job that verifies migration checksums against a known-good registry. The pre-commit hook checks migration file immutability at commit time.
3. **No migration ordering enforcement beyond version numbers.** Migrations are sorted by version number. If two developers create migrations with the same version number, the conflict is detected at the SQL level (duplicate version in `core_migrations`), not at the file level.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| SHA-256 checksum computation | `src/kernel/database/migrations.ts:401` | — | Implemented |
| Checksum verification at migration time | `src/kernel/database/database_lifecycle.ts:248` | — | Implemented |
| MIGRATION_CHECKSUM_MISMATCH error | `src/kernel/database/database_lifecycle.ts:254` | — | Implemented |
| Forward-only execution (no rollback) | `src/kernel/database/database_lifecycle.ts:222` | — | Implemented |
| Migration recorded in core_migrations | `src/kernel/database/database_lifecycle.ts:267` | `tests/helpers/test_database.ts` | Verified |
| Failed migration recorded with status | `src/kernel/database/database_lifecycle.ts:283` | — | Implemented |
| Immutability triggers (I-19, I-24) | `src/orchestration/migration/005_immutability_triggers.ts:28` | `tests/contract/test_governance_migrations.test.ts` | Verified |
| Audit immutability triggers (I-06) | `src/kernel/database/migrations.ts:49` | `tests/gap/test_gap_004_audit_tamper.test.ts:25` | Verified |
| Tenant isolation triggers (FM-10) | `src/orchestration/migration/004_tenant_isolation.ts` | `tests/gap/test_gap_001_tenant_isolation.test.ts` | Verified |

### Trust Boundary

- **Migrations execute with full database privileges.** The migration runner uses the raw `better-sqlite3` instance, not a tenant-scoped connection. Migration SQL can create, alter, or drop any table.
- **Migration files are source-controlled.** The checksum mechanism detects post-merge tampering but does not prevent it at the filesystem level.

---

## 7. Clock Injection (TimeProvider)

### What It Protects

All temporal logic receives time through a `TimeProvider` dependency, preventing time manipulation attacks and enabling deterministic testing. Production uses `createSystemTimeProvider()` (real wall clock). Tests use `createTestTimeProvider()` (deterministic, advanceable). Direct calls to `Date.now()` or `new Date()` in business logic are forbidden (Hard Stop #7).

### What It Does NOT Protect

1. **No NTP validation.** The `SystemTimeProvider` trusts the host system clock. If the host clock is manipulated (e.g., by an attacker with OS-level access), all timestamps will be wrong. Limen does not validate time against an external time source.
2. **Clock-exempt infrastructure.** Log timestamps and telemetry may use direct `Date.now()` with a `// clock-exempt` annotation. These are not governed by TimeProvider.
3. **No monotonicity enforcement.** The TimeProvider interface does not guarantee monotonically increasing timestamps. If the system clock jumps backward (e.g., NTP correction), `nowMs()` could return a value smaller than a previous call.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| TimeProvider interface | `src/kernel/time/time_provider.ts:13` (via kernel interfaces) | — | Implemented |
| SystemTimeProvider (production) | `src/kernel/time/time_provider.ts:21` | — | Implemented |
| TestTimeProvider (deterministic) | `src/kernel/time/time_provider.ts:45` | Throughout (30+ test files) | Verified |
| Advance method for test control | `src/kernel/time/time_provider.ts:62` | `tests/contract/test_contract_drift_engine.test.ts` | Verified |
| Audit trail uses injected clock | `src/kernel/audit/audit_trail.ts:71` | `tests/gap/test_gap_004_audit_tamper.test.ts` | Verified |
| Transport engine uses TimeProvider | `src/substrate/transport/transport_engine.ts:24` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| Budget reconciliation uses TimeProvider | `src/budget/impl/dba_impl.ts` | `tests/contract/test_contract_dba.test.ts` | Verified |

### Trust Boundary

- **TimeProvider is injected at construction time.** Every subsystem that needs time receives it as a dependency. There is no global mutable clock.
- **Test determinism depends on correct injection.** If a subsystem bypasses TimeProvider, its temporal behavior becomes non-deterministic in tests.

---

## 8. Error Redaction / Input Validation

### What It Protects

**Error Redaction (S39 IP-4):** All errors at the API boundary are `LimenError` instances. Internal details (SQL statements, file paths, stack traces, SQLite error codes, dependency internals, sensitive tokens) are automatically redacted via pattern matching. When internal details are detected, a generic safe message is substituted.

**Input Validation (I-20):** Structural limits are enforced throughout: mission tree boundedness (max depth 5, max children 10, max total missions 50), event payload size (64KB), justification size (10KB), working memory key length (256 chars), and per-entry value size limits.

### What It Does NOT Protect

1. **Error codes are not redacted.** The `LimenErrorCode` (e.g., `BUDGET_EXCEEDED`, `DEPTH_EXCEEDED`) is always visible. This is by design -- codes are machine-readable and do not contain sensitive information -- but they reveal which internal mechanism rejected the operation.
2. **Redaction is pattern-based, not proof-based.** The `REDACTION_PATTERNS` array matches known dangerous patterns (SQL keywords, file paths, stack traces). A novel form of internal state leakage that does not match these patterns would pass through.
3. **No rate limiting on error responses.** Error responses are not rate-limited independently of the operation rate limiter. An attacker could probe error codes to map internal behavior.
4. **Transport security: No TLS for localhost.** By design, `localhost`, `127.0.0.1`, `::1`, and `.local` addresses are exempt from TLS enforcement (`src/substrate/transport/transport_engine.ts:89`). This is necessary for local Ollama integration but means local network traffic is unencrypted.
5. **Transport security: No certificate pinning.** TLS is enforced for non-local URLs, but there is no certificate pinning. A compromised CA could issue a fraudulent certificate.
6. **No formal input sanitization framework.** Input validation is ad-hoc (CHECK constraints, explicit size checks at call sites). There is no centralized input validation middleware.

### Evidence

| Property | Implementation (file:line) | Test (file:line) | Evidence Class |
|---|---|---|---|
| Redaction pattern matching | `src/api/errors/limen_error.ts:30` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| SQL statement redaction | `src/api/errors/limen_error.ts:31` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| File path redaction | `src/api/errors/limen_error.ts:32` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| Stack trace redaction | `src/api/errors/limen_error.ts:33` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| Sensitive token redaction | `src/api/errors/limen_error.ts:35` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| SQLite internals redaction | `src/api/errors/limen_error.ts:36` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| Generic safe message substitution | `src/api/errors/limen_error.ts:59` | `tests/gap/test_gap_014_public_api_boundary.test.ts` | Verified |
| Kernel error code mapping | `src/api/errors/limen_error.ts:231` | `tests/gap/test_gap_019_sc_error_codes.test.ts` | Verified |
| TLS enforcement (non-local) | `src/substrate/transport/transport_engine.ts:109` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| Localhost TLS exemption | `src/substrate/transport/transport_engine.ts:89` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| API key scrubbing in errors | `src/substrate/transport/transport_engine.ts:77` | — | Implemented |
| Response size cap (10MB) | `src/substrate/transport/transport_engine.ts:50` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| Streaming timeouts (30s first-byte, 30s stall, 10min total) | `src/substrate/transport/transport_engine.ts:53` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| Retry-After cap (60s) | `src/substrate/transport/transport_engine.ts:47` | `tests/contract/test_phase5_sprint5a.test.ts` | Verified |
| Mission tree depth limit (I-20) | `src/orchestration/missions/mission_store.ts:80` | `tests/gap/test_gap_002_mission_validation.test.ts` | Verified |
| Mission tree children limit (I-20) | `src/orchestration/missions/mission_store.ts:86` | `tests/gap/test_gap_002_mission_validation.test.ts` | Verified |
| Mission tree size limit (I-20) | `src/orchestration/missions/mission_store.ts:92` | `tests/gap/test_gap_002_mission_validation.test.ts` | Verified |
| Event payload size limit (64KB) | `src/orchestration/events/event_propagation.ts:25` | `tests/contract/test_contract_sc6_emit_event.test.ts` | Verified |
| Working memory key length limit (256) | `src/working-memory/stores/wmp_stores.ts:109` | `tests/contract/test_contract_wmp.test.ts` | Verified |

### Trust Boundary

- **Error redaction happens at the API boundary (FPD-3).** Internal layers use `Result<T>` with full error details. The `mapKernelError()` function at `src/api/errors/limen_error.ts:309` translates internal errors to safe `LimenError` instances.
- **Transport security sits at the substrate layer.** TLS enforcement, response size caps, and timeout limits are enforced in the transport engine before any response data reaches the orchestration layer.

---

## Non-Protections Summary

This section consolidates everything the Limen security model does NOT cover. These are honest declarations, not TODO items.

### Encryption Boundaries

1. **SQLite file is NOT encrypted.** Per-field vault encryption only. Filesystem access exposes unencrypted data.
2. **Post-quantum cryptography is NOT implemented.** ML-KEM-512 is spec-declared, not built.
3. **No key rotation mechanism.** Keys are derived once. `rotated_at` column exists but is unused.
4. **Auto-generated dev key is NOT production-grade.**

### Audit Boundaries

5. **No gap detection before first entry.** Empty audit trail is indistinguishable from missing audit trail.
6. **Archive files are NOT signed.** Sealed SQLite files have no digital signature.
7. **Tombstone destroys original hashes.** Post-GDPR chain is re-hashed; original chain state is lost.
8. **No independent witness.** Self-verifying hash chain, not externally attested.

### Authorization Boundaries

9. **RBAC dormant by default.** All operations permitted until first custom role created. This is spec-intentional (S3.7).
10. **No resource-level permissions.** Permissions are operation-scoped, not object-scoped.
11. **No role hierarchy.** Flat permission sets per role.

### Isolation Boundaries

12. **No SQLite-level row-level security.** Application-layer facade only.
13. **INSERT pass-through.** Tenant_id in INSERTs is caller responsibility.
14. **Database-per-tenant incomplete.** Phase 1 is single-connection for all modes.
15. **Complex SQL throws (fail-closed).** Safe but may surprise developers.

### Transport Boundaries

16. **No TLS for localhost.** By design for Ollama. Local traffic is unencrypted.
17. **No certificate pinning.** TLS enforcement without CA validation.
18. **No rate limiting on error responses.** Error probing is possible.

### Budget Boundaries

19. **Soft defaults, not hard caps.** Operators can set arbitrary budgets.
20. **Overage recorded, not prevented.** Post-invocation reconciliation, not mid-invocation interruption.
21. **Estimated deliberation is not authoritative.** Estimation when provider does not report thinking tokens.

### Verification Boundaries

22. **No formal verification.** All proofs are test-based, not mathematical.
23. **Redaction is pattern-based.** Novel leakage patterns may bypass detection.
24. **No NTP validation.** Host clock is trusted without verification.
25. **No monotonicity guarantee on timestamps.** Clock jumps are not detected.
