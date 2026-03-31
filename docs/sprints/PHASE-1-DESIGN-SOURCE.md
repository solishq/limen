# PHASE 1 DESIGN SOURCE: Convenience API

**Date**: 2026-03-30
**Author**: Builder (SolisHQ Engineering)
**Status**: APPROVED (with amendments)
**Classification**: SIGNIFICANT
**Governing Documents**: LIMEN_BUILD_PHASES.md (Phase 1), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md (A.2, A.3, B.5, C.11)
**Codebase Baseline**: Phase 0 complete, 3,188 passing tests, 134 invariants, schema v36

---

## AMENDMENTS (PA Approved 2026-03-31)

1. **Eager init**: Convenience layer initializes during `createLimen()`. All methods synchronous `Result<T>`. No runtime state machine.
2. **Existing grounding**: Uses `groundingMode` + `evidenceRefs` for confidence cap bypass, not `humanVerified`. Matches Addendum A.2 Rule 1.
3. **String values**: `BeliefView.value` is `string`, not `unknown`. Convenience API deals in strings.

Status changed: PENDING PA REVIEW → **APPROVED**

---

## PROMPT AUDIT GATE

### Gaps Found

**GAP-1: ClaimApi has no retractClaim method.**
The `ClaimApi` interface (api.ts:61-65) exposes `assertClaim`, `relateClaims`, `queryClaims` only. The `RawClaimFacade` (claim_facade.ts:45-49) mirrors this exact set. The `ClaimStore.retract()` method exists in `claim_stores.ts:320` but is NOT exposed through any facade or API layer. The `forget(claimId, reason?)` convenience method therefore has NO existing public surface to delegate to.

- **Impact**: `forget()` cannot simply wrap `ClaimApi.retractClaim()` -- that method does not exist. We must EITHER (a) add `retractClaim` to ClaimApi/RawClaimFacade first, or (b) reach through to ClaimSystem directly from the convenience layer.
- **Recommendation**: Option (a) -- add `retractClaim` to ClaimApi and RawClaimFacade as a Phase 1 prerequisite. This is additive, non-breaking, and follows the existing pattern. The convenience layer then delegates to `this.claims.retractClaim()`.
- **Ruling needed**: NO -- this is an additive interface extension, same architectural pattern as existing methods.

