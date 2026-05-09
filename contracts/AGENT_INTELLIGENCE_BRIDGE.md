# Agent Intelligence Bridge Contract v1.2.0

**Status:** RATIFIED DESIGN — Pending Implementation
**Governing:** CDM v2.1 + Contract Compliance v2.1
**QAL:** 3 (agent autonomy substrate — incorrect behavior degrades learning quality)
**Scope:** Technique learning, cognitive health, and self-healing for AI agents
**Contract Hash:** Tracked in `contracts/phase-x.contracts.json`
**Depends:** TGP v1.0, Cognitive Engine, CCP, FSRS Decay Model

**Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

This contract defines how AI agents learn from their work (technique extraction and lifecycle management), maintain cognitive health (consolidation, gap detection, narrative awareness), and self-heal (evidence invalidation cascades, stale knowledge repair, conflict resolution). It builds on the Technique Governance Protocol and Cognitive Engine internals, exposing them through agent-friendly interfaces that enforce governance at every operation boundary. The bridge is the sole sanctioned pathway for agent intelligence operations — direct manipulation of technique claims or cognitive state outside this interface is a governance violation.

---

## 2. Shared Type References

The following types used throughout this contract are defined canonically in `SHARED_TYPES.md`:

| Type | §ection |
|---|---|
| `TGPTechniqueStatus` | §22 |
| `TechniqueProvenanceKind` | §22 |
| `EvaluationSource` | §22 |
| `EvaluationMethod` | §22 |
| `PromotionResult` | §22 |
| `TGPRetiredReason` | §22 |
| `AgentEvent` | §16.1 |
| `AgentEventPayload` | §16.2 |
| `AgentEventHandler` | §16.2 |
| `AgentEventBus` | §16.2 |
| `FreshnessLabel` | §2 (CCP Types) |
| `OperationContext` | §1.3 |
| `Result<T>` | §1.5 |
| `KernelError` | §1.4 |
| `AgentId` | §1.1 |
| `ClaimId` | §1.1 |
| `SessionId` | §1.1 |
| `EvaluationId` | §1.1 |
| `PromotionDecisionId` | §1.1 |
| `KnowledgePackageId` | §4 |
| `TriggerConfigId` | §4 |
| `AgentBranchId` | §4 |
| `AgentCapability` | §6 |

---

## 3. AgentIntelligenceClient Interface

```typescript
interface AgentIntelligenceClient {
  // --- Technique Learning ---
  extractTechnique(ctx: OperationContext, observation: TechniqueObservation): Promise<Result<AgentTechnique>>;
  evaluateTechnique(ctx: OperationContext, techniqueId: ClaimId, evaluation: TechniqueEvaluation): Promise<Result<EvaluationResult>>;
  promoteTechnique(ctx: OperationContext, techniqueId: ClaimId, evidence: TechniquePromotionEvidence): Promise<Result<PromotionDecision>>;
  suspendTechnique(ctx: OperationContext, techniqueId: ClaimId, reason: string): Promise<Result<void>>;
  retireTechnique(ctx: OperationContext, techniqueId: ClaimId, reason: TGPRetiredReason): Promise<Result<void>>;
  getActiveTechniques(ctx: OperationContext, filter?: TechniqueFilter): Promise<Result<AgentTechnique[]>>;
  transferTechnique(ctx: OperationContext, techniqueId: ClaimId, targetAgentId: AgentId): Promise<Result<TransferResult>>;

  // --- Cognitive Health ---
  getHealthReport(ctx: OperationContext): Promise<Result<AgentCognitiveHealth>>;
  consolidate(ctx: OperationContext, options?: ConsolidationOptions): Promise<Result<AgentConsolidationResult>>;
  detectGaps(ctx: OperationContext, domain?: string): Promise<Result<KnowledgeGap[]>>;
  getNarrative(ctx: OperationContext, options?: NarrativeOptions): Promise<Result<AgentNarrative>>;
  getImportanceMap(ctx: OperationContext, options?: ImportanceMapOptions): Promise<Result<ImportanceMap>>;

  // --- Self-Healing ---
  triggerSelfHeal(ctx: OperationContext, options?: SelfHealOptions): Promise<Result<SelfHealReport>>;
  invalidateEvidence(ctx: OperationContext, evidenceId: string, reason: string): Promise<Result<InvalidationCascade>>;
  repairStaleBeliefs(ctx: OperationContext, options?: RepairOptions): Promise<Result<RepairReport>>;
  resolveConflict(ctx: OperationContext, conflictId: string, resolution: ConflictResolutionStrategy): Promise<Result<ConflictResolutionResult>>;

  // --- Events ---
  on(event: IntelligenceEvent, handler: IntelligenceEventHandler): string;
  off(subscriptionId: string): void;
}
```

