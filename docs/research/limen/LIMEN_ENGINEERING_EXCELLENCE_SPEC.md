# Limen Engineering Excellence Specification

**Date**: 2026-03-30
**Author**: SolisHQ Researcher (First-Principles Research, 30+ Sources Cross-Referenced)
**Status**: DEFINITIVE ENGINEERING STANDARD
**Purpose**: Every line of Limen code is a masterclass. This document defines how.
**Governing Law**: First Principles. Opus Level. Document Everything.

---

## Preamble: The Standard We Hold Ourselves To

SQLite has 155,800 lines of source code and 92 million lines of test code — a 590:1 ratio. It has 100% branch coverage and 100% MC/DC (Modified Condition/Decision Coverage). It has 6,754 assert statements enforcing invariants. It runs on every platform that has a C compiler. It has zero known bugs in production. It has been in continuous development since the year 2000, and it is arguably the most deployed software in human history.

That is the bar. Not "clean code." Not "good enough." Engineered excellence — the kind where reading the code teaches you how to write software.

Limen is cognitive infrastructure. It stores what AI agents know, governs what they can do, and audits what they did. The consequences of a bug in Limen are not a broken button — they are corrupted knowledge, violated governance, and silent failures in systems that humans trust. Every engineering decision in this document derives from that reality.

---

## Part 1: Code Standards

### 1.1 The Zero Tolerance List

These are absolute. No exceptions. No "just this once." CI enforces them.

| Rule | Enforcement | Rationale |
|------|-------------|-----------|
| Zero `any` | `@typescript-eslint/no-explicit-any` | `any` defeats the type system. If you need escape, use `unknown` and narrow. |
| Zero `as` type assertions | `@typescript-eslint/consistent-type-assertions` with `never` | `as` lies to the compiler. Use type guards, discriminated unions, or branded types. |
| Zero `!` non-null assertions | `@typescript-eslint/no-non-null-assertion` | `!` asserts what you hope, not what you know. Narrow with `if` or `??`. |
| Zero `// @ts-ignore` | `@typescript-eslint/ban-ts-comment` | If the type system disagrees with you, the type system is right. Fix the types. |
| Zero `console.log` in source | `no-console` | Use the structured logger. Always. |
| Zero unhandled promise rejections | `@typescript-eslint/no-floating-promises` | Every promise is awaited or explicitly voided with rationale. |
| Zero implicit `any` in parameters | `strict: true` in tsconfig | TypeScript strict mode is not optional. It is infrastructure. |
| Zero unused imports/variables | `@typescript-eslint/no-unused-vars` | Dead code is lying code. |
| Zero circular dependencies | `eslint-plugin-import/no-cycle` | Circular deps are architectural failures. |

### 1.2 Naming Conventions

Names are the API. If the name does not tell you what it does, the name is wrong.

**Files:**
- `kebab-case.ts` for all source files
- `kebab-case.test.ts` for test files, colocated with source
- `kebab-case.bench.ts` for benchmark files
- `index.ts` only at module boundaries (barrel exports), never for implementation

**Types and Interfaces:**
- `PascalCase` for all types, interfaces, enums, and classes
- Prefix interfaces with the domain, not `I`: `ClaimAssertion`, not `IClaimAssertion`
- Branded types use the pattern: `type ClaimId = string & { readonly __brand: 'ClaimId' }`
- Discriminated unions use a `_tag` or `kind` discriminant field

**Functions and Methods:**
- `camelCase` for all functions and methods
- Verb-first: `assertClaim`, `queryClaims`, `retractClaim`
- Boolean returns: `is` or `has` prefix: `isActive`, `hasEvidence`
- Factory functions: `create` prefix: `createLimen`, `createClaimStore`
- Predicate functions: `can` prefix: `canAccess`, `canModify`

**Constants:**
- `UPPER_SNAKE_CASE` for module-level constants: `MAX_CLAIM_SIZE`, `DEFAULT_CONFIDENCE`
- Use `as const` for literal objects to preserve narrow types

**Variables:**
- `camelCase` for all local variables
- Descriptive over short: `claimAssertionResult`, not `res` or `r`
- Loop variables may be single-letter only for trivial numeric iteration: `for (let i = 0; ...)`

### 1.3 File Structure

Every source file follows this order:

```typescript
// 1. Module-level JSDoc describing the file's purpose and its role in the architecture
/**
 * Claim assertion engine.
 *
 * Responsible for validating, storing, and indexing knowledge claims.
 * Part of the Substrate layer. Called by Orchestration layer system calls.
 *
 * @module claim-store
 * @layer Substrate
 */

// 2. Imports — grouped: external, internal-absolute, internal-relative. Blank line between groups.
import { Database } from 'better-sqlite3';

import { LimenError, ErrorCode } from '@limen/errors';
import type { ClaimId, SubjectUrn } from '@limen/types';

import { validateSubjectUrn } from './validators';

// 3. Types and interfaces — exported types first, then internal types
export interface ClaimAssertionInput { ... }
interface InternalClaimRow { ... }

// 4. Constants
const MAX_OBJECT_VALUE_SIZE = 65_536;

// 5. The main export (class, function, or factory)
export class ClaimStore { ... }

// 6. Internal helper functions (not exported)
function normalizeSubject(subject: SubjectUrn): string { ... }
```

### 1.4 Module Boundaries

Limen has four architectural layers. These are not suggestions — they are invariants.

```
Layer 4: API           (public surface: programmatic API, MCP server, CLI)
Layer 3: Orchestration (system calls, mission/task management, session lifecycle)
Layer 2: Substrate     (claim store, agent registry, audit, encryption, RBAC)
Layer 1: Kernel        (SQLite connection, migration, configuration, lifecycle)
```

**Rules:**
- A layer may only import from the layer directly below it or from shared types/errors
- Layer 1 (Kernel) imports nothing from Limen — it is the foundation
- Layer 4 (API) is the ONLY layer with public exports. Users never touch Layer 1-3 directly
- Cross-layer calls use defined interfaces, not concrete implementations
- Each layer has its own `index.ts` that defines its public surface to the layer above

### 1.5 Function Design

Every function obeys:

1. **Single responsibility.** One function, one thing. If you need `and` to describe it, split it.
2. **Maximum 40 lines.** If a function exceeds 40 lines of logic (excluding JSDoc, type declarations, and blank lines), it must be decomposed. Complexity hides in length.
3. **Maximum 4 parameters.** If a function needs more, use an options object: `assertClaim(input: ClaimAssertionInput)`. The options object gets its own type with JSDoc on every field.
4. **Pure when possible.** Functions that compute should not mutate. Functions that mutate should not compute. Separate queries from commands (CQRS at the function level).
5. **Explicit return types.** Every exported function declares its return type. No inference on public surfaces.
6. **No default exports.** Named exports only. Default exports make refactoring harder and imports less searchable.

### 1.6 Error Handling

Limen uses **structured errors with error codes**, not bare strings. Every error is traceable to a specification requirement.

```typescript
/**
 * Base error class for all Limen errors.
 *
 * Every error carries:
 * - A machine-readable error code (for programmatic handling)
 * - A human-readable message (for developers)
 * - An optional cause (for error chain inspection)
 * - An optional context object (for debugging)
 *
 * @example
 * throw new LimenError(ErrorCode.CLAIM_INVALID_SUBJECT, {
 *   message: 'Subject URN must match pattern entity:<type>:<id>',
 *   context: { received: subject, pattern: 'entity:<type>:<id>' },
 * });
 */
export class LimenError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, options: LimenErrorOptions) { ... }
}
```