**GAP-2: MissionId requirement for ClaimCreateInput.**
`ClaimCreateInput.missionId` is required (`readonly missionId: MissionId`). The convenience API must provide one. The MCP adapter solves this by creating a mission per session. The programmatic API has no session concept. Decision required (see Critical Decision #1 below).

**GAP-3: AgentId requirement for OperationContext.**
`ClaimStore.create()` receives `OperationContext` which carries `agentId`. In single-tenant mode, `agentId` is `null` unless `setDefaultAgent()` is called. The CCP SC-11 handler maps `ctx.agentId` to `sourceAgentId` on the claim. The convenience API must work WITHOUT requiring agent registration. Current behavior: `agentId=null` flows through to `sourceAgentId=null` on the claim. This is acceptable for library mode.

### Wrong Assumptions Found

**NONE.** All prompt references verified against codebase.

### Edge Cases Identified

1. **Remember overload resolution**: TypeScript cannot distinguish `remember(string, string, string, opts?)` from `remember(string, opts?)` at runtime by arity alone when `opts` is omitted -- both are `(string, ...)`. Must use type checking on second argument.
2. **reflect() transaction semantics**: The prompt says "wraps multiple remember() calls in a transaction." SQLite transactions via `conn.run('BEGIN')` / `conn.run('COMMIT')` are available. But ClaimApiImpl gets connection via `getConnection()` closure. Transaction wrapping needs to happen at the convenience layer, NOT inside individual assertClaim calls.
3. **Superseded detection**: `ClaimQueryResultItem.superseded: boolean` is a computed field (claim_types.ts:362). Set by the query handler based on `supersedes` relationship existence. The `recall()` convenience method can filter these out by default.

---

## CRITICAL DESIGN DECISIONS

### Decision 1: MissionId for Convenience Claims

**Problem**: `ClaimCreateInput.missionId` is a required field (type `MissionId`). Every `remember()` call must provide one. Options:

| Option | Mechanism | Pros | Cons |
|--------|-----------|------|------|
| A. Sentinel value | Hardcoded string like `"convenience"` cast as MissionId | Zero overhead, stateless | Mission does not exist in DB -- could break FK validation or queries. Requires audit. |
| B. Config field | `CognitiveConfig.missionId` | Explicit, testable | Requires user to provide it or auto-create. Leaks mission concepts into convenience API. |
| C. Auto-create | Create a mission on first `remember()` call, cache the ID | Transparent to user | Adds async initialization. First call slower. Mission lifecycle management. |
| D. Lazy sentinel + no FK | Use a well-known sentinel that bypasses mission validation | Simple | Requires knowing whether SC-11 validates missionId FK |

**Investigation**: Reading `claim_stores.ts` SC-11 handler, the `MISSION_NOT_ACTIVE` error code exists in `SC11_ERROR_CODES`. The handler checks mission state. Let me verify the exact check.

**Codebase evidence**: The SC-11 handler validates `input.missionId` against mission state. A non-existent missionId would fail with `MISSION_NOT_ACTIVE`.

**Decision: Option C -- Auto-create mission during `createLimen()` (eager init).**

**Justification**:
1. The MCP adapter already uses this exact pattern (creates a mission per session via `openSession()`).
2. A sentinel value would fail SC-11 validation -- the mission must exist.
3. Config field leaks orchestration concepts into the convenience surface.
4. **[AMENDED]** Creation happens eagerly during `createLimen()` (already async), not lazily on first call. One-time cost (~10ms), cached for the engine lifetime.
5. The mission is created with a fixed objective: `"limen-convenience-api"`, agent: `"limen-convenience"`, budget: 1,000,000 tokens, deadline: 1 year.

**Implementation detail**: The convenience layer registers a `"limen-convenience"` agent and creates the convenience mission eagerly during `createLimen()`. The agent registration is idempotent. The mission is created once and stored in a closure-scoped variable. The mission must go through the full lifecycle: create -> propose task graph -> propose task execution. The resulting `missionId` and `taskId` are cached.

**Trade-off acknowledged**: This adds ~30ms to `createLimen()` (already async). All convenience methods are synchronous `Result<T>` after engine creation. This is cleaner than lazy init because (a) `createLimen()` is already async, (b) it eliminates the runtime state machine entirely, and (c) init failures are surfaced immediately as `LimenError` during construction rather than deferred to first use.

### Decision 2: Data Mapping -- ClaimQueryResult to BeliefView

**ClaimQueryResult structure** (from codebase):
```
ClaimQueryResult {
  claims: ClaimQueryResultItem[]  // paginated results
  total: number                    // total matching count
  hasMore: boolean                 // pagination indicator
}

ClaimQueryResultItem {
  claim: Claim {
    id: ClaimId
    tenantId: TenantId | null
    subject: string
    predicate: string
    object: { type: ObjectType, value: unknown }
    confidence: number
    validAt: string
    sourceAgentId: AgentId
    sourceMissionId: MissionId | null
    sourceTaskId: TaskId | null
    groundingMode: GroundingMode
    runtimeWitness: RuntimeWitnessInput | null
    status: ClaimStatus             // 'active' | 'retracted'
    archived: boolean
    createdAt: string
  }
  evidence?: ClaimEvidence[]
  relationships?: ClaimRelationship[]
  superseded: boolean               // computed
  disputed: boolean                  // computed
}
```

**BeliefView transformation** (simplified view for convenience API):

| BeliefView field | Source | Transformation |
|------------------|--------|----------------|
| `claimId` | `item.claim.id` | Direct passthrough |
| `subject` | `item.claim.subject` | Direct passthrough |
| `predicate` | `item.claim.predicate` | Direct passthrough |
| `value` | `String(item.claim.object.value)` | Unwrap from `object.value` and coerce to string -- the `object.type` is metadata, not shown by default. For typed access, use `ClaimApi.queryClaims()` directly. |
| `confidence` | `item.claim.confidence` | Direct passthrough |
| `validAt` | `item.claim.validAt` | Direct passthrough |
| `createdAt` | `item.claim.createdAt` | Direct passthrough |
| `superseded` | `item.superseded` | Direct passthrough |
| `disputed` | `item.disputed` | Direct passthrough |

**Design decision**: `recall()` returns `BeliefView[]` by default, which excludes: `tenantId`, `sourceAgentId`, `sourceMissionId`, `sourceTaskId`, `groundingMode`, `runtimeWitness`, `archived`, `status`, `evidence`, `relationships`. These are available via `limen.claims.queryClaims()` for users who need them.

**Default behavior**: `recall()` excludes superseded claims by default. `options.includeSuperseded: true` to include them.

### Decision 3: Superseded Detection

**Codebase answer**: `ClaimQueryResultItem.superseded` is a computed boolean field (claim_types.ts:362, JSDoc: "Computed -- claim has been superseded by a relationship"). The query handler computes it by checking for `supersedes` relationship targeting this claim.

There is NO `superseded` column in the database. It is computed at query time by the `query_claims` handler examining the `claim_relationships` table for rows with `type='supersedes'` and `to_claim_id=<this claim>`.

The `recall()` convenience method filters out superseded claims by passing `includeRelationships: false` (we don't need the full relationship objects) and then filtering the result set where `superseded === false`.

### Decision 4: Error Flow

**ClaimApi error codes mapped to convenience API errors**:

| ClaimApi Method | Error Codes | Convenience Method | Convenience Error |
|----------------|-------------|-------------------|-------------------|
| `assertClaim` | `INVALID_SUBJECT`, `INVALID_PREDICATE`, `INVALID_OBJECT_TYPE`, `CONFIDENCE_OUT_OF_RANGE`, `INVALID_VALID_AT`, all SC11 codes | `remember()` | Map to `LMN-1xxx` codes (see Error Taxonomy) |
| `queryClaims` | `NO_FILTERS`, `INVALID_SUBJECT_FILTER`, `INVALID_PREDICATE_FILTER`, `LIMIT_EXCEEDED`, all SC13 codes | `recall()` | Map to `LMN-1xxx` codes |
| `retractClaim` (to be added) | `CLAIM_NOT_FOUND`, `UNAUTHORIZED`, `CLAIM_ALREADY_RETRACTED`, `INVALID_REASON` | `forget()` | Map to `LMN-1xxx` codes |
| `relateClaims` | `CLAIM_NOT_FOUND`, `CROSS_TENANT`, `INVALID_RELATIONSHIP_TYPE`, `SELF_REFERENCE`, `CLAIM_NOT_ACTIVE`, all SC12 codes | `connect()` | Map to `LMN-1xxx` codes |

**Design decision**: The convenience API wraps errors in a `ConvenienceError` type that carries the original error code from the system call. The convenience layer does NOT invent new error codes for conditions already named by the system calls. It adds codes only for convenience-layer-specific failures (e.g., `INIT_FAILED` if auto-mission creation fails).

### Decision 5: Subject Format for 1-Param remember()

**1-param form**: `remember(text, options?)` auto-generates subject from content hash.

**Format**: `entity:observation:<sha256-hex-first-12>` where the hash is SHA-256 of the UTF-8 encoded text, truncated to first 12 hex characters.

**Validation**: The CCP validates subject format as `entity:<type>:<identifier>` (3 colon-separated segments). The auto-generated subject satisfies this: `entity` is the prefix, `observation` is the type, and the hash is the identifier.

**Codebase evidence**: SC-11 validation in `claim_stores.ts` checks `INVALID_SUBJECT` for format compliance. The format is documented in `ClaimCreateInput`: "Subject URN -- entity:<type>:<identifier>, strict 3-segment."

### Decision 6: AgentId Requirement

**Codebase answer**: `ClaimStore.create()` receives `OperationContext` which has `agentId: AgentId | null`. In single-tenant library mode, `agentId` starts as `null`. The SC-11 handler maps this to `sourceAgentId` on the claim.

**The convenience layer auto-registers a `"limen-convenience"` agent** as part of the auto-mission creation (Decision 1). After agent registration, `setDefaultAgent()` is called with the agent's ID. This ensures all claims have proper attribution.

**Why not skip the agent**: Claims without `sourceAgentId` lose retraction authorization (only source agent or admin can retract). Without an agent, `forget()` would fail with `UNAUTHORIZED` since there is no source agent to match against.

---

## OUTPUT 1: MODULE DECOMPOSITION

### Architecture

```
src/api/
  convenience/                        <- NEW DIRECTORY
    convenience_types.ts              <- Type definitions (Output 2)
    convenience_layer.ts              <- Implementation (thin delegation)
    convenience_prompt.ts             <- promptInstructions() generator
    convenience_init.ts               <- Auto-mission/agent initialization
  interfaces/
    api.ts                            <- MODIFIED: add convenience methods to Limen interface
  facades/
    claim_facade.ts                   <- MODIFIED: add retractClaim to RawClaimFacade
    claim_api_impl.ts                 <- MODIFIED: add retractClaim to ClaimApiImpl
  index.ts                            <- MODIFIED: wire convenience layer into createLimen
```

### Module Boundaries

| Module | Purpose | Inputs | Outputs | Dependencies |
|--------|---------|--------|---------|--------------|
| `convenience_types.ts` | Type definitions for convenience API | None | `RememberOptions`, `RememberResult`, `RecallOptions`, `BeliefView`, `ForgetOptions`, `ReflectEntry`, `ReflectResult`, `CognitiveConfig` | `claim_types.ts` (for `ClaimId`, `RelationshipType`) |
| `convenience_layer.ts` | Implementation of all convenience methods | `ClaimApi`, `CognitiveConfig` | Method implementations delegating to `ClaimApi` | `ClaimApi`, `convenience_types.ts`, `convenience_init.ts` |
| `convenience_prompt.ts` | System prompt text generation | None | `string` | None (pure function) |
| `convenience_init.ts` | Eager initialization of agent + mission during `createLimen()` | `Limen` (agents, missions, setDefaultAgent) | `{ missionId, taskId }` | `AgentApi`, `MissionApi` |

### Ownership

The convenience layer is owned by the API surface (`src/api/`). It is a CONSUMER of `ClaimApi` -- it never reaches into `ClaimSystem`, `ClaimStore`, or any kernel/subsystem type directly. The governance boundary (I-17) is preserved.

### What the Convenience Layer Does NOT Own

- Claim validation (owned by SC-11 handler)
- Tenant isolation (owned by OperationContext)
- RBAC enforcement (owned by RawClaimFacade)
- Rate limiting (owned by RawClaimFacade)
- Audit trail (owned by SC-11/SC-12/SC-13 handlers)
- Grounding (owned by GroundingValidator)

---

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// ============================================================================
// convenience_types.ts — Phase 1 Convenience API Type Definitions
// ============================================================================

import type { ClaimId, RelationshipType } from '../../claims/interfaces/claim_types.js';

// ── Configuration ──

/**
 * Phase 1: Cognitive configuration for convenience API.
 * Passed to createLimen() config. Controls convenience API behavior.
 */
export interface CognitiveConfig {
  /**
   * A.2 Rule 1: Maximum confidence for auto-extracted claims.
   * Claims created via remember() are capped at this value
   * unless options.groundingMode is 'evidence_path' AND
   * options.evidenceRefs is non-empty.
   *
   * Default: 0.7
   * Range: [0.0, 1.0]
   * CONSTITUTIONAL: This is the primary defense against confidence laundering.
   */
  readonly maxAutoConfidence?: number;
}

// ── remember() Types ──

/**
 * Options for remember() calls.
 * All fields optional -- sane defaults applied.
 */
export interface RememberOptions {
  /**
   * Confidence score [0.0, 1.0].
   * Default: CognitiveConfig.maxAutoConfidence (0.7).
   * If provided AND groundingMode is 'evidence_path' with non-empty evidenceRefs, not capped.
   * Otherwise, capped at maxAutoConfidence.
   */
  readonly confidence?: number;

  /**
   * How the claim's truth is anchored.
   * 'runtime_witness': observed at runtime (default).
   * 'evidence_path': grounded by external evidence (bypasses confidence cap
   *   when evidenceRefs is non-empty).
   * Default: 'runtime_witness'.
   */
  readonly groundingMode?: 'runtime_witness' | 'evidence_path';

  /**
   * Evidence references grounding this claim.
   * Required for 'evidence_path' grounding mode to bypass confidence cap.
   * Each ref identifies an artifact, claim, memory, or capability result.
   * Default: [].
   */
  readonly evidenceRefs?: readonly EvidenceRef[];

  /**
   * ISO 8601 timestamp for temporal anchoring.
   * Default: current time.
   */
  readonly validAt?: string;

  /**
   * Object value type hint.
   * Default: 'string'.
   */
  readonly objectType?: 'string' | 'number' | 'boolean' | 'date' | 'json';
}

/**
 * Result of a remember() call.
 */
export interface RememberResult {
  /** The created claim's ID */
  readonly claimId: ClaimId;
  /** The actual confidence stored (may be capped by maxAutoConfidence) */
  readonly confidence: number;
}

// ── recall() Types ──

/**
 * Options for recall() calls.
 */
export interface RecallOptions {
  /**
   * Minimum confidence threshold.
   * Default: none (all confidences).
   */
  readonly minConfidence?: number;

  /**
   * Include superseded claims in results.
   * Default: false (superseded claims are excluded).
   */
  readonly includeSuperseded?: boolean;

  /**
   * Maximum number of results.
   * Default: 50 (matches CLAIM_QUERY_DEFAULT_LIMIT).
   */
  readonly limit?: number;
}

/**
 * Simplified claim view for convenience API consumers.
 * Hides internal fields (tenantId, agentId, missionId, etc.).
 */
export interface BeliefView {
  /** Claim identifier */
  readonly claimId: ClaimId;
  /** Subject URN (entity:<type>:<id>) */
  readonly subject: string;
  /** Predicate (<domain>.<property>) */
  readonly predicate: string;
  /**
   * String representation of the claim's object value.
   * For typed access, use ClaimApi.queryClaims() directly.
   */
  readonly value: string;
  /** Confidence score [0.0, 1.0] */
  readonly confidence: number;
  /** Temporal anchor (ISO 8601) */
  readonly validAt: string;
  /** Creation timestamp (ISO 8601) */
  readonly createdAt: string;
  /** Whether this claim has been superseded */
  readonly superseded: boolean;
  /** Whether this claim has been contradicted */
  readonly disputed: boolean;
}

// ── forget() Types ──

/**
 * Options for forget() calls.
 */
export interface ForgetOptions {
  // Reserved for future use (e.g., retraction reason taxonomy in Phase 4).
  // Currently empty but defined for forward compatibility.
}

// ── connect() Types ──

// connect() uses RelationshipType directly from claim_types.ts.
// No additional types needed.

// ── reflect() Types ──

/**
 * A single entry for batch reflection.
 * Maps to a categorized remember() call.
 */
export interface ReflectEntry {
  /**
   * Learning category.
   * Maps to predicate: 'reflection.<category>'
   */
  readonly category: 'decision' | 'pattern' | 'warning' | 'finding';

  /**
   * The learning statement. Max 500 characters.
   */
  readonly statement: string;

  /**
   * Optional confidence override.
   * Default: CognitiveConfig.maxAutoConfidence (0.7).
   */
  readonly confidence?: number;
}

/**
 * Result of a reflect() call.
 */
export interface ReflectResult {
  /** Number of claims successfully created */
  readonly stored: number;
  /** Claim IDs of created claims, in order of input entries */
  readonly claimIds: readonly ClaimId[];
}

// ── Prompt Instructions ──

// promptInstructions() returns string. No additional types needed.

// ── Error Types ──

/**
 * Convenience API error codes.
 * Prefixed with CONV_ to distinguish from system-call error codes.
 */
export type ConvenienceErrorCode =
  | 'CONV_INVALID_TEXT'          // 1-param remember() with empty text
  | 'CONV_INVALID_CONFIDENCE'   // Confidence not in [0.0, 1.0]
  | 'CONV_INVALID_CATEGORY'     // reflect() category not in allowed set
  | 'CONV_STATEMENT_TOO_LONG'   // reflect() statement exceeds 500 chars
  | 'CONV_EMPTY_ENTRIES'        // reflect() called with empty array
  | 'CONV_BATCH_PARTIAL'        // reflect() partial failure (some stored, some failed)
  | 'CONV_CLAIM_NOT_FOUND'      // forget() target not found
  | 'CONV_ALREADY_RETRACTED'    // forget() target already retracted
  | 'CONV_INVALID_RELATIONSHIP' // connect() invalid relationship type
  | 'CONV_SELF_REFERENCE';      // connect() same claim on both sides
```

### Limen Interface Additions

```typescript
// Added to the Limen interface in api.ts:

/**
 * Phase 1 §1.1/§1.2: Store a belief.
 *
 * 3-param form (primary): explicit subject, predicate, value.
 * 1-param form (sugar): auto-generates subject from content hash,
 *   predicate defaults to 'observation.note'.
 *
 * Confidence capped at maxAutoConfidence (default 0.7) unless
 * groundingMode is 'evidence_path' with non-empty evidenceRefs.
 */
remember(subject: string, predicate: string, value: string, options?: RememberOptions): Result<RememberResult>;
remember(text: string, options?: RememberOptions): Result<RememberResult>;

/**
 * Phase 1 §1.3: Retrieve beliefs.
 *
 * Returns simplified BeliefView objects.
 * Excludes superseded claims by default.
 * Both parameters optional -- omitting both returns recent claims.
 */
recall(subject?: string, predicate?: string, options?: RecallOptions): Result<readonly BeliefView[]>;

/**
 * Phase 1 §1.4: Retract a belief (governed, audited).
 *
 * The retracted claim remains in the database with status='retracted'.
 * All derived claims retain their relationships for audit continuity.
 */
forget(claimId: string, reason?: string): Result<void>;

/**
 * Phase 1 §1.5: Create a relationship between two claims.
 *
 * Types: 'supports', 'contradicts', 'supersedes', 'derived_from'.
 * Directed: from claimId1 to claimId2.
 */
connect(claimId1: string, claimId2: string, type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from'): Result<void>;

/**
 * Phase 1 §1.6: Batch-store categorized learnings.
 *
 * Each entry becomes a claim with predicate 'reflection.<category>'.
 * Subject auto-generated from content hash.
 * Runs in a transaction -- all-or-nothing.
 */
reflect(entries: readonly ReflectEntry[]): Result<ReflectResult>;

/**
 * Phase 1 §1.7: Get system prompt instructions for agents.
 *
 * Returns a multi-line string teaching an AI agent how to use Limen.
 * Pure function -- no I/O, deterministic output.
 */
promptInstructions(): string;
```

---

## OUTPUT 3: STATE MACHINES

**[AMENDED]** The convenience layer has NO runtime state machine. Agent registration and mission creation happen eagerly during `createLimen()` (already async). All convenience methods are synchronous after engine creation. `promptInstructions()` remains a pure function.

**Invariants**:
- I-CONV-01: After `createLimen()` returns, all convenience methods are immediately usable.
- I-CONV-02: The convenience mission and agent are created once during engine initialization and cached for the engine lifetime.

---

## OUTPUT 4: SYSTEM-CALL MAPPING

| Convenience Method | System Call(s) | Parameter Transformation |
|-------------------|----------------|--------------------------|
| `remember(s, p, v, opts?)` | `ClaimApi.assertClaim(input)` | `subject=s`, `predicate=p`, `object={type: opts.objectType ?? 'string', value: v}`, `confidence=min(opts.confidence ?? 0.7, maxAutoConfidence)` (unless `opts.groundingMode === 'evidence_path' && opts.evidenceRefs?.length > 0`), `validAt=opts.validAt ?? now()`, `missionId=cached`, `taskId=cached`, `groundingMode=opts.groundingMode ?? 'runtime_witness'`, `runtimeWitness` (if runtime_witness mode): `{witnessType:'convenience', witnessedValues:{source:'remember'}, witnessTimestamp:now()}`, `evidenceRefs=opts.evidenceRefs ?? []` |
| `remember(text, opts?)` | `ClaimApi.assertClaim(input)` | `subject='entity:observation:<sha256-12>'`, `predicate='observation.note'`, rest same as above with `object.value=text` |
| `recall(subj?, pred?, opts?)` | `ClaimApi.queryClaims(input)` | `subject=subj ?? null`, `predicate=pred ?? null`, `status='active'`, `minConfidence=opts.minConfidence ?? null`, `limit=opts.limit ?? 50`, `includeEvidence=false`, `includeRelationships=false`. Post-query: filter `superseded===true` unless `opts.includeSuperseded`. Map each `ClaimQueryResultItem` to `BeliefView`. |
| `forget(claimId, reason?)` | `ClaimApi.retractClaim({claimId, reason})` | `claimId` cast to `ClaimId`, `reason=reason ?? 'Retracted via forget()'` |
| `connect(id1, id2, type)` | `ClaimApi.relateClaims(input)` | `fromClaimId=id1` cast to `ClaimId`, `toClaimId=id2` cast to `ClaimId`, `type=type`, `missionId=cached` |
| `reflect(entries)` | N * `ClaimApi.assertClaim(input)` in transaction | For each entry: `subject='entity:reflection:<sha256-12 of statement>'`, `predicate='reflection.<category>'`, `object={type:'string', value:entry.statement}`, `confidence=min(entry.confidence ?? maxAutoConfidence, maxAutoConfidence)`. Transaction: `BEGIN` -> all assertions -> `COMMIT` or `ROLLBACK`. |
| `promptInstructions()` | None | Pure string generation. No system call. |

### Grounding Mode Decision

**[AMENDED]** Convenience API claims default to `groundingMode: 'runtime_witness'` but callers may override via `RememberOptions.groundingMode`:

1. **Default (`runtime_witness`)**: No evidence references needed. The witness data carries the source (`'convenience'`) and timestamp for audit trail. This is the correct mode for "I observed this at runtime" which is the default `remember()` semantic.
2. **Override (`evidence_path`)**: Requires non-empty `evidenceRefs`. When provided, the confidence cap (`maxAutoConfidence`) is bypassed -- this is the mechanism for storing high-confidence claims with evidence grounding.
3. `evidence_path` with empty `evidenceRefs` falls back to runtime_witness behavior (capped confidence) to prevent accidental confidence laundering.

---

## OUTPUT 5: ERROR TAXONOMY

| Error Code | Trigger | Method(s) | Recovery |
|-----------|---------|-----------|----------|
| `CONV_INVALID_TEXT` | 1-param `remember()` called with empty string or whitespace-only | `remember(text)` | Provide non-empty text. |
| `CONV_INVALID_CONFIDENCE` | Confidence value outside [0.0, 1.0] | `remember()`, `reflect()` | Provide confidence in range. |
| `CONV_INVALID_CATEGORY` | reflect() entry has invalid category | `reflect()` | Use: 'decision', 'pattern', 'warning', 'finding'. |
| `CONV_STATEMENT_TOO_LONG` | reflect() entry statement exceeds 500 chars | `reflect()` | Shorten statement. |
| `CONV_EMPTY_ENTRIES` | reflect() called with empty array | `reflect()` | Provide at least one entry. |
| `CONV_BATCH_PARTIAL` | reflect() transaction failed mid-batch (rolled back) | `reflect()` | All entries rolled back. Fix the failing entry and retry entire batch. |
| `CONV_CLAIM_NOT_FOUND` | forget() target claim does not exist or wrong tenant | `forget()` | Verify claimId is correct. |
| `CONV_ALREADY_RETRACTED` | forget() target already retracted | `forget()` | No action needed -- claim is already forgotten. |
| `CONV_INVALID_RELATIONSHIP` | connect() type not in allowed set | `connect()` | Use: 'supports', 'contradicts', 'supersedes', 'derived_from'. |
| `CONV_SELF_REFERENCE` | connect() same claimId on both sides | `connect()` | Provide two different claim IDs. |
| `INVALID_SUBJECT` | Passthrough from SC-11 | `remember()` (3-param) | Fix subject format to `entity:<type>:<id>`. |
| `INVALID_PREDICATE` | Passthrough from SC-11 | `remember()` (3-param) | Fix predicate format to `<domain>.<property>`. |
| `RATE_LIMITED` | Per-agent rate limit exceeded | All mutating methods | Wait and retry. |

**Error wrapping strategy**: The convenience layer catches `Result<T>` errors from `ClaimApi` methods. For well-known error codes (`CLAIM_NOT_FOUND`, `CLAIM_ALREADY_RETRACTED`, `SELF_REFERENCE`), it maps to convenience-specific codes. For all other system-call errors, it passes through the original error code and message.

---

## OUTPUT 6: SCHEMA DESIGN

**Phase 1 requires ZERO new tables, ZERO new columns, ZERO migrations.**

The convenience API is a pure TypeScript layer that delegates to existing system calls. All data storage uses existing tables:
- `claim_assertions` -- claims created by `remember()`, `reflect()`
- `claim_relationships` -- relationships created by `connect()`
- `claim_evidence` -- evidence refs (auto-generated witness data)
- `obs_trace_events` -- trace events emitted by SC-11/SC-12 handlers

The `CognitiveConfig.maxAutoConfidence` is an in-memory configuration value, not persisted. It is set at `createLimen()` time and lives in closure scope.

**Phase 2 additions** (NOT Phase 1): FTS5 virtual tables for search.
**Phase 3 additions** (NOT Phase 1): `last_accessed_at`, `access_count`, `stability` columns.

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Phase 0 Dependencies (What Phase 1 Consumes)

| Phase 0 Artifact | How Phase 1 Uses It |
|-----------------|---------------------|
| `ClaimApi` interface | All convenience methods delegate to it |
| `ClaimApiImpl` | Implementation behind `limen.claims` |
| `RawClaimFacade` | RBAC + rate limiting layer (to be extended with `retractClaim`) |
| `createLimen()` factory | Extended to wire convenience layer and accept `CognitiveConfig` |
| `Limen` interface | Extended with convenience methods |
| `AgentApi` | Used by eager init during `createLimen()` to register `"limen-convenience"` agent |
| `MissionApi` | Used by eager init during `createLimen()` to create convenience mission |
| Schema v36 | All existing tables used as-is |

### Phase 2+ Enablement (What Phase 1 Provides)

| Phase 1 Artifact | How Future Phases Use It |
|-----------------|--------------------------|
| `remember()` | Phase 2: FTS5 indexing triggers fire on claims created by `remember()` |
| `recall()` | Phase 3: Returns `effective_confidence` (decayed) alongside `confidence` |
| `BeliefView` | Phase 3: Extended with `effectiveConfidence`, `freshness` fields |
| `CognitiveConfig` | Phase 3: Extended with decay parameters. Phase 4: Extended with conflict detection config. |
| `forget()` | Phase 4: Triggers cascade retraction confidence reduction |
| `connect()` | Phase 4: Contradiction relationships trigger review mechanism |
| `reflect()` | Phase 5: Extended with `reasoning` field per entry |
| `promptInstructions()` | Phase 6: Enhanced with search and decay examples. Phase 7: Used by MCP context builder. |

### Additive Guarantee

Phase 1 adds methods to the `Limen` interface. It does NOT:
- Remove any existing method
- Change any existing method signature
- Change any existing method behavior
- Modify any database schema
- Add any new system calls
- Break any existing test

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Classification | Justification |
|---------|---------------|---------------|
| `maxAutoConfidence` ceiling enforcement | **CONSTITUTIONAL** | A.2 Rule 1: "This is NON-NEGOTIABLE. It is the single most important defense against the wrong knowledge problem." Violation = confidence laundering = system defect. |
| `maxAutoConfidence` bypass via `evidence_path` with non-empty `evidenceRefs` | **CONSTITUTIONAL** | A.2 Rule 1: "A machine-generated claim MUST NEVER start at 0.9+ unless a human explicitly confirms it." The bypass path must be explicit -- requires evidence_path grounding mode with at least one evidence reference. |
| `remember()` delegates to SC-11 | **CONSTITUTIONAL** | I-17: Governance boundary. Convenience layer must never bypass system calls. |
| `forget()` delegates to retraction handler | **CONSTITUTIONAL** | I-03: Atomic auditing. Retraction must produce audit entry. |
| `connect()` delegates to SC-12 | **CONSTITUTIONAL** | I-31: Relationship constraints enforced by system call. |
| `recall()` excludes superseded by default | **QUALITY_GATE** | Spec says "returns simplified claim views." Excluding superseded is a correctness enhancement, not a constitutional requirement. |
| `reflect()` transaction semantics | **QUALITY_GATE** | All-or-nothing batch. Partial failure with inconsistent state is a quality defect but not a governance violation. |
| `promptInstructions()` content | **DESIGN_PRINCIPLE** | Text content guides agent behavior. Not testable as pass/fail. |
| `BeliefView` field selection | **DESIGN_PRINCIPLE** | Which fields to include is a DX decision, not a correctness requirement. |
| Eager initialization during `createLimen()` | **DESIGN_PRINCIPLE** | Auto-creating mission is an architectural choice, not a constitutional requirement. Eager init eliminates runtime state machine. |
| 1-param `remember()` sugar form | **ROADMAP** | Sugar convenience. Could be deferred without affecting thesis validation. Included in Phase 1 per build plan. |
| `CognitiveConfig` extensibility | **ROADMAP** | Config type designed for Phase 3+ extensions (decay, conflict detection). |

---

## IMPLEMENTATION NOTES FOR CONTROLS 1-7

### Prerequisite: Extend ClaimApi with retractClaim

Before Phase 1 convenience implementation begins, the following additive changes are required:

1. **`RawClaimFacade`** (claim_facade.ts): Add `retractClaim(conn, ctx, input: RetractClaimInput): Result<void>`
2. **`ClaimApi`** (api.ts): Add `retractClaim(input: RetractClaimInput): Result<void>`
3. **`ClaimApiImpl`** (claim_api_impl.ts): Add `retractClaim` method delegating to `this.raw.retractClaim()`
4. **`createRawClaimFacade`** factory: Add retractClaim delegation to `claimSystem.retractClaim.execute()`

This is a mechanical extension following the exact pattern of the existing 3 methods. Zero new logic.

### Overload Resolution Strategy

TypeScript function overloads for `remember()`:

```typescript
// Declaration (in Limen interface):
remember(subject: string, predicate: string, value: string, options?: RememberOptions): Result<RememberResult>;
remember(text: string, options?: RememberOptions): Result<RememberResult>;

// Implementation (in convenience_layer.ts):
remember(
  subjectOrText: string,
  predicateOrOptions?: string | RememberOptions,
  value?: string,
  options?: RememberOptions,
): Result<RememberResult> {
  // Runtime discrimination:
  if (typeof predicateOrOptions === 'string') {
    // 3-param form: (subject, predicate, value, options?)
    return this._remember3(subjectOrText, predicateOrOptions, value!, options);
  } else {
    // 1-param form: (text, options?)
    return this._remember1(subjectOrText, predicateOrOptions);
  }
}
```

### SHA-256 for Subject Generation

```typescript
import { createHash } from 'node:crypto';

function hashSubject(text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return `entity:observation:${hash.substring(0, 12)}`;
}
```

`node:crypto` is a Node.js builtin -- zero new dependencies. This is consistent with I-01 (single production dependency).

### reflect() Transaction Wrapping

The convenience layer needs direct connection access for `BEGIN`/`COMMIT`/`ROLLBACK`. It already has this via the `getConnection()` closure in `createLimen()`. The implementation:

```typescript
reflect(entries: readonly ReflectEntry[]): Result<ReflectResult> {
  const conn = this.getConnection();
  conn.run('BEGIN');
  try {
    const claimIds: ClaimId[] = [];
    for (const entry of entries) {
      const result = this.claims.assertClaim(/* ... */);
      if (!result.ok) {
        conn.run('ROLLBACK');
        return result; // propagate the error Result
      }
      claimIds.push(result.value.claim.id);
    }
    conn.run('COMMIT');
    return { ok: true, value: { stored: claimIds.length, claimIds } };
  } catch (err) {
    try { conn.run('ROLLBACK'); } catch { /* already rolled back */ }
    return { ok: false, error: { code: 'CONV_BATCH_PARTIAL', message: String(err) } };
  }
}
```

**Note**: `ClaimApiImpl.assertClaim()` calls `getConnection()` internally. The `getConnection()` closure returns the SAME connection instance (lazy singleton). Therefore the `BEGIN` issued by `reflect()` wraps the individual `assertClaim()` calls correctly -- they all operate on the same connection within the same transaction.

---

## SELF-AUDIT

- Did I derive from spec? YES -- every decision traces to Build Phases, Addendum, or codebase evidence.
- Did I follow three-file architecture? N/A -- Design Source, not implementation. The implementation plan specifies files that follow the pattern.
- Did I mark enforcement DCs with [A21]? N/A -- Design Source. DC declaration is Control 1.
- Would the Breaker find fault? Eager initialization eliminates the concurrency window that lazy init would have created. The Breaker should verify that `createLimen()` properly surfaces init failures as `LimenError`.
- **I do NOT judge completeness -- that is the Breaker's job (HB #23).**

---

*SolisHQ -- We innovate, invent, then disrupt.*