---

## 4. Technique Learning Data Models

### 4.1 TechniqueObservation

```typescript
interface TechniqueObservation {
  readonly context: string;           // what was the agent doing
  readonly action: string;            // what did the agent do
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly outcomeDetails: string;    // observable result description
  readonly domain: string;            // predicate domain (e.g., 'debugging', 'refactoring')
  readonly confidence: number;        // agent's self-assessed confidence [0.0, 1.0]
  readonly reasoning: string;         // why agent believes this technique works
  readonly relatedClaimIds?: readonly ClaimId[];  // evidence supporting the observation
}
```

### 4.2 AgentTechnique

```typescript
interface AgentTechnique {
  readonly id: ClaimId;
  readonly status: TGPTechniqueStatus;                // See SHARED_TYPES.md §22
  readonly description: string;
  readonly domain: string;
  readonly provenance: TechniqueProvenanceKind;       // See SHARED_TYPES.md §22
  readonly sourceAgentId: AgentId;
  readonly confidence: number;              // raw stored confidence
  readonly effectiveConfidence: number;     // with FSRS decay: R(t) = (1 + t/(9*S))^-1
  readonly evaluationCount: number;
  readonly successRate: number;             // [0.0, 1.0]
  readonly lastEvaluatedAt: string | null;  // ISO-8601
  readonly createdAt: string;               // ISO-8601
  readonly suspendedAt: string | null;      // ISO-8601
  readonly retiredAt: string | null;        // ISO-8601
  readonly retiredReason: TGPRetiredReason | null;   // See SHARED_TYPES.md §22
  readonly transferHistory: readonly TransferRecord[];
}
```

### 4.3 TechniqueEvaluation

```typescript
interface TechniqueEvaluation {
  readonly source: EvaluationSource;    // See SHARED_TYPES.md §22
  readonly method: EvaluationMethod;    // See SHARED_TYPES.md §22
  readonly outcome: 'success' | 'failure' | 'inconclusive';
  readonly confidence: number;      // evaluator's confidence in the evaluation itself [0.0, 1.0]
  readonly context: string;         // what was evaluated and under what conditions
  readonly duration: number;        // execution duration in milliseconds
  readonly notes: string | null;    // optional human-readable notes
}
```

### 4.4 EvaluationResult

```typescript
interface EvaluationResult {
  readonly evaluationId: EvaluationId;
  readonly techniqueId: ClaimId;
  readonly newSuccessRate: number;                    // recalculated after this evaluation
  readonly newConfidence: number;                     // updated confidence
  readonly statusChange: TGPTechniqueStatus | null;  // non-null if evaluation triggers state transition
}
```

### 4.5 TechniquePromotionEvidence

```typescript
interface TechniquePromotionEvidence {
  readonly evaluations: readonly EvaluationId[];  // must reference actual evaluation records
  readonly minimumSuccessRate: number;            // asserted threshold (verified server-side)
  readonly minimumEvaluations: number;            // asserted count (verified server-side)
  readonly reasoning: string;                     // why promotion is warranted
}
```

### 4.6 PromotionDecision

```typescript
interface PromotionDecision {
  readonly id: PromotionDecisionId;
  readonly techniqueId: ClaimId;
  readonly result: PromotionResult;                  // See SHARED_TYPES.md §22
  readonly newStatus: TGPTechniqueStatus;
  readonly reason: string;
  readonly evidence: TechniquePromotionEvidence;
  readonly decidedAt: string;  // ISO-8601
}
```

### 4.7 TechniqueFilter

```typescript
interface TechniqueFilter {
  readonly status?: TGPTechniqueStatus | readonly TGPTechniqueStatus[];
  readonly domain?: string;
  readonly minConfidence?: number;
  readonly minSuccessRate?: number;
  readonly sourceAgentId?: AgentId;
  readonly limit?: number;  // default: 50, max: 200
}
```

### 4.8 TransferResult

```typescript
interface TransferResult {
  readonly techniqueId: ClaimId;        // original technique
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly newClaimId: ClaimId;         // new claim created in target agent's context
  readonly transferredAt: string;       // ISO-8601
  readonly initialConfidence: number;   // capped at 0.5 — transferred knowledge is unproven in new context
}
```

### 4.9 TransferRecord

```typescript
interface TransferRecord {
  readonly fromAgentId: AgentId;
  readonly toAgentId: AgentId;
  readonly transferredAt: string;  // ISO-8601
  readonly confidence: number;     // confidence at time of transfer
}
```

---

## 5. Cognitive Health Data Models

### 5.1 AgentCognitiveHealth

