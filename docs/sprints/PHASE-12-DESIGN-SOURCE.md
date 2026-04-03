# Phase 12: Cognitive Engine — Design Source

**Date**: 2026-04-03
**Author**: Orchestrator
**Criticality**: Tier 2 with Tier 1 inheritance (state transitions, governance, data integrity)
**Governing documents**: LIMEN_BUILD_PHASES.md (Phase 12), LIMEN_COGNITIVE_ARCHITECTURE_RESEARCH.md, CLAUDE.md
**Decision weight**: Consequential (final phase before v2.0.0, introduces autonomous behavior)

---

## THE FIVE QUESTIONS

1. **What does the spec actually say?**
   Phase 12 delivers: self-healing retraction cascades (12.1), consolidation — merge + archive (12.2), importance scoring (12.3), auto-connection via embedding similarity (12.4), narrative memory (12.5), `limen.consolidate()` (12.6), `limen.verify(claimId)` (12.7). 16 system calls FROZEN. RetractionReason taxonomy is CONSTITUTIONAL (`incorrect | superseded | expired | manual`). Relationships are IMMUTABLE (append-only). Claim content is IMMUTABLE (triggers).

2. **How can this fail?**
   - Self-healing cascades infinitely → stack overflow or all claims retracted
   - Consolidation merges incorrectly → knowledge destroyed
   - Consolidation merge picks wrong winner → best claim retracted, worst survives
   - Auto-connection suggests wrong relationships → pollutes the knowledge graph
   - Importance scoring biased → critical claims deprioritized
   - verify() LLM hallucinates → false verification or false rejection
   - Narrative momentum calculation wrong → misleading cognitive state
   - Self-healing violates RetractionReason taxonomy → CONSTITUTIONAL violation
   - Self-healing creates cycles via mutual derived_from → infinite loop

3. **What are the downstream consequences?**
   - Self-healing is AUTONOMOUS behavior — first time Limen acts without caller initiation
   - Consolidation modifies the knowledge graph irreversibly (retractions + relationships)
   - Importance scores influence recall ranking — wrong scores = wrong answers
   - This is v2.0.0 — the public contract for cognitive operations

4. **What am I assuming?**
   - Self-healing threshold 0.1 is conservative enough to avoid mass retraction
   - Consolidation merge similarity 0.98 is strict enough to avoid false merges
   - The existing event bus can carry retraction events to the self-healing listener
   - verify() caller provides a competent LLM provider
   - Mission-scoped narrative queries are efficient with `source_mission_id` index

5. **Would a hostile reviewer find fault?**
   - "Self-healing is too aggressive" → Threshold configurable, depth-limited, every auto-retraction audited
   - "Consolidation destroys data" → Losers are retracted (not deleted), supersedes relationship created, logged
   - "verify() is a gimmick" → Explicitly opt-in, async, advisory-only, never auto-retracts
   - "Auto-connection pollutes the graph" → Suggestions are PENDING — never auto-created

---

## OUTPUT 1: MODULE DECOMPOSITION

### New Modules

| Module | Location | Responsibility |
|--------|----------|----------------|
| **Cognitive Types** | `src/cognitive/cognitive_types.ts` | All Phase 12 interfaces, enums, constants |
| **Importance Engine** | `src/cognitive/importance.ts` | 5-factor composite importance score |
| **Self-Healing Engine** | `src/cognitive/self_healing.ts` | Event-driven auto-retraction of derived claims |
| **Consolidation Engine** | `src/cognitive/consolidation.ts` | Merge similar + archive stale + suggest contradiction resolution |
| **Auto-Connection** | `src/cognitive/auto_connection.ts` | KNN-based relationship suggestions |
| **Narrative Memory** | `src/cognitive/narrative.ts` | Mission-scoped cognitive state snapshots |

### Existing Modules Modified