**Rules:**
- Every `catch` block either re-throws with context or handles the error explicitly. No empty `catch {}`.
- Error messages include what was expected, what was received, and what to do about it.
- Public API methods document their `@throws` in JSDoc.
- Internal functions that can fail return `Result<T, LimenError>` discriminated unions for expected failures. Exceptions are reserved for programmer errors (invariant violations).
- Error codes are numeric, namespaced by layer:
  - `1xxx`: Kernel errors (database, migration, config)
  - `2xxx`: Substrate errors (claims, agents, audit, RBAC)
  - `3xxx`: Orchestration errors (missions, tasks, sessions, system calls)
  - `4xxx`: API errors (validation, serialization, transport)

**Result Type for Expected Failures:**

```typescript
type Result<T, E = LimenError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// Usage in internal functions
function parseSubjectUrn(raw: string): Result<SubjectUrn> {
  const parts = raw.split(':');
  if (parts.length !== 3 || parts[0] !== 'entity') {
    return {
      ok: false,
      error: new LimenError(ErrorCode.CLAIM_INVALID_SUBJECT, {
        message: `Subject URN must match 'entity:<type>:<id>', received '${raw}'`,
        context: { received: raw },
      }),
    };
  }
  return { ok: true, value: raw as SubjectUrn };
}
```

### 1.7 Comments and Documentation

Code should be self-documenting through naming and structure. Comments explain WHY, not WHAT.

**When to comment:**
- **Why** a non-obvious decision was made: `// WAL mode required for concurrent reads — see ADR-003`
- **Invariant enforcement**: `// INVARIANT: claimId must be unique across all tenants`
- **Performance rationale**: `// Prepared statement reuse: 3x faster than ad-hoc in benchmarks`
- **Security boundary**: `// SECURITY: Input validated at API boundary, trusted from here down`
- **Spec traceability**: `// SPEC: Feature 1.1 — simplified claim assertion`

**When NOT to comment:**
- What the code does (the name should tell you)
- Commented-out code (delete it; git remembers)
- TODO without a ticket number: `// TODO` is banned. Use `// TODO(LIMEN-123): explanation`

---

## Part 2: Type System

### 2.1 Branded Types

Structural typing is TypeScript's default. For domain identifiers, structural typing is dangerous — a `string` that is a `ClaimId` is not the same as a `string` that is a `MissionId`, even though they are both strings.

Limen uses **branded types** to enforce nominal identity at zero runtime cost:

```typescript
/**
 * A unique identifier for a knowledge claim.
 *
 * Branded to prevent accidental interchange with other string identifiers.
 * Created only by the claim store's internal ID generator.
 *
 * @example
 * const id: ClaimId = generateClaimId(); // Only way to create one
 * const bad: ClaimId = 'some-string';    // Compile error
 */
type ClaimId = string & { readonly __brand: unique symbol };

/**
 * A unique identifier for a mission.
 * Branded to prevent interchange with ClaimId, TaskId, or raw strings.
 */
type MissionId = string & { readonly __brand: unique symbol };

/**
 * A subject URN in the format entity:<type>:<id>.
 * Validated at creation time. All downstream code can trust the format.
 */
type SubjectUrn = string & { readonly __brand: unique symbol };

/**
 * A confidence score between 0.0 and 1.0 inclusive.
 * Validated at creation time via refinement.
 */
type Confidence = number & { readonly __brand: unique symbol };
```

**Factory functions** are the only way to create branded values:

```typescript
function createClaimId(raw: string): ClaimId {
  // Validate format (UUID v4)
  if (!UUID_REGEX.test(raw)) {
    throw new LimenError(ErrorCode.INVALID_CLAIM_ID, {
      message: `ClaimId must be a valid UUID v4, received '${raw}'`,
    });
  }
  return raw as ClaimId; // The ONE place 'as' is permitted: inside brand factories
}
```

> **Exception to the zero-`as` rule:** Brand factory functions use `as` exactly once, in the return statement, after validation. This is the ONLY permitted use of `as` in the entire codebase. It is marked with a comment explaining why.

### 2.2 Discriminated Unions

All polymorphic types use discriminated unions with a literal discriminant property.

```typescript
/**
 * The grounding mode determines how a claim's truth is anchored.
 *
 * - evidence_path: Claim is grounded by a chain of evidence references
 * - runtime_witness: Claim was directly observed at runtime
 */
type GroundingMode = 'evidence_path' | 'runtime_witness';

/**
 * Evidence can reference different source types.
 * The 'type' discriminant determines which fields are available.
 */
type EvidenceRef =
  | { readonly type: 'artifact'; readonly artifactId: string; readonly path: string }
  | { readonly type: 'claim'; readonly claimId: ClaimId }
  | { readonly type: 'memory'; readonly taskId: string; readonly key: string }
  | { readonly type: 'capability_result'; readonly capabilityId: string; readonly resultHash: string };
```

**Rules:**
- Exhaustive matching: Every `switch` on a discriminated union includes a `default: never` case that fails at compile time if a variant is unhandled.
- No `else` chains on discriminated unions — use `switch` for exhaustive matching.
- Union variants are `readonly` throughout.

### 2.3 Immutability

Data flows through Limen as immutable structures.

```typescript
// All public-facing types use readonly
interface ClaimAssertion {
  readonly id: ClaimId;
  readonly subject: SubjectUrn;
  readonly predicate: string;
  readonly objectValue: string;
  readonly objectType: ObjectType;
  readonly confidence: Confidence;
  readonly validAt: string;
  readonly groundingMode: GroundingMode;
  readonly status: ClaimStatus;
  readonly createdAt: string;
}

// Arrays use ReadonlyArray<T> or readonly T[]
function queryClaims(filter: ClaimFilter): readonly ClaimAssertion[] { ... }
```

**Rules:**
- All exported interfaces use `readonly` on every property
- Use `ReadonlyArray<T>` or `readonly T[]` for array types
- Use `Readonly<Record<K, V>>` for record types
- Internal mutable state (e.g., database rows being built) is explicitly typed as mutable with a comment explaining why
- `Object.freeze()` is NOT used at runtime — immutability is enforced by the type system, not by runtime overhead

### 2.4 Strict Generics

Generic types include constraints that prevent misuse:

```typescript
// Bad: unconstrained generic
function getById<T>(id: string): T { ... }

// Good: constrained and branded
function getById<T extends StoredEntity>(id: T['id']): T | undefined { ... }
```

### 2.5 Utility Types

Limen defines domain-specific utility types rather than relying on TypeScript's built-in `Partial<T>`, `Pick<T>`, etc. at public API boundaries:

```typescript
/**
 * The fields required to assert a new claim.
 * Distinct from ClaimAssertion (which includes generated fields like id and createdAt).
 */
interface ClaimAssertionInput {
  readonly subject: SubjectUrn;
  readonly predicate: string;
  readonly objectValue: string;
  readonly objectType: ObjectType;
  readonly confidence: Confidence;
  readonly validAt: string;
  readonly groundingMode: GroundingMode;
  readonly evidenceRefs?: readonly EvidenceRef[];
}
```

> `Partial<ClaimAssertion>` would allow omitting `subject` or `predicate`, which makes no domain sense. Explicit input types prevent this.

---

## Part 3: SQL Standards

### 3.1 Prepared Statements Only

Every SQL query in Limen uses prepared statements. No exceptions.