```typescript
interface AgentCognitiveHealth {
  readonly agentId: AgentId;
  readonly reportTimestamp: string;  // ISO-8601
  readonly totalBeliefs: number;
  readonly freshnessDistribution: {
    readonly fresh: number;   // effectiveConfidence > 0.7 of original
    readonly aging: number;   // effectiveConfidence 0.3-0.7 of original
    readonly stale: number;   // effectiveConfidence < 0.3 of original
  };
  readonly conflictState: {
    readonly unresolved: number;
    readonly resolvedLastDay: number;
  };
  readonly knowledgeGaps: readonly string[];  // top 10 gap domains
  readonly techniqueHealth: {
    readonly active: number;
    readonly candidates: number;
    readonly suspended: number;
    readonly averageSuccessRate: number;
  };
  readonly staleBeliefCount: number;
  readonly orphanedEvidenceCount: number;
  readonly overallScore: number;  // 0.0-1.0 composite health score
}
```

**Composite score formula:**

```
overallScore = (freshRatio * 0.3) + (conflictFreeRatio * 0.2) + (techniqueHealthRatio * 0.2) +
               (gapFreeRatio * 0.15) + (orphanFreeRatio * 0.15)
```

### 5.2 ConsolidationOptions

```typescript
interface ConsolidationOptions {
  readonly aggressive?: boolean;            // lower similarity threshold for merging (default: false)
  readonly maxOperations?: number;          // cap on consolidation actions (default: 100)
  readonly domains?: readonly string[];     // limit to specific predicate domains
  readonly dryRun?: boolean;                // report without acting (default: false)
}
```

### 5.3 AgentConsolidationResult

```typescript
interface AgentConsolidationResult {
  readonly merged: number;                              // claims merged (supersedes relationships created)
  readonly archived: number;                            // stale claims archived via retraction
  readonly conflicts: readonly UnresolvedConflict[];    // conflicts found during consolidation
  readonly orphansCleared: number;                      // orphaned evidence removed
  readonly duration: number;                            // milliseconds
}
```

### 5.4 KnowledgeGap

```typescript
interface KnowledgeGap {
  readonly domain: string;
  readonly description: string;
  readonly severity: 'critical' | 'moderate' | 'minor';
  readonly relatedClaims: readonly ClaimId[];    // nearby claims that suggest the gap
  readonly suggestedActions: readonly string[];  // what agent could do to fill the gap
}
```

### 5.5 NarrativeOptions

```typescript
interface NarrativeOptions {
  readonly timeRange?: { readonly from: string; readonly to: string };  // ISO-8601
  readonly domains?: readonly string[];
  readonly maxThreads?: number;  // default: 20, max: 50
}
```

### 5.6 AgentNarrative

```typescript
interface AgentNarrative {
  readonly threads: readonly NarrativeThread[];
  readonly overallMomentum: 'growing' | 'stable' | 'declining';
  readonly dominantDomains: readonly string[];   // top 5 by claim volume
  readonly emergingTopics: readonly string[];    // growing momentum, low claim count
  readonly decliningTopics: readonly string[];   // declining momentum
}
```

### 5.7 NarrativeThread

```typescript
interface NarrativeThread {
  readonly id: string;
  readonly topic: string;
  readonly claimCount: number;
  readonly momentum: 'growing' | 'stable' | 'declining';
  readonly confidence: number;       // average effective confidence of thread claims
  readonly startedAt: string;        // ISO-8601
  readonly lastActivityAt: string;   // ISO-8601
}
```

### 5.8 ImportanceMapOptions

```typescript
interface ImportanceMapOptions {
  readonly domain?: string;
  readonly limit?: number;           // default: 50, max: 200
  readonly includeArchived?: boolean;  // default: false
}
```

### 5.9 ImportanceMap

```typescript
interface ImportanceMap {
  readonly entries: readonly ImportanceEntry[];
  readonly distribution: {
    readonly high: number;    // importance > 0.7
    readonly medium: number;  // importance 0.3-0.7
    readonly low: number;     // importance < 0.3
  };
}
```

### 5.10 ImportanceEntry

```typescript
interface ImportanceEntry {
  readonly claimId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly importance: ImportanceScore;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel;  // See SHARED_TYPES.md §2
}
```

### 5.11 ImportanceScore

Composite score derived from access patterns, relationship density, and recency. Contract-local type — not shared across contracts.

```typescript
interface ImportanceScore {
  readonly value: number;                    // [0.0, 1.0] composite
  readonly accessFrequency: number;          // normalized access count in window
  readonly relationshipDensity: number;      // incoming + outgoing relationships / max
  readonly recencyWeight: number;            // FSRS-derived temporal relevance
}
```

---