| Module | Change |
|--------|--------|
| `src/api/cognitive/cognitive_api.ts` | Extend CognitiveNamespace + CognitiveNamespaceDeps |
| `src/api/index.ts` | Wire deps, register self-healing listener |
| `src/api/interfaces/api.ts` | Add cognitive methods to Limen interface |

### Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                 Cognitive Engine (Phase 12)                       │
│                                                                  │
│  EVENT-DRIVEN:                                                   │
│    claim.retracted ──► SelfHealingEngine                         │
│      └─ traverse derived_from children                           │
│      └─ if effectiveConfidence < threshold → auto-retract        │
│      └─ depth-limited (max 5), cycle-safe (visited Set)          │
│                                                                  │
│  CALLER-INVOKED:                                                 │
│    consolidate() ──► ConsolidationEngine                         │
│      ├─ merge: KNN + same subject+predicate → retract losers     │
│      ├─ archive: stale + low confidence + low access → archive   │
│      └─ suggest: contradicts pairs → suggest supersession        │
│                                                                  │
│    importance(claimId) ──► ImportanceEngine                       │
│      └─ 5-factor: access, recency, density, confidence, gov     │
│                                                                  │
│    suggestConnections(claimId) ──► AutoConnection                │
│      └─ KNN → suggest supports/derived_from relationships        │
│                                                                  │
│    narrative(missionId?) ──► NarrativeMemory                     │
│      └─ SQL aggregation: subjects, decisions, momentum, threads  │
│                                                                  │
│    verify(claimId) ──► LLM provider (async, advisory)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## OUTPUT 2: TYPE ARCHITECTURE

```typescript
// ── Self-Healing ──

export interface SelfHealingConfig {
  readonly enabled: boolean;
  readonly autoRetractThreshold: number;   // default 0.1
  readonly maxCascadeDepth: number;        // default 5
}

export const DEFAULT_SELF_HEALING_CONFIG: SelfHealingConfig;

export interface SelfHealingEvent {
  readonly retractedClaimId: string;
  readonly derivedClaimId: string;
  readonly effectiveConfidence: number;
  readonly reason: string;
}

// ── Consolidation ──

export interface ConsolidationOptions {
  readonly mergeSimilarityThreshold?: number;   // default 0.98
  readonly archiveFreshnessFilter?: 'stale';    // only archive stale claims
  readonly archiveMaxConfidence?: number;        // default 0.3
  readonly archiveMaxAccessCount?: number;       // default 1
  readonly dryRun?: boolean;                     // default false
}

export interface ConsolidationResult {
  readonly merged: number;
  readonly archived: number;
  readonly suggestedResolutions: readonly ConflictResolution[];
  readonly log: readonly ConsolidationLogEntry[];
}

export interface ConflictResolution {
  readonly contradictionId: string;
  readonly weakerClaimId: string;
  readonly strongerClaimId: string;
  readonly confidenceRatio: number;
}

export interface ConsolidationLogEntry {
  readonly id: string;
  readonly operation: 'merge' | 'archive' | 'resolve';
  readonly sourceClaimIds: readonly string[];
  readonly targetClaimId: string | null;
  readonly reason: string;
}

// ── Importance ──

export interface ImportanceScore {
  readonly claimId: string;
  readonly score: number;                    // composite [0, 1]
  readonly factors: {
    readonly accessFrequency: number;        // [0, 1]
    readonly recency: number;                // [0, 1]
    readonly connectionDensity: number;      // [0, 1]
    readonly confidence: number;             // [0, 1] (effective)
    readonly governanceWeight: number;       // [0.2, 1.0]
  };
  readonly computedAt: string;
}

export interface ImportanceWeights {
  readonly accessFrequency: number;          // default 0.25
  readonly recency: number;                  // default 0.20
  readonly connectionDensity: number;        // default 0.20
  readonly confidence: number;               // default 0.25
  readonly governance: number;               // default 0.10
}

export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights;

// ── Auto-Connection ──

export interface ConnectionSuggestion {
  readonly id: string;
  readonly fromClaimId: string;
  readonly toClaimId: string;
  readonly suggestedType: 'supports' | 'derived_from';
  readonly similarity: number;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'expired';
  readonly createdAt: string;
}

// ── Narrative ──

export interface NarrativeSnapshot {
  readonly id: string;
  readonly missionId: string | null;
  readonly subjectsExplored: number;
  readonly decisionsMade: number;
  readonly conflictsResolved: number;
  readonly claimsAdded: number;
  readonly claimsRetracted: number;
  readonly momentum: 'growing' | 'stable' | 'declining';
  readonly threads: readonly NarrativeThread[];
  readonly createdAt: string;
}

export interface NarrativeThread {
  readonly topic: string;                    // predicate prefix
  readonly claimCount: number;
  readonly latestClaimAt: string;
  readonly momentum: 'growing' | 'stable' | 'declining';
}

// ── Verification ──

export type VerificationProvider = (claim: { subject: string; predicate: string; value: string; confidence: number }) => Promise<VerificationResult>;

export interface VerificationResult {
  readonly verdict: 'confirmed' | 'challenged' | 'inconclusive';
  readonly reasoning: string;
  readonly suggestedConfidence: number | null;
}

// ── Error Codes ──

export type CognitiveErrorCode =
  | 'SELF_HEALING_DEPTH_EXCEEDED'
  | 'CONSOLIDATION_NO_CANDIDATES'
  | 'CONSOLIDATION_VECTOR_UNAVAILABLE'
  | 'IMPORTANCE_CLAIM_NOT_FOUND'
  | 'SUGGESTION_NOT_FOUND'
  | 'SUGGESTION_ALREADY_RESOLVED'
  | 'NARRATIVE_NO_CLAIMS'
  | 'VERIFY_PROVIDER_MISSING'
  | 'VERIFY_PROVIDER_FAILED'
  | 'VERIFY_CLAIM_NOT_FOUND';
```