```typescript
// BANNED — string interpolation in SQL
db.exec(`SELECT * FROM claims WHERE subject = '${subject}'`);

// BANNED — template literals in SQL
db.prepare(`SELECT * FROM claims WHERE subject = '${subject}'`).get();

// REQUIRED — parameterized prepared statements
const stmt = db.prepare('SELECT * FROM claims WHERE subject = ?');
const result = stmt.get(subject);
```

**Rules:**
- All prepared statements are created at initialization time and cached on the store instance
- Statement cache uses a `Map<string, Statement>` with descriptive keys
- `db.exec()` is permitted ONLY for DDL (schema changes) and PRAGMA settings — never for data operations
- All data queries use `.prepare()` with `.get()`, `.all()`, or `.run()`

### 3.2 Parameterized Queries

Every dynamic value passes through parameter binding. This is a security invariant, not a style preference.

```typescript
class ClaimStore {
  private readonly stmts: {
    readonly insert: Statement;
    readonly getById: Statement;
    readonly queryBySubject: Statement;
    readonly queryByPredicate: Statement;
    readonly retract: Statement;
  };

  constructor(db: Database) {
    this.stmts = {
      insert: db.prepare(`
        INSERT INTO claim_assertions (
          id, subject, predicate, object_value, object_type,
          confidence, valid_at, grounding_mode, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getById: db.prepare('SELECT * FROM claim_assertions WHERE id = ?'),
      queryBySubject: db.prepare(
        'SELECT * FROM claim_assertions WHERE subject = ? AND status = ?'
      ),
      // ... all statements prepared at construction time
    };
  }
}
```

### 3.3 Transaction Discipline

```typescript
// All multi-statement operations use explicit transactions
const assertClaimWithAudit = db.transaction((input: ClaimAssertionInput) => {
  const id = generateClaimId();
  stmts.insert.run(id, input.subject, /* ... */);
  stmts.insertAudit.run(generateAuditId(), 'CLAIM_ASSERTED', id, /* ... */);
  return id;
});
```

**Rules:**
- Reads that span multiple queries use `BEGIN DEFERRED` (implicit in better-sqlite3 transactions)
- Writes ALWAYS use transactions — even single-statement writes, for consistency
- Transaction functions are named descriptively: `assertClaimWithAudit`, not `doInsert`
- Nested transactions are forbidden — use savepoints if decomposition is needed
- Transaction duration is minimized: compute outside, transact only the writes

### 3.4 Schema Conventions

```sql
-- Table names: snake_case, plural
CREATE TABLE claim_assertions ( ... );

-- Column names: snake_case
-- Primary keys: 'id' (not 'claim_id' in the claims table)
-- Foreign keys: '<referenced_table_singular>_id'
CREATE TABLE claim_relationships (
  id TEXT PRIMARY KEY NOT NULL,
  from_claim_id TEXT NOT NULL REFERENCES claim_assertions(id),
  to_claim_id TEXT NOT NULL REFERENCES claim_assertions(id),
  relationship TEXT NOT NULL CHECK(relationship IN ('supports', 'contradicts', 'supersedes', 'derived_from')),
  created_at TEXT NOT NULL
);

-- Indexes: idx_<table>_<columns>
CREATE INDEX idx_claim_assertions_subject ON claim_assertions(subject);
CREATE INDEX idx_claim_assertions_predicate ON claim_assertions(predicate);
CREATE INDEX idx_claim_assertions_status ON claim_assertions(status);

-- CHECK constraints enforce domain rules at the database level
-- NOT NULL is the default expectation. NULL columns require justification.
```

### 3.5 Migration Discipline

```typescript
// Every migration has an up and a description
// Migrations are numbered sequentially: 001, 002, ...
// Migrations are NEVER modified after release — only new migrations are added
// Every migration is idempotent: running it twice produces the same result
// Destructive migrations (DROP, ALTER DROP COLUMN) require an ADR
```

### 3.6 SQLite Performance Configuration

Applied at database initialization. These are not optional.

```sql
PRAGMA journal_mode = WAL;              -- Write-Ahead Logging for concurrent reads
PRAGMA synchronous = NORMAL;            -- Safe for WAL mode, faster than FULL
PRAGMA cache_size = -64000;             -- 64MB page cache (negative = KB)
PRAGMA foreign_keys = ON;               -- Enforce referential integrity
PRAGMA busy_timeout = 5000;             -- 5 second busy retry (avoids SQLITE_BUSY)
PRAGMA wal_autocheckpoint = 1000;       -- Checkpoint every 1000 pages (optimal)
PRAGMA temp_store = MEMORY;             -- Temp tables in memory
PRAGMA mmap_size = 268435456;           -- 256MB memory-mapped I/O
```

**Rationale for each:**
- WAL: Enables concurrent readers without blocking. Critical for multi-agent scenarios.
- NORMAL sync: SQLite documentation confirms this is safe for WAL mode with only a tiny window of vulnerability on power loss. The audit trail provides recovery.
- 64MB cache: Reduces disk I/O for hot queries. Claim queries are read-heavy.
- Foreign keys: Schema integrity is non-negotiable. Performance cost is negligible with indexes.
- Busy timeout: Prevents `SQLITE_BUSY` errors in multi-agent write contention.
- WAL autocheckpoint at 1000: Benchmarked as optimal balance between write performance and WAL file size.
- Memory-mapped I/O: Significant read performance improvement for databases under 256MB.

---

## Part 4: Security Standards

### 4.1 Threat Model

Limen is a local-first knowledge engine. Its threat model:

| Threat | Severity | Mitigation |
|--------|----------|------------|
| SQL injection via user input | Critical | Prepared statements only (Part 3.1). Zero string interpolation. |
| Claim tampering (silent modification) | Critical | Hash-chained audit trail. SHA-256. Every mutation logged. |
| Unauthorized access to claims | High | RBAC engine. Trust levels. Governance-aware retrieval. |
| Supply chain attack via dependencies | High | Single runtime dependency (better-sqlite3). SBOM. Sigstore provenance. |
| Data exfiltration from SQLite file | High | AES-256-GCM encryption at rest (existing). |
| Denial of service via resource exhaustion | Medium | Token budgets on missions. Query result limits. Timeout enforcement. |
| Cross-tenant data leakage | High | Row-level isolation with tenant ID. Database-level isolation option. |
| Audit trail circumvention | Critical | Hash chain integrity verification. Append-only design. |

### 4.2 Input Validation

Every public API boundary validates every input. No exceptions.

```typescript
/**
 * Validation happens at the API layer (Layer 4) and ONLY at the API layer.
 * Once data passes validation, all downstream layers trust it.
 * This is the "validate at the boundary, trust internally" pattern.
 *
 * Validators return Result<ValidatedInput, ValidationError[]> — they never throw.
 */