## 6. Self-Healing Data Models

### 6.1 SelfHealOptions

```typescript
interface SelfHealOptions {
  readonly scope: 'full' | 'stale_only' | 'conflicts_only' | 'orphans_only';
  readonly maxActions?: number;   // default: 50, max: 500
  readonly dryRun?: boolean;      // default: false
}
```

### 6.2 SelfHealReport

```typescript
interface SelfHealReport {
  readonly triggeredAt: string;          // ISO-8601
  readonly duration: number;             // milliseconds
  readonly actions: readonly SelfHealAction[];
  readonly beliefsRepaired: number;
  readonly conflictsResolved: number;
  readonly orphansCleared: number;
  readonly cascadesTriggered: number;
}
```

### 6.3 SelfHealAction

```typescript
interface SelfHealAction {
  readonly type: SelfHealActionType;
  readonly targetId: ClaimId | string;
  readonly reason: string;
  readonly result: 'success' | 'skipped' | 'failed';
  readonly details: string | null;
}

type SelfHealActionType =
  | 'archive_stale'
  | 'resolve_conflict'
  | 'clear_orphan'
  | 'cascade_invalidation'
  | 'refresh_evidence';
```

### 6.4 InvalidationCascade

```typescript
interface InvalidationCascade {
  readonly sourceEvidenceId: string;
  readonly invalidationReason: string;
  readonly affectedClaims: readonly CascadeAffectedClaim[];
  readonly totalAffected: number;
}
```

### 6.5 CascadeAffectedClaim

```typescript
interface CascadeAffectedClaim {
  readonly claimId: ClaimId;
  readonly effect: 'confidence_reduced' | 'review_flagged' | 'retracted';
  readonly previousConfidence: number;
  readonly newConfidence: number | null;  // null if retracted
}
```

**Cascade rules:**
- Claim with single evidence source: retracted on invalidation
- Claim with multiple evidence sources: confidence reduced proportionally to invalidated evidence weight
- Claim below 0.3 confidence after reduction: flagged for review
- Claim below 0.1 confidence after reduction: auto-retracted

### 6.6 RepairOptions

```typescript
interface RepairOptions {
  readonly maxAge?: number;                  // days since last access (default: 90)
  readonly minConfidence?: number;           // only repair below this threshold (default: 0.3)
  readonly domains?: readonly string[];      // limit to specific domains
  readonly strategy: 'archive' | 'refresh' | 'flag_for_review';
}
```

### 6.7 RepairReport

```typescript
interface RepairReport {
  readonly repairedCount: number;
  readonly archivedCount: number;
  readonly flaggedCount: number;
  readonly refreshedCount: number;
  readonly skippedCount: number;
  readonly duration: number;  // milliseconds
}
```

### 6.8 ConflictResolutionStrategy

```typescript
type ConflictResolutionStrategy =
  | 'confidence_weighted'   // keep claim with higher effective confidence
  | 'temporal_latest'       // keep most recently asserted claim
  | 'manual_keep_first'     // keep claimA, retract claimB
  | 'manual_keep_second'    // keep claimB, retract claimA
  | 'merge_both'            // create new claim synthesizing both, retract originals
  | 'retract_both';         // retract both claims (knowledge is unreliable)
```

### 6.9 ConflictResolutionResult

```typescript
interface ConflictResolutionResult {
  readonly conflictId: string;
  readonly strategy: ConflictResolutionStrategy;
  readonly winner: ClaimId | null;          // null if retract_both
  readonly loser: ClaimId | null;           // null if merge_both
  readonly newClaimId: ClaimId | null;      // non-null only if merge_both
  readonly relationshipCreated: string;     // supersedes or retraction audit record ID
}
```

### 6.10 UnresolvedConflict

```typescript
interface UnresolvedConflict {
  readonly id: string;
  readonly claimA: ClaimId;
  readonly claimB: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly conflictType: 'contradicts' | 'value_mismatch' | 'temporal_overlap';
  readonly detectedAt: string;  // ISO-8601
}
```

---

## 7. Intelligence Events

### 7.1 IntelligenceEvent

A subset of `AgentEvent` values (see `SHARED_TYPES.md` §16.1) relevant to this contract. The unified event bus uses `AgentEvent` as the wire type; this contract filters to the intelligence-domain subset.

```typescript
type IntelligenceEvent =
  | 'technique:extracted'
  | 'technique:evaluated'
  | 'technique:promoted'
  | 'technique:suspended'
  | 'technique:retired'
  | 'technique:transferred'
  | 'cognitive:health_degraded'
  | 'cognitive:consolidation_complete'
  | 'cognitive:gap_detected'
  | 'selfheal:triggered'
  | 'selfheal:cascade'
  | 'selfheal:conflict_resolved'
  | 'selfheal:complete'
  | '*';
```