---

## OUTPUT 3: STATE MACHINES

### 3.1 Connection Suggestion Lifecycle

```
  suggestConnections()
         │
         ▼
  ┌──────────────────┐
  │     PENDING       │
  └──────┬──────┬─────┘
         │      │
  accept │      │ reject
         │      │
         ▼      ▼
  ┌──────────┐ ┌──────────┐
  │ ACCEPTED │ │ REJECTED │
  │ (creates │ │ terminal │
  │ relation)│ └──────────┘
  └──────────┘

  Expired: status auto-set to 'expired' on read if age > 7 days (computed, not written)
```

### 3.2 Self-Healing Cascade Flow

```
  claim A retracted (event)
         │
         ▼
  ┌──────────────────────────────────────┐
  │ Query derived_from children of A      │
  │ (SELECT from_claim_id WHERE          │
  │  to_claim_id=A AND type=derived_from)│
  └──────────┬───────────────────────────┘
             │ for each child C:
             ▼
  ┌──────────────────────────────────────┐
  │ Compute effectiveConfidence(C)        │
  │ = confidence * decay * cascadePenalty │
  └──────────┬───────────────────────────┘
             │
             ├─ >= threshold → SKIP (C survives with reduced confidence)
             │
             └─ < threshold → AUTO-RETRACT C
                              with reason 'incorrect'
                              + emit claim.retracted (triggers recursion)
                              + log in consolidation_log
```

**Guards**: visited Set (prevents cycles), depth counter (max 5), threshold (default 0.1)

---

## OUTPUT 4: SYSTEM-CALL MAPPING

**ZERO new system calls.**

| Spec | Existing Call | How Phase 12 Hooks In |
|------|-------------|----------------------|
| 12.1 Self-healing | Event bus (`claim.retracted`) | Listener registered at createLimen() |
| 12.2 Consolidation merge | SC-12 (retractClaim) + SC-11 (relateClaims) | Retract losers, create supersedes |
| 12.2 Consolidation archive | Direct SQL (archived=1) | Existing column, no system call needed |
| 12.3 Importance | Read-only SQL aggregation | No mutation |
| 12.4 Auto-connection | VectorStore.knn (Phase 11) | Read-only + INSERT into suggestions table |
| 12.5 Narrative | Read-only SQL aggregation | No mutation, INSERT into snapshots |
| 12.6 consolidate() | Delegates to consolidation engine | Orchestrator |
| 12.7 verify() | External LLM call | Advisory only, no auto-mutation |