function validateRememberInput(input: unknown): Result<RememberInput, ValidationError[]> {
  const errors: ValidationError[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: [{ field: 'input', message: 'Expected an object' }] };
  }

  const { subject, predicate, value, confidence } = input as Record<string, unknown>;

  // Subject URN format: entity:<type>:<id>
  if (typeof subject !== 'string' || !SUBJECT_URN_REGEX.test(subject)) {
    errors.push({
      field: 'subject',
      message: `Must match 'entity:<type>:<id>', received '${String(subject)}'`,
    });
  }

  // Predicate format: <domain>.<property>
  if (typeof predicate !== 'string' || !PREDICATE_REGEX.test(predicate)) {
    errors.push({
      field: 'predicate',
      message: `Must match '<domain>.<property>', received '${String(predicate)}'`,
    });
  }

  // Value: non-empty string, bounded size
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({ field: 'value', message: 'Must be a non-empty string' });
  } else if (value.length > MAX_OBJECT_VALUE_SIZE) {
    errors.push({
      field: 'value',
      message: `Must be <= ${MAX_OBJECT_VALUE_SIZE} chars, received ${value.length}`,
    });
  }

  // Confidence: optional, 0.0-1.0
  if (confidence !== undefined) {
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1 || !Number.isFinite(confidence)) {
      errors.push({
        field: 'confidence',
        message: `Must be a finite number between 0.0 and 1.0, received '${String(confidence)}'`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };

  return {
    ok: true,
    value: {
      subject: subject as SubjectUrn,
      predicate: predicate as string,
      value: value as string,
      confidence: (confidence ?? DEFAULT_CONFIDENCE) as Confidence,
    },
  };
}
```

### 4.3 Cryptographic Standards

| Operation | Algorithm | Key Management |
|-----------|-----------|----------------|
| Claim data encryption at rest | AES-256-GCM | User-provided key, never stored in database |
| Audit trail hash chain | SHA-256 | No key — integrity chain, not encryption |
| Provenance fingerprint | SHA-3-256 + Ed25519 | Signing key in `~/.solishq/provenance.key` |
| Future: Claim signing | Ed25519 | Per-agent keypair (when implemented) |

**Rules:**
- Use Node.js `crypto` module exclusively. No third-party crypto libraries.
- No custom cryptographic constructions. Use standard algorithms only.
- Keys are never logged, never serialized to JSON, never included in error messages.
- Random values use `crypto.randomUUID()` for IDs and `crypto.randomBytes()` for keys.
- Deprecated algorithms (MD5, SHA-1, DES, RC4) are banned.

### 4.4 Audit Trail Integrity

The hash-chained audit trail is Limen's tamper-evidence mechanism.

```
Record N: { data, hash: SHA-256(data + hash_of_record_N-1) }
Record N+1: { data, hash: SHA-256(data + hash_of_record_N) }
```

**Verification:** Walk the chain from genesis. Recompute each hash. If any hash mismatches, tampering has occurred between that record and the previous one. The chain is append-only — there is no update or delete operation on audit records.

**Integrity check:** `limen.audit.verify()` walks the full chain and returns a verification result with the first broken link (if any), total records verified, and verification time.

### 4.5 Supply Chain Security

| Measure | Implementation |
|---------|---------------|
| Single runtime dependency | `better-sqlite3` only. No lodash, no moment, no axios. |
| SBOM generation | `npm sbom` or CycloneDX at build time. Published with every release. |
| Sigstore provenance | npm publish with `--provenance` flag. Attestation on every package. |
| Dependency audit | `npm audit` in CI. Zero known vulnerabilities on release. |
| Lock file integrity | `package-lock.json` committed and verified. `npm ci` in CI, never `npm install`. |
| License compliance | All dependencies must be Apache 2.0, MIT, BSD, or ISC compatible. |
| Security policy | `SECURITY.md` with disclosure process, response SLA, supported versions. |

### 4.6 Secret Management

- No secrets in source code. No API keys, no database passwords, no encryption keys.
- Environment variables for configuration. Validated at startup with clear error messages.
- `.env` files in `.gitignore`. `.env.example` committed with placeholder values.
- Encryption keys accepted as function parameters or environment variables, never as config file values.

---

## Part 5: Performance Standards

### 5.1 Benchmark Targets

Every performance-critical operation has a target. If a change regresses beyond the target, CI fails.

| Operation | Target (p50) | Target (p99) | Measurement Method |
|-----------|-------------|-------------|-------------------|
| `remember()` — single claim assertion | < 5ms | < 15ms | Benchmark suite, SQLite WAL, warm cache |
| `recall()` — single subject, 10 claims | < 3ms | < 10ms | Benchmark suite, prepared statement |
| `search()` — FTS5 query, 1000 claims | < 20ms | < 50ms | Benchmark suite, indexed |
| `connect()` — create relationship | < 3ms | < 10ms | Benchmark suite, transactional |
| `forget()` — retract with audit | < 5ms | < 15ms | Benchmark suite, transactional |
| `reflect()` — batch 10 learnings | < 30ms | < 80ms | Benchmark suite, transactional batch |
| Startup (cold, empty database) | < 100ms | < 250ms | Real-world measurement, includes migration check |
| Startup (warm, 10K claims) | < 200ms | < 500ms | Real-world measurement |
| Audit trail verification (1K records) | < 500ms | < 1500ms | Sequential hash chain walk |

### 5.2 Benchmark Infrastructure

```typescript
// benchmarks/claim-operations.bench.ts
import { bench, group, run } from 'mitata'; // or tinybench

group('remember()', () => {
  bench('single claim', () => {
    limen.remember('entity:test:bench', 'bench.value', 'test-value');
  });

  bench('batch 100 claims', () => {
    limen.reflect(hundredLearnings);
  });
});

group('recall()', () => {
  bench('single subject, 10 claims', () => {
    limen.recall('entity:test:populated');
  });

  bench('wildcard predicate, 100 claims', () => {
    limen.recall('entity:test:large', { predicate: 'bench.*' });
  });
});
```

**Rules:**
- Benchmarks run in CI on every PR that touches performance-critical paths
- Results are compared against the baseline (last release)
- Regressions > 20% on any target fail the build
- Benchmark database is pre-seeded with realistic data volumes (1K, 10K, 100K claims)
- Benchmarks measure cold start AND warm path separately

### 5.3 Performance Patterns

**Prepared Statement Reuse:**
```typescript
// Statements prepared once at construction, reused for every call
// better-sqlite3 benchmarks show 3x improvement over ad-hoc
private readonly getBySubject = this.db.prepare(
  'SELECT * FROM claim_assertions WHERE subject = ? AND status = ?'
);
```

**Batch Operations via Transactions:**
```typescript
// Individual inserts: ~500/second
// Transactional batch: ~50,000/second (100x improvement)
const batchInsert = this.db.transaction((claims: ClaimInput[]) => {
  for (const claim of claims) {
    this.stmts.insert.run(/* ... */);
  }
});
```

**Lazy Initialization for Cold Paths:**
```typescript
// FTS5 index rebuilt only when requested, not on startup
private ftsIndex?: FtsIndex;

private getFtsIndex(): FtsIndex {
  if (!this.ftsIndex) {
    this.ftsIndex = new FtsIndex(this.db);
  }
  return this.ftsIndex;
}
```

**Memory-Conscious Query Results:**
```typescript
// For large result sets, use iterate() instead of all()
// all() materializes the entire result set in memory
// iterate() yields rows one at a time
function* iterateClaims(filter: ClaimFilter): Generator<ClaimAssertion> {
  for (const row of this.stmts.queryAll.iterate(filter.subject)) {
    yield mapRowToAssertion(row);
  }
}
```

### 5.4 Memory Budget

| Context | Memory Target |
|---------|--------------|
| Idle Limen instance (no active queries) | < 20MB RSS |
| Active instance, 10K claims loaded | < 50MB RSS |
| Active instance, 100K claims loaded | < 80MB RSS (SQLite mmap handles disk paging) |
| Peak during batch import (10K claims) | < 150MB RSS |

**Rules:**
- No unbounded arrays. All query results have configurable `limit` with a default.
- Streaming/iterator patterns for large result sets.
- SQLite's memory-mapped I/O handles large databases without loading everything into JS heap.
- V8 heap snapshots taken in CI for memory regression detection.

---

## Part 6: Testing Standards

### 6.1 Testing Philosophy

Limen follows the SQLite testing philosophy: tests are not an afterthought — they ARE the product. The test suite is the executable specification. If a behavior is not tested, it is not guaranteed.

### 6.2 Test Types

| Type | Tool | Purpose | Coverage Target |
|------|------|---------|----------------|
| **Unit tests** | Vitest | Individual functions, pure logic | 100% of public API surface |
| **Integration tests** | Vitest | Cross-layer interactions, database round-trips | 100% of system calls |
| **Property-based tests** | fast-check | Invariant verification across random inputs | All domain invariants |
| **Mutation tests** | Stryker | Test quality verification | > 80% mutation score |
| **Fuzz tests** | fast-check + custom | Security boundary testing | All input validators |
| **Performance regression** | tinybench + CI | Detect performance regressions | All benchmark targets |
| **Chaos tests** | Custom harness | Failure recovery, data integrity | Database corruption, OOM, I/O errors |
| **Platform tests** | CI matrix | Cross-platform compatibility | Node 18+, macOS, Linux, Windows |

### 6.3 Unit Testing Standards

```typescript
describe('ClaimStore.assertClaim()', () => {
  // Test names follow: "should <expected behavior> when <condition>"
  it('should create a claim with generated UUID when valid input provided', () => { ... });
  it('should reject subject URN without entity prefix', () => { ... });
  it('should enforce maximum object value size', () => { ... });
  it('should set default confidence to 0.8 when not specified', () => { ... });
  it('should write audit record in same transaction as claim', () => { ... });

  // Edge cases are explicit, not hidden in other tests
  it('should handle Unicode in object values correctly', () => { ... });
  it('should handle empty string predicate property segment', () => { ... });
  it('should handle maximum-length subject URN', () => { ... });
});
```

**Rules:**
- Every public API method has its own `describe` block
- Every test tests one behavior
- No test depends on another test's state (tests are isolated)
- Test databases are created fresh per test suite, not per test (for speed), with cleanup between tests
- No mocking of the database. Tests hit real SQLite. This IS the integration.
- Test data uses realistic values, not `"foo"` and `"bar"`
- Assertion messages explain what went wrong: `expect(result.ok).toBe(true, 'Claim assertion should succeed for valid input')`

### 6.4 Property-Based Testing

```typescript
import { fc } from 'fast-check';

describe('SubjectUrn invariants', () => {
  it('should round-trip through parse and serialize', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-z][a-z0-9_]{0,30}$/),  // type
          fc.stringMatching(/^[a-zA-Z0-9_-]{1,100}$/)     // id
        ),
        ([type, id]) => {
          const urn = `entity:${type}:${id}`;
          const parsed = parseSubjectUrn(urn);
          expect(parsed.ok).toBe(true);
          if (parsed.ok) {
            expect(serializeSubjectUrn(parsed.value)).toBe(urn);
          }
        }
      )
    );
  });

  it('should reject all non-conforming URNs', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !s.startsWith('entity:')),
        (invalidUrn) => {
          const result = parseSubjectUrn(invalidUrn);
          expect(result.ok).toBe(false);
        }
      )
    );
  });
});
```

**Invariants to test with property-based testing:**
- Claim IDs are unique across all assertions (no collisions)
- Confidence scores always remain in [0.0, 1.0]
- Subject URNs round-trip through parse/serialize
- Audit trail hash chain is always valid after any sequence of operations
- Retracted claims never appear in active queries
- RBAC never permits access beyond the agent's trust level
- Transaction atomicity: claim + audit are always committed together or not at all

### 6.5 Mutation Testing

```json
// stryker.conf.json
{
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.bench.ts"],
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "reporters": ["html", "clear-text", "dashboard"],
  "thresholds": {
    "high": 90,
    "low": 80,
    "break": 75
  }
}
```

**Rules:**
- Mutation score below 75% fails the build
- Security-critical paths (validators, RBAC, audit) must achieve > 90% mutation score
- Review surviving mutants monthly — each one is either a missing test or an unnecessary branch
- Incremental mode in CI for speed: only mutate changed files

### 6.6 Fuzz Testing

```typescript
describe('Input validator fuzzing', () => {
  it('should never crash on arbitrary string input to remember()', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        // The validator must NEVER throw — it must return Result
        const result = validateRememberInput(input);
        expect(result).toHaveProperty('ok');
        // Either ok:true with valid data, or ok:false with error array
        if (result.ok) {
          expect(result.value.subject).toBeTruthy();
        } else {
          expect(Array.isArray(result.error)).toBe(true);
          expect(result.error.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 10_000 }
    );
  });
});
```

**Fuzz targets:**
- All public API input validators
- SQL query builders (should never produce malformed SQL)
- URN parsers
- JSON payload deserializers
- Configuration loaders

### 6.7 Chaos Testing

Inspired by SQLite's OOM injection, I/O error simulation, and crash recovery tests.

```typescript
describe('Chaos: database corruption recovery', () => {
  it('should detect hash chain tampering after direct row modification', async () => {
    // 1. Create 100 claims with audit trail
    // 2. Directly modify a row in SQLite (simulating tampering)
    // 3. Run audit.verify()
    // 4. Verify it detects the broken link
  });

  it('should maintain data integrity after process kill during transaction', async () => {
    // 1. Begin a multi-claim transaction
    // 2. Kill the process mid-write (simulated via WAL manipulation)
    // 3. Reopen the database
    // 4. Verify: either all claims exist or none do
    // 5. Verify: audit trail is consistent
  });

  it('should handle database file becoming read-only during operation', async () => {
    // 1. Create a working instance
    // 2. Change file permissions to read-only
    // 3. Attempt a write operation
    // 4. Verify: meaningful error returned, no data corruption
    // 5. Restore permissions, verify normal operation resumes
  });
});
```

**Chaos scenarios to implement:**
- Database file deletion during operation
- Disk full during write
- Concurrent write contention (100 parallel operations)
- WAL file corruption
- Configuration file missing or malformed
- System clock regression (time going backward)
- Maximum database size reached

### 6.8 Coverage Requirements

| Category | Branch Coverage | Mutation Score |
|----------|----------------|---------------|
| Kernel (database, migration) | >= 95% | >= 80% |
| Substrate (claims, agents, audit, RBAC) | >= 98% | >= 85% |
| Orchestration (system calls, sessions) | >= 95% | >= 80% |
| API (validators, serializers) | >= 98% | >= 90% |
| Security-critical paths | 100% | >= 90% |

**Security-critical paths requiring 100% branch coverage:**
- Input validators (all of them)
- RBAC authorization checks
- Audit trail hash chain operations
- Encryption/decryption
- Trust level evaluation
- Claim retraction (must always audit)

### 6.9 CI Pipeline

```yaml
# Abbreviated — full pipeline
test:
  - lint (eslint, strict config)
  - typecheck (tsc --noEmit)
  - unit + integration (vitest)
  - coverage check (branch coverage thresholds)
  - mutation testing (stryker, security paths)
  - fuzz testing (fast-check, 10K runs per target)
  - benchmark regression (compare against baseline)
  - platform matrix (Node 18, 20, 22 x macOS, Linux, Windows)
  - dependency audit (npm audit --audit-level=moderate)
  - license check (all deps Apache/MIT/BSD/ISC compatible)