All values above are members of the `AgentEvent` union in `SHARED_TYPES.md` §16.1. No additional event names are permitted on the wire.

### 7.2 IntelligenceEventHandler

```typescript
type IntelligenceEventHandler = (event: IntelligenceEventPayload) => void | Promise<void>;
```

### 7.3 IntelligenceEventPayload

```typescript
type IntelligenceEventPayload = AgentEventPayload & { readonly type: IntelligenceEvent };
```

Canonical `AgentEventPayload` from `SHARED_TYPES.md` §16.2 with `type` narrowed to `IntelligenceEvent`. The required `auditId` field remains top-level and is never moved into `data`.

### 7.4 Event Emission Guarantees

- Events are emitted **after** the operation commits to storage (not before)
- Event handlers throwing exceptions do not roll back the operation
- Event delivery is best-effort within a session; no cross-session persistence
- The `*` wildcard receives all events; handler must filter by `type` if needed
- `cognitive:health_degraded` fires when `overallScore` drops below 0.5

---

## 8. Error Types

```typescript
type AgentIntelligenceError =
  | { code: 'TECHNIQUE_NOT_FOUND'; techniqueId: ClaimId }
  | { code: 'INVALID_TRANSITION'; currentStatus: TGPTechniqueStatus; requestedTransition: string }
  | { code: 'INSUFFICIENT_EVALUATIONS'; required: number; actual: number }
  | { code: 'BELOW_SUCCESS_THRESHOLD'; required: number; actual: number }
  | { code: 'TRANSFER_DENIED'; reason: string; sourceAgent: AgentId; targetAgent: AgentId }
  | { code: 'TRANSFER_SELF'; agentId: AgentId }
  | { code: 'CONSOLIDATION_FAILED'; reason: string; partialResult: AgentConsolidationResult | null }
  | { code: 'SELF_HEAL_ABORTED'; reason: string; partialReport: SelfHealReport | null }
  | { code: 'CONFLICT_ALREADY_RESOLVED'; conflictId: string }
  | { code: 'CONFLICT_NOT_FOUND'; conflictId: string }
  | { code: 'EVIDENCE_NOT_FOUND'; evidenceId: string }
  | { code: 'DOMAIN_NOT_FOUND'; domain: string }
  | { code: 'GOVERNANCE_REFUSAL'; reason: string; action: string }
  | { code: 'TECHNIQUE_ALREADY_RETIRED'; techniqueId: ClaimId }
  | { code: 'EVALUATION_NOT_FOUND'; evaluationId: EvaluationId }
  | { code: 'MAX_OPERATIONS_EXCEEDED'; limit: number };
```

All errors are returned via `Result<T>` (see `SHARED_TYPES.md` §1.5) — never thrown. The `KernelError` wrapper applies standard error metadata (timestamp, correlationId, tenantId).

---

## 9. Technique Lifecycle State Machine

```
                    +-----------------------------------------------------+
                    |                                                     |
                    |   evaluate (success_rate >= threshold,              |
                    |             eval_count >= minimum,                  |
                    |             confidence >= 0.6)                      |
                    v                                                     |
+-----------+   promoteTechnique()   +--------+                         |
| CANDIDATE +----------------------->| ACTIVE |                         |
+-----+-----+                        +---+-+--+                         |
      |                                  | |                            |
      | retireTechnique()                | | suspendTechnique()         |
      | (candidate_expiry |              | | (success_rate < 0.5 |      |
      |  low_confidence)                 | |  human_flagged)            |
      |                                  | |                            |
      v                                  | v                            |
+---------+<-----------------------------+ +----------+                  |
| RETIRED |<-------------------------------+SUSPENDED +------------------+
+---------+  retireTechnique()            +----------+
             (stale |                       promoteTechnique()
              quarantine_permanent |         (2 new successful evals)
              low_success_rate)
```

**Promotion thresholds (configurable per tenant via TenantConfig):**

| Transition | Minimum Evaluations | Minimum Success Rate | Minimum Confidence |
|---|---|---|---|
| candidate -> active | 3 | 0.70 | 0.60 |
| suspended -> active | 2 (post-suspension) | 0.70 | 0.60 |
| active -> suspended | n/a (triggered) | < 0.50 | n/a |

**Automatic transitions:**
- Candidate with 0 evaluations after 30 days: auto-retired (`candidate_expiry`)
- Active technique with effective confidence below 0.2 (FSRS decay): auto-suspended (`low_confidence`)
- Suspended technique with no new evaluations after 60 days: auto-retired (`stale`)

---

## 10. Rust Trait (v5 Alignment)