---

## OUTPUT 5: ERROR TAXONOMY

| Code | When | Severity |
|------|------|----------|
| `SELF_HEALING_DEPTH_EXCEEDED` | Cascade reached max depth | Warning (logged, not blocking) |
| `CONSOLIDATION_NO_CANDIDATES` | No merge/archive candidates found | Informational |
| `CONSOLIDATION_VECTOR_UNAVAILABLE` | Merge requires vectors, sqlite-vec not loaded | Informational |
| `IMPORTANCE_CLAIM_NOT_FOUND` | Claim ID doesn't exist or is tombstoned | Validation |
| `SUGGESTION_NOT_FOUND` | Suggestion ID doesn't exist | Validation |
| `SUGGESTION_ALREADY_RESOLVED` | Suggestion already accepted/rejected | Validation |
| `NARRATIVE_NO_CLAIMS` | No claims in scope for narrative | Informational |
| `VERIFY_PROVIDER_MISSING` | verify() called without provider configured | Blocking |
| `VERIFY_PROVIDER_FAILED` | LLM provider threw | Non-blocking (returns inconclusive) |
| `VERIFY_CLAIM_NOT_FOUND` | Claim ID doesn't exist | Validation |

---

## OUTPUT 6: SCHEMA DESIGN

### Migration 036: Cognitive Engine (v45)

```sql
-- 6.1: Importance score cache
CREATE TABLE IF NOT EXISTS claim_importance (
  claim_id                TEXT PRIMARY KEY NOT NULL,
  tenant_id               TEXT,
  importance_score        REAL NOT NULL,
  access_frequency_score  REAL NOT NULL,
  recency_score           REAL NOT NULL,
  connection_density_score REAL NOT NULL,
  confidence_score        REAL NOT NULL,
  governance_weight       REAL NOT NULL,
  computed_at             TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- 6.2: Connection suggestions
CREATE TABLE IF NOT EXISTS connection_suggestions (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT,
  from_claim_id   TEXT NOT NULL,
  to_claim_id     TEXT NOT NULL,
  suggested_type  TEXT NOT NULL CHECK (suggested_type IN ('supports','derived_from')),
  similarity      REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected','expired')),
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  FOREIGN KEY (from_claim_id) REFERENCES claim_assertions(id),
  FOREIGN KEY (to_claim_id) REFERENCES claim_assertions(id)
);

-- 6.3: Narrative snapshots
CREATE TABLE IF NOT EXISTS narrative_snapshots (
  id                  TEXT PRIMARY KEY NOT NULL,
  tenant_id           TEXT,
  mission_id          TEXT,
  snapshot_type       TEXT NOT NULL CHECK (snapshot_type IN ('mission','session','manual')),
  subjects_explored   INTEGER NOT NULL,
  decisions_made      INTEGER NOT NULL,
  conflicts_resolved  INTEGER NOT NULL,
  claims_added        INTEGER NOT NULL,
  claims_retracted    INTEGER NOT NULL,
  momentum            TEXT NOT NULL CHECK (momentum IN ('growing','stable','declining')),
  threads             TEXT NOT NULL,  -- JSON array
  created_at          TEXT NOT NULL
);

-- 6.4: Consolidation log
CREATE TABLE IF NOT EXISTS consolidation_log (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT,
  operation         TEXT NOT NULL CHECK (operation IN ('merge','archive','resolve','self_heal')),
  source_claim_ids  TEXT NOT NULL,  -- JSON array
  target_claim_id   TEXT,
  reason            TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- 6.5: Indexes
CREATE INDEX IF NOT EXISTS idx_importance_score ON claim_importance(tenant_id, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON connection_suggestions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_narrative_mission ON narrative_snapshots(tenant_id, mission_id);
CREATE INDEX IF NOT EXISTS idx_consolidation_op ON consolidation_log(tenant_id, operation);

-- 6.6: Tenant isolation triggers
CREATE TRIGGER IF NOT EXISTS claim_importance_tenant_immutable
  BEFORE UPDATE OF tenant_id ON claim_importance
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable on claim_importance'); END;

CREATE TRIGGER IF NOT EXISTS connection_suggestions_tenant_immutable
  BEFORE UPDATE OF tenant_id ON connection_suggestions
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable on connection_suggestions'); END;

CREATE TRIGGER IF NOT EXISTS narrative_snapshots_tenant_immutable
  BEFORE UPDATE OF tenant_id ON narrative_snapshots
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable on narrative_snapshots'); END;

CREATE TRIGGER IF NOT EXISTS consolidation_log_tenant_immutable
  BEFORE UPDATE OF tenant_id ON consolidation_log
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN SELECT RAISE(ABORT, 'tenant_id is immutable on consolidation_log'); END;
```