```

---

## Part 7: Documentation Standards

### 7.1 JSDoc Requirements

Every exported symbol has JSDoc. No exceptions.

```typescript
/**
 * Assert a knowledge claim with evidence grounding.
 *
 * Creates a new knowledge claim in the Limen store with the specified
 * subject, predicate, and value. The claim is automatically audited
 * and indexed for full-text search.
 *
 * @param subject - Subject URN in format `entity:<type>:<id>`.
 *   Examples: `entity:user:alice`, `entity:project:atlas`
 * @param predicate - Predicate in format `<domain>.<property>`.
 *   Examples: `preference.cuisine`, `decision.database`
 * @param value - The claim value as a string. Maximum 65,536 characters.
 * @param options - Optional configuration for the claim.
 * @param options.confidence - Confidence score between 0.0 and 1.0. Default: 0.8.
 * @param options.validAt - ISO 8601 timestamp for temporal anchor. Default: now.
 *
 * @returns The created claim with its generated ID and metadata.
 *
 * @throws {LimenError} With code `CLAIM_INVALID_SUBJECT` if subject URN is malformed.
 * @throws {LimenError} With code `CLAIM_INVALID_PREDICATE` if predicate format is invalid.
 * @throws {LimenError} With code `CLAIM_VALUE_TOO_LARGE` if value exceeds size limit.
 *
 * @example Basic usage
 * ```typescript
 * const claim = await limen.remember(
 *   'entity:user:alice',
 *   'preference.cuisine',
 *   'loves Thai food'
 * );
 * console.log(claim.id);         // 'a1b2c3d4-...'
 * console.log(claim.confidence); // 0.8
 * ```
 *
 * @example With options
 * ```typescript
 * const claim = await limen.remember(
 *   'entity:project:atlas',
 *   'decision.database',
 *   'chose PostgreSQL for production',
 *   { confidence: 0.95, validAt: '2026-03-15T10:00:00Z' }
 * );
 * ```
 *
 * @see {@link recall} for retrieving stored claims
 * @see {@link forget} for retracting claims with audit trail
 *
 * @since 2.0.0
 */