Types from `SHARED_TYPES.md` §25 (Rust Equivalents) are used directly. Only contract-local Rust types are defined here.

```rust
use std::future::Future;

// Shared types imported from SHARED_TYPES §25:
// ClaimId, AgentId, EvaluationId, PromotionDecisionId, SessionId,
// TGPTechniqueStatus, TGPRetiredReason, TechniqueProvenanceKind

/// Conflict resolution strategies (contract-local)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictResolutionStrategy {
    ConfidenceWeighted,
    TemporalLatest,
    ManualKeepFirst,
    ManualKeepSecond,
    MergeBoth,
    RetractBoth,
}

/// Self-heal action classification (contract-local)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfHealActionType {
    ArchiveStale,
    ResolveConflict,
    ClearOrphan,
    CascadeInvalidation,
    RefreshEvidence,
}

/// Intelligence bridge errors (contract-local)
#[derive(Debug, Clone)]
pub enum IntelligenceError {
    TechniqueNotFound { technique_id: String },
    InvalidTransition { current_status: TGPTechniqueStatus, requested: String },
    InsufficientEvaluations { required: u32, actual: u32 },
    BelowSuccessThreshold { required: f64, actual: f64 },
    TransferDenied { reason: String, source_agent: String, target_agent: String },
    TransferSelf { agent_id: String },
    ConsolidationFailed { reason: String },
    SelfHealAborted { reason: String },
    ConflictAlreadyResolved { conflict_id: String },
    ConflictNotFound { conflict_id: String },
    EvidenceNotFound { evidence_id: String },
    DomainNotFound { domain: String },
    GovernanceRefusal { reason: String, action: String },
    TechniqueAlreadyRetired { technique_id: String },
    EvaluationNotFound { evaluation_id: String },
    MaxOperationsExceeded { limit: u32 },
}

/// The agent intelligence bridge trait
pub trait AgentIntelligenceBridge: Send + Sync {
    // Technique Learning
    fn extract_technique(
        &self, observation: &TechniqueObservation,
    ) -> impl Future<Output = Result<AgentTechnique, IntelligenceError>> + Send;

    fn evaluate_technique(
        &self, technique_id: &ClaimId, evaluation: &TechniqueEvaluation,
    ) -> impl Future<Output = Result<EvaluationResult, IntelligenceError>> + Send;

    fn promote_technique(
        &self, technique_id: &ClaimId, evidence: &TechniquePromotionEvidence,
    ) -> impl Future<Output = Result<PromotionDecision, IntelligenceError>> + Send;

    fn suspend_technique(
        &self, technique_id: &ClaimId, reason: &str,
    ) -> impl Future<Output = Result<(), IntelligenceError>> + Send;

    fn retire_technique(
        &self, technique_id: &ClaimId, reason: TGPRetiredReason,
    ) -> impl Future<Output = Result<(), IntelligenceError>> + Send;

    fn get_active_techniques(
        &self, filter: Option<&TechniqueFilter>,
    ) -> impl Future<Output = Result<Vec<AgentTechnique>, IntelligenceError>> + Send;

    fn transfer_technique(
        &self, technique_id: &ClaimId, target_agent_id: &AgentId,
    ) -> impl Future<Output = Result<TransferResult, IntelligenceError>> + Send;

    // Cognitive Health
    fn get_health_report(
        &self,
    ) -> impl Future<Output = Result<AgentCognitiveHealth, IntelligenceError>> + Send;

    fn consolidate(
        &self, options: Option<&ConsolidationOptions>,
    ) -> impl Future<Output = Result<AgentConsolidationResult, IntelligenceError>> + Send;

    fn detect_gaps(
        &self, domain: Option<&str>,
    ) -> impl Future<Output = Result<Vec<KnowledgeGap>, IntelligenceError>> + Send;

    fn get_narrative(
        &self, options: Option<&NarrativeOptions>,
    ) -> impl Future<Output = Result<AgentNarrative, IntelligenceError>> + Send;

    fn get_importance_map(
        &self, options: Option<&ImportanceMapOptions>,
    ) -> impl Future<Output = Result<ImportanceMap, IntelligenceError>> + Send;

    // Self-Healing
    fn trigger_self_heal(
        &self, options: Option<&SelfHealOptions>,
    ) -> impl Future<Output = Result<SelfHealReport, IntelligenceError>> + Send;

    fn invalidate_evidence(
        &self, evidence_id: &str, reason: &str,
    ) -> impl Future<Output = Result<InvalidationCascade, IntelligenceError>> + Send;

    fn repair_stale_beliefs(
        &self, options: Option<&RepairOptions>,
    ) -> impl Future<Output = Result<RepairReport, IntelligenceError>> + Send;

    fn resolve_conflict(
        &self, conflict_id: &str, strategy: ConflictResolutionStrategy,
    ) -> impl Future<Output = Result<ConflictResolutionResult, IntelligenceError>> + Send;
}
```