---

## OUTPUT 7: CROSS-PHASE INTEGRATION

### Dependencies

| Phase | What | How |
|-------|------|-----|
| Phase 3 (Cognitive) | decay, freshness, stability, access_tracker | Importance scoring, consolidation archival |
| Phase 4 (Quality) | cascade.ts, conflict.ts, RetractionReason | Self-healing uses cascade penalty + retraction |
| Phase 5 (Health) | health.ts, CognitiveHealthReport | Narrative references health metrics |
| Phase 10 (Governance) | Classification levels | Importance governance weight factor |
| Phase 11 (Vector) | VectorStore.knn, EmbeddingProvider | Consolidation merge + auto-connection |

### Dependents

None — Phase 12 is the final functional phase. Phase 13 (Distributed) and Phase 14 (Brand) are infrastructure/launch.

---

## OUTPUT 8: ASSURANCE MAPPING

| Element | Class | Justification |
|---------|-------|---------------|
| Self-healing threshold enforcement | CONSTITUTIONAL | Below threshold MUST retract, above MUST NOT |
| Self-healing cycle prevention | CONSTITUTIONAL | Visited Set prevents infinite loops |
| Self-healing depth limit | CONSTITUTIONAL | Max depth enforced |
| Self-healing uses valid RetractionReason | CONSTITUTIONAL | Must use 'incorrect', not custom value |
| Consolidation retraction correctness | CONSTITUTIONAL | Winner survives, losers retracted |
| Consolidation relationship creation | CONSTITUTIONAL | Supersedes edge created between winner and loser |
| Consolidation log audit trail | CONSTITUTIONAL | Every operation logged |
| Suggestion lifecycle transitions | CONSTITUTIONAL | pending → accepted/rejected only |
| Importance scoring formula | QUALITY_GATE | 5-factor weighted, tunable |
| Merge similarity threshold | QUALITY_GATE | 0.98 default, configurable |
| Narrative momentum computation | QUALITY_GATE | Statistical, heuristic |
| verify() advisory nature | DESIGN_PRINCIPLE | Never auto-mutates |
| Auto-connection suggestions-only | DESIGN_PRINCIPLE | Never auto-creates relationships |

---

## HONEST LIMITATIONS

1. **Self-healing is heuristic** — threshold 0.1 may be too aggressive or too conservative for some use cases
2. **Consolidation merge requires vectors** — no merge without sqlite-vec
3. **verify() quality depends on LLM** — Limen doesn't validate the LLM's reasoning
4. **Narrative is statistical** — thread detection is clustering, not semantic comprehension
5. **Importance weights are initial defaults** — should be tuned with real usage data
6. **Auto-connection requires embeddings** — degrades to no-op without sqlite-vec

---

*SolisHQ — We innovate, invent, then disrupt.*