async remember(
  subject: string,
  predicate: string,
  value: string,
  options?: RememberOptions
): Promise<ClaimSummary> { ... }
```

**JSDoc rules:**
- Description: What it does, in one sentence. Then why you would use it, if non-obvious.
- `@param`: Every parameter, with type constraint and examples.
- `@returns`: What is returned and its structure.
- `@throws`: Every error that can be thrown, with the error code and condition.
- `@example`: At least one basic example. Two for complex APIs (basic + advanced).
- `@since`: Version when the API was introduced.
- `@see`: Links to related APIs.
- `@deprecated`: If applicable, with migration path.

### 7.2 README Structure

```markdown
# Limen -- Knowledge Engine for AI Agents

[One-line description: what it does]
[One-line value prop: why you would choose it]

## Quickstart (3 lines of code, works immediately)

## Features (bulleted, linked to detailed docs)

## Comparison (table vs Mem0, Zep, Cognee -- honest, specific)

## Installation

## Core API
  - remember() / recall() / search()
  - connect() / forget() / reflect()

## Advanced Features
  - Governance & RBAC
  - Audit Trail
  - Temporal Queries
  - Knowledge Graph
  - Semantic Search

## Architecture (for contributors -- brief, links to ARCHITECTURE.md)

## Performance (benchmarks, with numbers)

## Security (brief, links to SECURITY.md)

## Contributing

## License
```

**README rules:**
- Gets someone productive in 3 minutes or less
- Every code example is tested (extracted and run in CI)
- No broken links
- No stale version numbers
- Updated on every release

### 7.3 Architecture Documentation

`ARCHITECTURE.md` at root:

```markdown
# Architecture

## Layer Diagram (ASCII art -- no images that can't be diffed)

## Layer Responsibilities (one paragraph each)

## Data Flow (how a remember() call flows through all 4 layers)

## Key Design Decisions (links to ADRs)

## Module Map (which files are in which layer)
```

### 7.4 Architecture Decision Records (ADRs)

Every non-obvious architectural decision is recorded in `docs/adr/`.

```markdown
# ADR-001: Single SQLite File Architecture

## Status: Accepted

## Context
Limen needs a storage backend for claims, agents, missions, and audit trails.
Competitors use PostgreSQL, Neo4j, Redis, and vector databases in combination.

## Decision
Use a single SQLite database file with WAL mode for all storage.

## Consequences
### Positive
- Zero infrastructure: no database server to install, configure, or maintain
- Single-file portability: backup is file copy
- WAL mode enables concurrent reads without locking
- Proven at scale: SQLite handles terabytes in production

### Negative
- No built-in replication (acceptable for local-first design)
- Write concurrency limited to one writer at a time (WAL mitigates read contention)
- Native module dependency (better-sqlite3) complicates some deployment targets

### Alternatives Rejected
- PostgreSQL: requires server, breaks zero-config promise
- LevelDB: no SQL, limited query flexibility
- In-memory only: no persistence

## Date: 2025-xx-xx
```

**ADR rules:**
- One decision per ADR
- Immutable after acceptance (superseded by new ADRs, never edited)
- Include rejected alternatives with rationale
- Numbered sequentially

### 7.5 TypeDoc Configuration

```json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs/api",
  "plugin": ["typedoc-plugin-markdown"],
  "readme": "none",
  "excludePrivate": true,
  "excludeInternal": true,
  "includeVersion": true,
  "categorizeByGroup": true,
  "sort": ["source-order"]
}
```

**Rules:**
- API reference generated on every release
- Published to GitHub Pages
- Internal symbols (`@internal` tag) excluded from public docs
- Source order preserved (not alphabetical) for narrative flow

### 7.6 Code Examples

```
examples/
  01-quickstart.ts           -- 3-line remember/recall
  02-search.ts               -- FTS5 full-text search
  03-knowledge-graph.ts      -- connect, traverse, explain
  04-sessions.ts             -- session lifecycle
  05-governance.ts           -- RBAC and trust levels
  06-temporal.ts             -- time-aware queries
  07-auto-extraction.ts      -- LLM-powered knowledge extraction
  08-conflict-detection.ts   -- contradiction management
  09-batch-operations.ts     -- bulk remember/reflect
  10-mcp-server.ts           -- MCP integration for Claude Code
  11-health-monitoring.ts    -- knowledge health score
  12-import-export.ts        -- data portability
```

**Example rules:**
- Every example is a complete, runnable TypeScript file
- Every example has a file-level comment explaining what it demonstrates
- Examples are tested in CI (they must compile and run)
- Examples use realistic data, not placeholder values
- Examples are ordered by complexity (quickstart first)

---

## Part 8: Portability Standards

### 8.1 Platform Support Matrix

| Platform | Runtime | Architecture | Status |
|----------|---------|-------------|--------|
| macOS | Node.js 18, 20, 22 | x64, arm64 (Apple Silicon) | Tier 1 (fully tested) |
| Linux | Node.js 18, 20, 22 | x64, arm64 | Tier 1 (fully tested) |
| Windows | Node.js 18, 20, 22 | x64 | Tier 1 (fully tested) |
| Linux | Bun | x64, arm64 | Tier 2 (tested, best-effort) |
| Linux | Deno | x64 | Tier 2 (tested, best-effort) |
| Browser | WASM (sql.js/sqlite-wasm) | -- | Tier 3 (future, architectural prep) |
| Cloudflare Workers | WASM | -- | Tier 3 (future, architectural prep) |

### 8.2 Package Exports

```json
{
  "name": "limen-ai",
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/esm/index.d.ts",
        "default": "./dist/esm/index.js"
      },
      "require": {
        "types": "./dist/cjs/index.d.cts",
        "default": "./dist/cjs/index.cjs"
      }
    },
    "./mcp": {
      "import": {
        "types": "./dist/esm/mcp/index.d.ts",
        "default": "./dist/esm/mcp/index.js"
      }
    }
  },
  "main": "./dist/cjs/index.cjs",
  "module": "./dist/esm/index.js",
  "types": "./dist/esm/index.d.ts",
  "files": ["dist", "prebuilds", "README.md", "LICENSE", "SECURITY.md"]
}
```

**Rules:**
- ESM-first, CJS as courtesy export
- Every export condition includes a `types` entry (TypeScript resolution)
- `"type": "module"` in package.json
- CJS files use `.cjs` extension for unambiguous resolution
- No `__dirname`, `__filename`, or `require()` in source — use `import.meta.url` patterns
- Build tool: `tsup` (esbuild-powered, handles dual output)

### 8.3 Native Module Strategy

`better-sqlite3` is a native Node.js addon. This creates a portability challenge.

**Strategy: Prebuildify**

```json
// Prebuilt binaries shipped inside the npm package
// No compilation required at install time for supported platforms
{
  "scripts": {
    "prebuild": "prebuildify --napi --strip --target 18.0.0 --target 20.0.0 --target 22.0.0"
  }
}
```

**Cross-platform builds via CI:**
```yaml
# GitHub Actions matrix
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    arch: [x64, arm64]
    node: [18, 20, 22]
    exclude:
      - os: windows-latest
        arch: arm64  # Windows ARM64 Node.js not mainstream