---

## 11. Integration Map

| Client Method | Limen Internal | Protocol | Notes |
|---|---|---|---|
| `extractTechnique` | §C-11 (assert_claim) with `technique.*` predicate | TGP S4 | Creates claim with status=candidate |
| `evaluateTechnique` | TGP evaluation record + confidence update via SC-14 | TGP S6 | Updates success_rate, may trigger transition |
| `promoteTechnique` | TGP promotion decision + SC-11 status claim + SC-12 supersedes edge | TGP S7 | Verifies thresholds server-side |
| `suspendTechnique` | §C-11 status claim + SC-12 supersedes edge | TGP S5 (I2) | Records suspension reason |
| `retireTechnique` | §C-11 terminal status claim + SC-12 supersedes edge | TGP S5 (I2) | Irreversible |
| `getActiveTechniques` | §C-13 (query_claims) with technique filter | TGP + CCP | Filtered by agent context |
| `transferTechnique` | §C-11 (new claim in target) + relationship | TGP S8 | Confidence capped at 0.5 |
| `getHealthReport` | Cognitive Engine health scan (read-only aggregation) | Cognitive S3 | Point-in-time snapshot |
| `consolidate` | Cognitive Engine merge + SC-12 `relate_claims` | Cognitive S4 | Creates supersedes relationships |
| `detectGaps` | Cognitive Engine gap analysis (predicate coverage) | Cognitive S5 | Advisory only |
| `getNarrative` | Cognitive Engine thread construction from relationships | Cognitive S6 | Derived from claim graph |
| `getImportanceMap` | ImportanceScore computation per claim | Cognitive S7 | Uses access patterns + graph |
| `triggerSelfHeal` | Cascade + repair + conflict resolution pipeline | CCP + Cognitive | Composite operation |
| `invalidateEvidence` | Evidence retraction -> cascade to dependent claims | CCP S9 | Deterministic cascade |
| `repairStaleBeliefs` | Bulk archive/refresh of aged claims via FSRS check | CCP + FSRS | §trategy-dependent behavior |
| `resolveConflict` | §C-12 `relate_claims` (supersedes) + optional `retract_claim` | CCP S8 | Creates audit trail |

---

## 12. Invariants

1. **Techniques are claims.** All CCP invariants apply: confidence ceiling without evidence (0.7), FSRS temporal decay, classification inheritance from tenant defaults, immutable audit history.

2. **State machine is law.** Status transitions follow Section 9 exactly. No state can be skipped. Implementation must reject invalid transitions with `INVALID_TRANSITION` error.

3. **Promotion is gated.** Promotion requires minimum evaluation count AND success rate AND confidence threshold. All three verified server-side regardless of client assertions in `TechniquePromotionEvidence`.

4. **Transfer reduces confidence.** Transferred techniques receive initial confidence of `min(0.5, source_confidence * 0.5)`. Transferred knowledge is unproven in the new agent's operational context.

5. **Self-healing never deletes.** Only archives (retract with reason), flags for review, or refreshes. No physical deletion of claims or evidence. Audit trail is permanent.

6. **Consolidation is idempotent.** Running consolidation twice with identical state produces the same result. Merged claims carry `supersedes` relationships to originals.

7. **Cascade determinism.** Evidence invalidation cascades are deterministic: given the same claim graph state and the same invalidated evidence, the cascade produces the identical affected set.

8. **Health reports are snapshots.** `getHealthReport` computes at call time. No caching. No stale data. Two sequential calls may differ if operations occurred between them.

9. **Conflict resolution is audited.** Every resolution creates a relationship record (supersedes or retraction) with the strategy and reasoning recorded. No silent resolution.

10. **Gap detection is advisory.** Gaps suggest actions but do not mandate them. No automatic claim creation from gap detection. Agent decides what to act on.

11. **Session and governance scope.** All operations require valid `OperationContext` (see `SHARED_TYPES.md` §1.3). Governance (clearanceLevel, permissions) is checked before every mutating operation. Read operations require `query_claims`; technique mutation requires `assert_claim`; cognitive administration requires `manage_cognitive`.

12. **Narrative threads are derived.** Threads are computed from claim relationships and temporal clustering. They are not separately stored entities. No thread CRUD — threads exist as query results.

---

## 13. Governance Gates

| Operation | Required Permission | Clearance Level | Audit |
|---|---|---|---|
| extractTechnique | `assert_claim` + `query_claims` | unrestricted | `technique:extracted` |
| evaluateTechnique | `assert_claim` + `query_claims` | unrestricted | `technique:evaluated` |
| promoteTechnique | `assert_claim` + `relate_claims` | internal | `technique:promoted` |
| suspendTechnique | `assert_claim` | internal | `technique:suspended` |
| retireTechnique | `retract_claim` + `assert_claim` | internal | `technique:retired` |
| transferTechnique | `query_claims` + `assert_claim` + `relate_claims` | confidential | `technique:transferred` |
| consolidate | `manage_cognitive` + `query_claims` | internal | `cognitive:consolidation_complete` |
| triggerSelfHeal | `manage_cognitive` | confidential | `selfheal:triggered` |
| invalidateEvidence | `manage_cognitive` + `retract_claim` | confidential | `selfheal:cascade` |
| resolveConflict | `manage_cognitive` + `relate_claims` | internal | `selfheal:conflict_resolved` |
| getHealthReport | `manage_cognitive` | unrestricted | none |
| detectGaps | `manage_cognitive` + `query_claims` | unrestricted | none |
| getNarrative | `manage_cognitive` + `query_claims` | unrestricted | none |
| getImportanceMap | `manage_cognitive` + `query_claims` | unrestricted | none |
| getActiveTechniques | `query_claims` | unrestricted | none |

---

## 14. Concurrency and Ordering

- **Technique status transitions** are serialized per technique (optimistic locking on version field). Concurrent promotions of the same technique: first wins, second gets `INVALID_TRANSITION`.
- **Consolidation** acquires a domain-level advisory lock. Only one consolidation per domain per tenant at a time. Second attempt returns `CONSOLIDATION_FAILED` with reason `concurrent_consolidation`.
- **Self-heal** acquires agent-level advisory lock. One heal per agent at a time.
- **Event emission** is ordered within a session. Cross-session ordering is not guaranteed.
- **Evidence invalidation cascades** execute atomically — all affected claims are updated in a single transaction. Partial cascade is never visible.

---

## 15. Performance Constraints

| Operation | Target Latency (p95) | Max Batch Size |
|---|---|---|
| extractTechnique | 50ms | 1 |
| evaluateTechnique | 30ms | 1 |
| getActiveTechniques | 100ms | 200 results |
| getHealthReport | 200ms | n/a |
| consolidate | 5000ms | 100 operations |
| triggerSelfHeal | 10000ms | 500 actions |
| invalidateEvidence | 500ms | cascade depth 10 |
| detectGaps | 300ms | n/a |
| getNarrative | 500ms | 50 threads |

---

## 16. Testing Requirements

| Category | Requirement |
|---|---|
| Unit | Every state transition edge in Section 9 tested (valid + invalid) |
| Unit | Every error code in Section 8 has a trigger test |
| Unit | FSRS decay calculation verified against reference implementation |
| Unit | Cascade determinism: same graph + same invalidation = same result (property test) |
| Integration | Full technique lifecycle: extract -> evaluate x3 -> promote -> suspend -> evaluate x2 -> reactivate |
| Integration | Transfer lifecycle: extract -> promote -> transfer -> evaluate in new context -> promote |
| Integration | §elf-heal pipeline: seed stale claims -> trigger heal -> verify archives + cascades |
| Integration | Conflict detection and resolution with all 6 strategies |
| Property | Consolidation idempotency (fast-check) |
| Property | §tate machine never enters invalid state under random operation sequences |
| Property | Health score always in [0.0, 1.0] regardless of input distribution |
| Mutation | All invariants independently killable — no surviving mutants on governance checks <!-- R2-47: Mutation testing results should reference specific Stryker reports. Without a linked report, this claim is aspirational. Verify via `npx stryker run` and record the mutation score. --> |

---

## 17. Migration Path

This contract targets Limen v5+ (Rust engine). Implementation sequence:

1. **Phase 1:** Technique Learning (extractTechnique, evaluateTechnique, promoteTechnique, suspendTechnique, retireTechnique, getActiveTechniques)
2. **Phase 2:** Technique Transfer (transferTechnique + cross-agent claim creation)
3. **Phase 3:** Cognitive Health (getHealthReport, consolidate, detectGaps, getNarrative, getImportanceMap)
4. **Phase 4:** Self-Healing (triggerSelfHeal, invalidateEvidence, repairStaleBeliefs, resolveConflict)
5. **Phase 5:** Events (subscription system, all event types, handler lifecycle)

Each phase is independently testable and deployable. Phases 1-2 depend on TGP storage schema. Phases 3-4 depend on Cognitive Engine internals. Phase 5 depends on the unified `AgentEventBus`.

---

*End of contract.*