```

**Fallback:** If no prebuild exists for the target platform, `better-sqlite3` compiles from source at install time. This requires a C++ toolchain but is the standard fallback behavior.

### 8.4 Platform Abstraction Layer

For future portability (browser WASM, Cloudflare Workers), Limen's core must not directly depend on Node.js APIs.

```typescript
/**
 * Platform abstraction interface.
 * Limen's core logic programs against this interface, not against Node.js APIs.
 * Different platform backends implement it for their environment.
 */
interface LimenPlatform {
  /** Open or create a SQLite database */
  openDatabase(path: string, options?: DatabaseOptions): LimenDatabase;

  /** Generate a cryptographically random UUID */
  randomUUID(): string;

  /** Compute SHA-256 hash of input */
  sha256(input: Uint8Array): Uint8Array;

  /** AES-256-GCM encrypt */
  encrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedPayload;

  /** AES-256-GCM decrypt */
  decrypt(encrypted: EncryptedPayload, key: Uint8Array): Uint8Array;

  /** Current timestamp in ISO 8601 */
  now(): string;

  /** Read environment variable */
  env(key: string): string | undefined;
}

// Node.js implementation (current)
class NodePlatform implements LimenPlatform { ... }

// Future: WASM implementation
// class WasmPlatform implements LimenPlatform { ... }
```

**Rules:**
- Core logic (claim store, RBAC, audit) uses `LimenPlatform`, not `crypto`, `fs`, or `process`
- Platform-specific code lives in `src/platforms/node/`, `src/platforms/wasm/` (future)
- The platform is injected at initialization: `createLimen({ platform: new NodePlatform() })`
- Default platform is auto-detected based on environment

### 8.5 Build Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**Critical flags:**
- `noUncheckedIndexedAccess`: Array/object index access returns `T | undefined`, not `T`. Prevents null reference errors on dynamic access.
- `exactOptionalPropertyTypes`: Distinguishes between `undefined` and "not present." `{ x?: string }` means `x` can be absent, but cannot be explicitly `undefined`.
- `noPropertyAccessFromIndexSignature`: Forces bracket notation for dynamic keys, making it obvious when you are accessing untrusted data.

---

## Part 9: Operational Standards

### 9.1 Versioning

Semantic Versioning 2.0.0, strictly.

- **MAJOR**: Breaking changes to the public API (type signature changes, removed methods, behavioral changes that break existing consumers)
- **MINOR**: New features, new API methods, new optional parameters
- **PATCH**: Bug fixes, performance improvements, documentation updates

**Pre-release:** `2.0.0-alpha.1`, `2.0.0-beta.1`, `2.0.0-rc.1`

**Rules:**
- The CHANGELOG is updated on every release with: Added, Changed, Deprecated, Removed, Fixed, Security sections
- Breaking changes require a migration guide
- Deprecated APIs remain for at least one minor version with `@deprecated` JSDoc and console warnings

### 9.2 Release Checklist

Inspired by SQLite's 200-item release checklist:

```markdown
## Pre-Release
- [ ] All tests pass on all Tier 1 platforms
- [ ] Branch coverage meets thresholds
- [ ] Mutation score meets thresholds
- [ ] Benchmark regression check passes
- [ ] No npm audit vulnerabilities at moderate or above
- [ ] CHANGELOG updated
- [ ] Version bumped in package.json
- [ ] API docs regenerated
- [ ] All README examples tested and pass
- [ ] SBOM generated
- [ ] Migration guide written (if breaking changes)

## Release
- [ ] npm publish --provenance
- [ ] Git tag created and pushed
- [ ] GitHub Release created with notes
- [ ] API docs published to GitHub Pages
- [ ] SBOM attached to GitHub Release

## Post-Release
- [ ] Smoke test: fresh npm install + quickstart example on macOS, Linux, Windows
- [ ] Dependent packages (ConvOps Core) compatibility verified
- [ ] Announce in appropriate channels
```

### 9.3 Monitoring and Observability

Limen is a library, not a service. But it provides observability hooks for consumers:

```typescript
interface LimenMetrics {
  /** Total claims asserted since startup */
  claimsAsserted: number;
  /** Total claims queried since startup */
  claimsQueried: number;
  /** Total claims retracted since startup */
  claimsRetracted: number;
  /** Database file size in bytes */
  databaseSizeBytes: number;
  /** WAL file size in bytes */
  walSizeBytes: number;
  /** Average query latency (rolling window) */
  avgQueryLatencyMs: number;
  /** Peak query latency */
  peakQueryLatencyMs: number;
  /** Uptime in milliseconds */
  uptimeMs: number;
}
```

### 9.4 Error Reporting

Every error includes enough context to diagnose without reproducing:

```typescript
// Bad
throw new Error('Failed to assert claim');

// Good
throw new LimenError(ErrorCode.CLAIM_ASSERTION_FAILED, {
  message: 'Failed to assert claim: unique constraint violation on subject+predicate',
  context: {
    subject: 'entity:user:alice',
    predicate: 'preference.cuisine',
    existingClaimId: 'a1b2c3...',
    attemptedValue: 'loves Thai food',
    sqliteError: 'UNIQUE constraint failed: claim_assertions.subject, claim_assertions.predicate',
  },
});
```

---

## Part 10: Engineering Culture Standards

### 10.1 Code Review Checklist

Every PR is reviewed against:

- [ ] Does every function do one thing?
- [ ] Does every name tell you what it does without reading the body?
- [ ] Is every error path handled with a meaningful message?
- [ ] Is every invariant enforced by the type system, not by runtime checks?
- [ ] Are there any `any`, `as`, `!`, or `@ts-ignore`?
- [ ] Does every public API have JSDoc with examples?
- [ ] Are SQL queries parameterized?
- [ ] Is the audit trail updated for state changes?
- [ ] Are tests included for every new behavior?
- [ ] Do benchmarks pass (if touching performance-critical paths)?
- [ ] Is the change traceable to a spec requirement or ADR?

### 10.2 The Craftsmanship Standard

This is not a list of rules. This is a philosophy.

When you write Limen code, you are writing code that stores what AI agents know. A bug in Limen does not cause a 500 error — it causes an agent to remember something that is not true, or to forget something that matters, or to act on knowledge it should not have access to. The consequences are epistemic, not operational.

Every line of code is an opportunity to teach. When a developer reads Limen's source on GitHub, they should learn:
- How to structure a TypeScript project for serious infrastructure
- How to use the type system to prevent bugs at compile time
- How to write SQL that is both safe and fast
- How to build an audit trail that cannot be tampered with
- How to design APIs that are simple to use and impossible to misuse

That is the bar. Not "it works." Not "it's clean." It teaches.

### 10.3 The SQLite Standard

SQLite is the gold standard for engineered software. These specific practices are adopted from SQLite's methodology:

1. **590:1 test-to-source ratio aspiration.** We will not achieve this on day one. But every release moves the ratio upward.
2. **100% branch coverage on security-critical paths.** Non-negotiable.
3. **Assert statements for invariants.** Preconditions, postconditions, loop invariants — assert them all. In development mode, assertions are active. In production, they are compiled out.
4. **Multiple independent test harnesses.** Unit tests (Vitest), property tests (fast-check), mutation tests (Stryker), fuzz tests — each catches different classes of bugs.
5. **Defensive code markers.** Code that exists for defense-in-depth (should-never-happen branches) is explicitly marked with comments: `// DEFENSIVE: This branch should be unreachable. If hit, the caller violated the precondition.`
6. **OOM and I/O error simulation.** Not yet implemented, but the chaos testing framework will simulate these failures.
7. **Cross-platform testing matrix.** Every release tested on macOS, Linux, and Windows across supported Node.js versions.

---

## Appendix A: ESLint Configuration Summary

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-assertions": ["error", { "assertionStyle": "never" }],
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/ban-ts-comment": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/explicit-function-return-type": ["error", { "allowExpressions": true }],
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/strict-boolean-expressions": "error",
    "no-console": "error",
    "no-debugger": "error",
    "eqeqeq": ["error", "always"],
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "import/no-cycle": "error",
    "import/no-default-export": "error"
  }
}
```

## Appendix B: tsconfig Strict Settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **Branded Type** | A TypeScript type with a phantom property that prevents structural equivalence with the underlying primitive. Zero runtime cost. |
| **Discriminated Union** | A union type where each variant has a literal property (the discriminant) that TypeScript uses for exhaustive narrowing. |
| **MC/DC** | Modified Condition/Decision Coverage — every condition in a decision independently affects the decision outcome. Stricter than branch coverage. |
| **WAL** | Write-Ahead Logging — SQLite journal mode that writes changes to a separate log before applying to the database. Enables concurrent readers. |
| **SBOM** | Software Bill of Materials — a machine-readable inventory of all components and dependencies in a software package. |
| **Sigstore** | An open-source project for keyless cryptographic signing and verification of software artifacts. Used by npm for package provenance. |
| **FTS5** | Full-Text Search version 5 — SQLite's built-in full-text search engine. Tokenizes text and supports ranked queries. |
| **ADR** | Architecture Decision Record — a document that captures a significant architectural decision, its context, and consequences. |
| **Result Type** | A discriminated union of `{ ok: true, value: T }` and `{ ok: false, error: E }` used for explicit error handling without exceptions. |
| **Chaos Testing** | Deliberately injecting failures (disk errors, OOM, corruption) into a system to verify it recovers correctly. |
| **Mutation Testing** | Systematically modifying source code (mutating) and running tests to verify the test suite detects the changes. |
| **Property-Based Testing** | Testing invariants across randomly generated inputs rather than specific examples. |
| **Prebuildify** | A tool that ships precompiled native module binaries inside the npm package, eliminating compilation at install time. |

---

## Appendix D: Research Sources

This specification was derived from research across 30+ sources, cross-referenced for accuracy.

### Code Excellence
- [TypeScript at Scale in 2026 (LogRocket)](https://blog.logrocket.com/typescript-at-scale-2026/)
- [Modern TypeScript Patterns (Sachith, March 2026)](https://www.sachith.co.uk/modern-typescript-patterns-practical-guide-mar-9-2026/)
- [Four Essential TypeScript Patterns (Total TypeScript)](https://www.totaltypescript.com/four-essential-typescript-patterns)
- [Branded Types (Effect Documentation)](https://effect.website/docs/code-style/branded-types/)
- [Effect-TS in 2026 (DEV Community)](https://dev.to/ottoaria/effect-ts-in-2026-functional-programming-for-typescript-that-actually-makes-sense-1go)
- [Code Beauty (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0164121225001621)

### Testing Excellence
- [How SQLite Is Tested (sqlite.org)](https://sqlite.org/testing.html) -- The gold standard: 590:1 test-to-source ratio, 100% MC/DC, OOM injection, crash simulation, 6,754 assert statements
- [SQLite Quality Management Plan (sqlite.org)](https://sqlite.org/qmplan.html)
- [fast-check (Property-Based Testing)](https://fast-check.dev/)
- [Stryker Mutator (Mutation Testing)](https://stryker-mutator.io/)

### Security
- [OWASP Secure Coding Practices 2026 (AppSecMaster)](https://www.appsecmaster.net/blog/owasp-secure-coding-practices-building-bulletproof-software-in-2026/)
- [OWASP Secure Coding Quick Reference Guide](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [Hash Chains Explained (Hyrelog)](https://www.hyrelog.com/blog/hash-chains-explained)
- [npm + Sigstore (Chainguard)](https://www.chainguard.dev/unchained/npm-sigstore-making-javascript-secure-by-default)
- [Sigstore Support in npm (Sigstore Blog)](https://blog.sigstore.dev/npm-public-beta/)
- [JavaScript Secure Coding Practices (Checkmarx)](https://github.com/Checkmarx/JS-SCP)

### Performance
- [SQLite Performance Optimization Guide 2026 (Forward Email)](https://forwardemail.net/en/blog/docs/sqlite-performance-optimization-pragma-chacha20-production-guide)
- [better-sqlite3 Performance (GitHub)](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)
- [Scaling SQLite with Worker Threads (DEV Community)](https://dev.to/lovestaco/scaling-sqlite-with-node-worker-threads-and-better-sqlite3-4189)

### Portability
- [Dual ESM+CJS Packages (Mayank)](https://mayank.co/blog/dual-packages/)
- [Ship ESM & CJS in One Package (Anthony Fu)](https://antfu.me/posts/publish-esm-and-cjs)
- [prebuildify (GitHub)](https://github.com/prebuild/prebuildify)
- [SQLite WASM (sqlite.org)](https://sqlite.org/wasm)
- [SQLite Persistence on the Web (PowerSync, Nov 2025)](https://www.powersync.com/blog/sqlite-persistence-on-the-web)

### Documentation
- [TypeDoc (GitHub)](https://github.com/TypeStrong/typedoc)
- [Generating Documentation for TypeScript (Cloudflare)](https://blog.cloudflare.com/generating-documentation-for-typescript-projects/)
- [ADR Best Practices (AWS Architecture Blog)](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)

### Reliability
- [Chaos Engineering (Google Cloud Blog)](https://cloud.google.com/blog/products/devops-sre/getting-started-with-chaos-engineering)
- [Fault Injection vs Chaos Engineering (Azure)](https://azure.microsoft.com/en-us/blog/advancing-resilience-through-chaos-engineering-and-fault-injection/)

---

*This specification is a living document. It evolves as Limen evolves. But the principles are permanent: first principles, opus-level depth, document everything. Every line of Limen code is a masterclass.*

*SolisHQ -- We innovate, invent, then disrupt.*
