# Limen v5 -- AGENT_INTELLIGENCE_BRIDGE.md Requirement Extraction

**Source:** `contracts/AGENT_INTELLIGENCE_BRIDGE.md` v1.2.0
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the Agent Intelligence Bridge contract.

---

## Section 1: Purpose & Scope

| ID | Requirement | Source |
|---|---|---|
| IB-1.1 | Contract scope covers technique learning, cognitive health, and self-healing for AI agents | S1 |
| IB-1.2 | Contract classification is QAL-3 (agent autonomy substrate) | Header |
| IB-1.3 | The bridge is the sole sanctioned pathway for agent intelligence operations | S1 |
| IB-1.4 | Direct manipulation of technique claims or cognitive state outside this interface is a governance violation | S1 |
| IB-1.5 | Contract builds on TGP v1.0, Cognitive Engine, CCP, and FSRS Decay Model | Header Depends |

**Totals: 5 requirements**

---

## Section 2: Shared Type References

| ID | Requirement | Source |
|---|---|---|
| IB-2.1 | Implementation MUST use all shared types from SHARED_TYPES.md listed in S2 table without redefinition: `TGPTechniqueStatus`, `TechniqueProvenanceKind`, `EvaluationSource`, `EvaluationMethod`, `PromotionResult`, `TGPRetiredReason`, `AgentEvent`, `AgentEventPayload`, `AgentEventHandler`, `AgentEventBus`, `FreshnessLabel`, `OperationContext`, `Result<T>`, `KernelError`, `AgentId`, `ClaimId`, `SessionId`, `EvaluationId`, `PromotionDecisionId`, `KnowledgePackageId`, `TriggerConfigId`, `AgentBranchId`, `AgentCapability` | S2 |

**Totals: 1 requirement**

---

## Section 3: AgentIntelligenceClient Interface

| ID | Requirement | Source |
|---|---|---|
| IB-3.1 | `extractTechnique(ctx: OperationContext, observation: TechniqueObservation)` MUST return `Promise<Result<AgentTechnique>>` | S3 |
| IB-3.2 | `evaluateTechnique(ctx: OperationContext, techniqueId: ClaimId, evaluation: TechniqueEvaluation)` MUST return `Promise<Result<EvaluationResult>>` | S3 |
| IB-3.3 | `promoteTechnique(ctx: OperationContext, techniqueId: ClaimId, evidence: TechniquePromotionEvidence)` MUST return `Promise<Result<PromotionDecision>>` | S3 |
| IB-3.4 | `suspendTechnique(ctx: OperationContext, techniqueId: ClaimId, reason: string)` MUST return `Promise<Result<void>>` | S3 |
| IB-3.5 | `retireTechnique(ctx: OperationContext, techniqueId: ClaimId, reason: TGPRetiredReason)` MUST return `Promise<Result<void>>` | S3 |
| IB-3.6 | `getActiveTechniques(ctx: OperationContext, filter?: TechniqueFilter)` MUST return `Promise<Result<AgentTechnique[]>>` | S3 |
| IB-3.7 | `transferTechnique(ctx: OperationContext, techniqueId: ClaimId, targetAgentId: AgentId)` MUST return `Promise<Result<TransferResult>>` | S3 |
| IB-3.8 | `getHealthReport(ctx: OperationContext)` MUST return `Promise<Result<AgentCognitiveHealth>>` | S3 |
| IB-3.9 | `consolidate(ctx: OperationContext, options?: ConsolidationOptions)` MUST return `Promise<Result<AgentConsolidationResult>>` | S3 |
| IB-3.10 | `detectGaps(ctx: OperationContext, domain?: string)` MUST return `Promise<Result<KnowledgeGap[]>>` | S3 |
| IB-3.11 | `getNarrative(ctx: OperationContext, options?: NarrativeOptions)` MUST return `Promise<Result<AgentNarrative>>` | S3 |
| IB-3.12 | `getImportanceMap(ctx: OperationContext, options?: ImportanceMapOptions)` MUST return `Promise<Result<ImportanceMap>>` | S3 |
| IB-3.13 | `triggerSelfHeal(ctx: OperationContext, options?: SelfHealOptions)` MUST return `Promise<Result<SelfHealReport>>` | S3 |
| IB-3.14 | `invalidateEvidence(ctx: OperationContext, evidenceId: string, reason: string)` MUST return `Promise<Result<InvalidationCascade>>` | S3 |
| IB-3.15 | `repairStaleBeliefs(ctx: OperationContext, options?: RepairOptions)` MUST return `Promise<Result<RepairReport>>` | S3 |
| IB-3.16 | `resolveConflict(ctx: OperationContext, conflictId: string, resolution: ConflictResolutionStrategy)` MUST return `Promise<Result<ConflictResolutionResult>>` | S3 |
| IB-3.17 | `on(event: IntelligenceEvent, handler: IntelligenceEventHandler)` MUST return subscription ID `string` | S3 |
| IB-3.18 | `off(subscriptionId: string)` MUST unsubscribe the handler | S3 |

**Totals: 18 requirements**

---

## Section 4: Technique Learning Data Models

| ID | Requirement | Source |
|---|---|---|
| IB-4.1 | `TechniqueObservation.context` MUST be string describing what agent was doing | S4.1 |
| IB-4.2 | `TechniqueObservation.action` MUST be string describing what agent did | S4.1 |
| IB-4.3 | `TechniqueObservation.outcome` MUST be `'success' | 'failure' | 'partial'` | S4.1 |
| IB-4.4 | `TechniqueObservation.outcomeDetails` MUST be string describing observable result | S4.1 |
| IB-4.5 | `TechniqueObservation.domain` MUST be predicate domain string | S4.1 |
| IB-4.6 | `TechniqueObservation.confidence` MUST be agent's self-assessed confidence [0.0, 1.0] | S4.1 |
| IB-4.7 | `TechniqueObservation.reasoning` MUST be string explaining why technique works | S4.1 |
| IB-4.8 | `TechniqueObservation.relatedClaimIds` MUST be optional `readonly ClaimId[]` | S4.1 |
| IB-4.9 | `AgentTechnique.id` MUST be `ClaimId` | S4.2 |
| IB-4.10 | `AgentTechnique.status` MUST be `TGPTechniqueStatus` | S4.2 |
| IB-4.11 | `AgentTechnique.provenance` MUST be `TechniqueProvenanceKind` | S4.2 |
| IB-4.12 | `AgentTechnique.effectiveConfidence` MUST use FSRS decay: `R(t) = (1 + t/(9*S))^-1` | S4.2 |
| IB-4.13 | `AgentTechnique` MUST include `description`, `domain`, `sourceAgentId`, `confidence`, `evaluationCount`, `successRate`, `lastEvaluatedAt`, `createdAt`, `suspendedAt`, `retiredAt`, `retiredReason`, `transferHistory` | S4.2 |
| IB-4.14 | `TechniqueEvaluation.source` MUST be `EvaluationSource` from SHARED_TYPES | S4.3 |
| IB-4.15 | `TechniqueEvaluation.method` MUST be `EvaluationMethod` from SHARED_TYPES | S4.3 |
| IB-4.16 | `TechniqueEvaluation.outcome` MUST be `'success' | 'failure' | 'inconclusive'` | S4.3 |
| IB-4.17 | `TechniqueEvaluation.confidence` MUST be evaluator's confidence in the evaluation [0.0, 1.0] | S4.3 |
| IB-4.18 | `TechniqueEvaluation` MUST include `context`, `duration` (ms), `notes` (nullable) | S4.3 |
| IB-4.19 | `EvaluationResult` MUST include `evaluationId`, `techniqueId`, `newSuccessRate`, `newConfidence`, `statusChange` (nullable) | S4.4 |
| IB-4.20 | `TechniquePromotionEvidence.evaluations` MUST reference actual evaluation records (verified server-side) | S4.5 |
| IB-4.21 | `TechniquePromotionEvidence.minimumSuccessRate` and `minimumEvaluations` MUST be asserted by client but verified server-side | S4.5 |
| IB-4.22 | `TechniquePromotionEvidence.reasoning` MUST be string explaining why promotion warranted | S4.5 |
| IB-4.23 | `PromotionDecision` MUST include `id` (`PromotionDecisionId`), `techniqueId`, `result` (`PromotionResult`), `newStatus`, `reason`, `evidence`, `decidedAt` | S4.6 |
| IB-4.24 | `TechniqueFilter` MUST support optional `status`, `domain`, `minConfidence`, `minSuccessRate`, `sourceAgentId`, `limit` (default 50, max 200) | S4.7 |
| IB-4.25 | `TransferResult` MUST include `techniqueId`, `sourceAgentId`, `targetAgentId`, `newClaimId`, `transferredAt`, `initialConfidence` | S4.8 |
| IB-4.26 | `TransferResult.initialConfidence` MUST be capped at 0.5 -- transferred knowledge is unproven in new context | S4.8 |
| IB-4.27 | `TransferRecord` MUST include `fromAgentId`, `toAgentId`, `transferredAt`, `confidence` (at time of transfer) | S4.9 |
| IB-4.28 | `TechniqueFilter.status` MUST accept single `TGPTechniqueStatus` or array `readonly TGPTechniqueStatus[]` | S4.7 |
| IB-4.29 | `AgentTechnique.successRate` MUST be in [0.0, 1.0] | S4.2 |
| IB-4.30 | `AgentTechnique.lastEvaluatedAt` MUST be `string | null` (ISO-8601) | S4.2 |
| IB-4.31 | `AgentTechnique.retiredReason` MUST be `TGPRetiredReason | null` | S4.2 |
| IB-4.32 | `AgentTechnique.transferHistory` MUST be `readonly TransferRecord[]` | S4.2 |

**Totals: 32 requirements**

---

## Section 5: Cognitive Health Data Models

| ID | Requirement | Source |
|---|---|---|
| IB-5.1 | `AgentCognitiveHealth.agentId` MUST be `AgentId` | S5.1 |
| IB-5.2 | `AgentCognitiveHealth.reportTimestamp` MUST be ISO-8601 | S5.1 |
| IB-5.3 | `AgentCognitiveHealth.totalBeliefs` MUST be number | S5.1 |
| IB-5.4 | `freshnessDistribution.fresh` MUST count beliefs where effectiveConfidence > 0.7 of original | S5.1 |
| IB-5.5 | `freshnessDistribution.aging` MUST count beliefs where effectiveConfidence 0.3-0.7 of original | S5.1 |
| IB-5.6 | `freshnessDistribution.stale` MUST count beliefs where effectiveConfidence < 0.3 of original | S5.1 |
| IB-5.7 | `conflictState` MUST include `unresolved` and `resolvedLastDay` counts | S5.1 |
| IB-5.8 | `knowledgeGaps` MUST be top 10 gap domains | S5.1 |
| IB-5.9 | `techniqueHealth` MUST include `active`, `candidates`, `suspended` counts and `averageSuccessRate` | S5.1 |
| IB-5.10 | `overallScore` MUST be composite health score in [0.0, 1.0] | S5.1 |
| IB-5.11 | Composite score formula MUST be: `(freshRatio * 0.3) + (conflictFreeRatio * 0.2) + (techniqueHealthRatio * 0.2) + (gapFreeRatio * 0.15) + (orphanFreeRatio * 0.15)` | S5.1 Formula |
| IB-5.12 | `ConsolidationOptions` MUST support `aggressive` (boolean, default false), `maxOperations` (default 100), `domains` (optional), `dryRun` (default false) | S5.2 |
| IB-5.13 | `AgentConsolidationResult` MUST include `merged`, `archived`, `conflicts`, `orphansCleared`, `duration` (ms) | S5.3 |
| IB-5.14 | `KnowledgeGap` MUST include `domain`, `description`, `severity` (`'critical' | 'moderate' | 'minor'`), `relatedClaims`, `suggestedActions` | S5.4 |
| IB-5.15 | `NarrativeOptions.timeRange` MUST be optional `{ from: string; to: string }` ISO-8601 | S5.5 |
| IB-5.16 | `NarrativeOptions.domains` MUST be optional `readonly string[]` | S5.5 |
| IB-5.17 | `NarrativeOptions.maxThreads` MUST be optional, default 20, max 50 | S5.5 |
| IB-5.18 | `AgentNarrative.threads` MUST be `readonly NarrativeThread[]` | S5.6 |
| IB-5.19 | `AgentNarrative.overallMomentum` MUST be `'growing' | 'stable' | 'declining'` | S5.6 |
| IB-5.20 | `AgentNarrative` MUST include `dominantDomains` (top 5), `emergingTopics`, `decliningTopics` | S5.6 |
| IB-5.21 | `NarrativeThread` MUST include `id`, `topic`, `claimCount`, `momentum`, `confidence` (average effective), `startedAt`, `lastActivityAt` | S5.7 |
| IB-5.22 | `ImportanceMapOptions` MUST support optional `domain`, `limit` (default 50, max 200), `includeArchived` (default false) | S5.8 |
| IB-5.23 | `ImportanceMap.entries` MUST be `readonly ImportanceEntry[]` | S5.9 |
| IB-5.24 | `ImportanceMap.distribution` MUST include counts for high (>0.7), medium (0.3-0.7), low (<0.3) | S5.9 |
| IB-5.25 | `ImportanceEntry` MUST include `claimId`, `subject`, `predicate`, `importance` (ImportanceScore), `effectiveConfidence`, `freshness` | S5.10 |
| IB-5.26 | `ImportanceScore.value` MUST be composite in [0.0, 1.0] | S5.11 |
| IB-5.27 | `ImportanceScore` MUST include `accessFrequency`, `relationshipDensity`, `recencyWeight` (FSRS-derived) | S5.11 |
| IB-5.28 | `AgentCognitiveHealth` MUST include `staleBeliefCount` and `orphanedEvidenceCount` | S5.1 |

**Totals: 28 requirements**

---

## Section 6: Self-Healing Data Models

| ID | Requirement | Source |
|---|---|---|
| IB-6.1 | `SelfHealOptions.scope` MUST be `'full' | 'stale_only' | 'conflicts_only' | 'orphans_only'` | S6.1 |
| IB-6.2 | `SelfHealOptions.maxActions` MUST be optional, default 50, max 500 | S6.1 |
| IB-6.3 | `SelfHealOptions.dryRun` MUST be optional boolean, default false | S6.1 |
| IB-6.4 | `SelfHealReport` MUST include `triggeredAt`, `duration`, `actions`, `beliefsRepaired`, `conflictsResolved`, `orphansCleared`, `cascadesTriggered` | S6.2 |
| IB-6.5 | `SelfHealAction.type` MUST be `SelfHealActionType` | S6.3 |
| IB-6.6 | `SelfHealActionType` MUST be `'archive_stale' | 'resolve_conflict' | 'clear_orphan' | 'cascade_invalidation' | 'refresh_evidence'` | S6.3 |
| IB-6.7 | `SelfHealAction.result` MUST be `'success' | 'skipped' | 'failed'` | S6.3 |
| IB-6.8 | `InvalidationCascade` MUST include `sourceEvidenceId`, `invalidationReason`, `affectedClaims`, `totalAffected` | S6.4 |
| IB-6.9 | `CascadeAffectedClaim.effect` MUST be `'confidence_reduced' | 'review_flagged' | 'retracted'` | S6.5 |
| IB-6.10 | Claim with single evidence source MUST be retracted on invalidation | S6 Cascade Rules |
| IB-6.11 | Claim with multiple evidence sources MUST have confidence reduced proportionally to invalidated evidence weight | S6 Cascade Rules |
| IB-6.12 | Claim below 0.3 confidence after reduction MUST be flagged for review | S6 Cascade Rules |
| IB-6.13 | Claim below 0.1 confidence after reduction MUST be auto-retracted | S6 Cascade Rules |
| IB-6.14 | `RepairOptions` MUST include `maxAge` (days, default 90), `minConfidence` (default 0.3), `domains` (optional), `strategy` (required) | S6.6 |
| IB-6.15 | `RepairOptions.strategy` MUST be `'archive' | 'refresh' | 'flag_for_review'` | S6.6 |
| IB-6.16 | `RepairReport` MUST include `repairedCount`, `archivedCount`, `flaggedCount`, `refreshedCount`, `skippedCount`, `duration` (ms) | S6.7 |
| IB-6.17 | `ConflictResolutionStrategy` MUST be `'confidence_weighted' | 'temporal_latest' | 'manual_keep_first' | 'manual_keep_second' | 'merge_both' | 'retract_both'` | S6.8 |
| IB-6.18 | `ConflictResolutionResult` MUST include `conflictId`, `strategy`, `winner` (nullable), `loser` (nullable), `newClaimId` (nullable, only for merge_both), `relationshipCreated` | S6.9 |
| IB-6.19 | `UnresolvedConflict` MUST include `id`, `claimA`, `claimB`, `subject`, `predicate`, `conflictType`, `detectedAt` | S6.10 |
| IB-6.20 | `UnresolvedConflict.conflictType` MUST be `'contradicts' | 'value_mismatch' | 'temporal_overlap'` | S6.10 |
| IB-6.21 | `CascadeAffectedClaim` MUST include `claimId`, `effect`, `previousConfidence`, `newConfidence` (null if retracted) | S6.5 |
| IB-6.22 | `SelfHealAction` MUST include `targetId` (`ClaimId | string`), `reason`, `details` (nullable) | S6.3 |
| IB-6.23 | `AgentConsolidationResult.conflicts` MUST be `readonly UnresolvedConflict[]` | S5.3 |
| IB-6.24 | `ConflictResolutionResult.winner` is null if `retract_both`; `loser` is null if `merge_both` | S6.9 |

**Totals: 24 requirements**

---

## Section 7: Intelligence Events

| ID | Requirement | Source |
|---|---|---|
| IB-7.1 | `IntelligenceEvent` MUST include 14 event types: `technique:extracted`, `technique:evaluated`, `technique:promoted`, `technique:suspended`, `technique:retired`, `technique:transferred`, `cognitive:health_degraded`, `cognitive:consolidation_complete`, `cognitive:gap_detected`, `selfheal:triggered`, `selfheal:cascade`, `selfheal:conflict_resolved`, `selfheal:complete`, `*` | S7.1 |
| IB-7.2 | All `IntelligenceEvent` values MUST be members of the `AgentEvent` union in SHARED_TYPES; no additional event names permitted on wire | S7.1 |
| IB-7.3 | `IntelligenceEventHandler` MUST be `(event: IntelligenceEventPayload) => void | Promise<void>` | S7.2 |
| IB-7.4 | `IntelligenceEventPayload` MUST be `AgentEventPayload & { readonly type: IntelligenceEvent }` | S7.3 |
| IB-7.5 | Events MUST be emitted AFTER the operation commits to storage (not before) | S7.4 |
| IB-7.6 | Event handlers throwing exceptions MUST NOT roll back the operation | S7.4 |
| IB-7.7 | `*` wildcard MUST receive all events; handler must filter by `type` if needed | S7.4 |
| IB-7.8 | `cognitive:health_degraded` MUST fire when `overallScore` drops below 0.5 | S7.4 |
| IB-7.9 | Event delivery is best-effort within a session; no cross-session persistence of undelivered events | S7.4 |

**Totals: 9 requirements**

---

## Section 8: Error Types

| ID | Requirement | Source |
|---|---|---|
| IB-8.1 | Error code `TECHNIQUE_NOT_FOUND` MUST include `techniqueId: ClaimId` | S8 |
| IB-8.2 | Error code `INVALID_TRANSITION` MUST include `currentStatus: TGPTechniqueStatus` and `requestedTransition: string` | S8 |
| IB-8.3 | Error code `INSUFFICIENT_EVALUATIONS` MUST include `required` and `actual` numbers | S8 |
| IB-8.4 | Error code `BELOW_SUCCESS_THRESHOLD` MUST include `required` and `actual` numbers | S8 |
| IB-8.5 | Error code `TRANSFER_DENIED` MUST include `reason`, `sourceAgent`, `targetAgent` | S8 |
| IB-8.6 | Error code `TRANSFER_SELF` MUST include `agentId` (cannot transfer to self) | S8 |
| IB-8.7 | Error code `CONSOLIDATION_FAILED` MUST include `reason` and `partialResult` (nullable) | S8 |
| IB-8.8 | Error code `SELF_HEAL_ABORTED` MUST include `reason` and `partialReport` (nullable) | S8 |
| IB-8.9 | Error code `CONFLICT_ALREADY_RESOLVED` MUST include `conflictId` | S8 |
| IB-8.10 | Error code `CONFLICT_NOT_FOUND` MUST include `conflictId` | S8 |
| IB-8.11 | Error code `EVIDENCE_NOT_FOUND` MUST include `evidenceId` | S8 |
| IB-8.12 | Error code `DOMAIN_NOT_FOUND` MUST include `domain` | S8 |
| IB-8.13 | Error code `GOVERNANCE_REFUSAL` MUST include `reason` and `action` | S8 |
| IB-8.14 | Error code `TECHNIQUE_ALREADY_RETIRED` MUST include `techniqueId` | S8 |
| IB-8.15 | Error code `EVALUATION_NOT_FOUND` MUST include `evaluationId` | S8 |
| IB-8.16 | Error code `MAX_OPERATIONS_EXCEEDED` MUST include `limit` | S8 |
| IB-8.17 | All errors MUST be returned via `Result<T>` (never thrown); `KernelError` wrapper applies standard error metadata | S8 |

**Totals: 17 requirements**

---

## Section 9: Technique Lifecycle State Machine

| ID | Requirement | Source |
|---|---|---|
| IB-9.1 | State machine MUST have exactly 4 states: CANDIDATE, ACTIVE, SUSPENDED, RETIRED | S9 |
| IB-9.2 | Transition CANDIDATE -> ACTIVE requires `promoteTechnique()` with minimum evaluations (3), success rate (0.70), confidence (0.60) | S9 |
| IB-9.3 | Transition ACTIVE -> SUSPENDED triggered when success_rate < 0.50 or human_flagged | S9 |
| IB-9.4 | Transition SUSPENDED -> ACTIVE requires `promoteTechnique()` with 2 new successful post-suspension evaluations | S9 |
| IB-9.5 | Transition CANDIDATE -> RETIRED via `retireTechnique()` with reasons `candidate_expiry` or `low_confidence` | S9 |
| IB-9.6 | Transition ACTIVE -> RETIRED via SUSPENDED -> RETIRED with reasons `stale`, `quarantine_permanent`, `low_success_rate` | S9 |
| IB-9.7 | Transition SUSPENDED -> RETIRED via `retireTechnique()` with reasons `stale`, `quarantine_permanent`, `low_success_rate` | S9 |
| IB-9.8 | RETIRED is a terminal state -- no transitions out | S9 |
| IB-9.9 | Auto-transition: Candidate with 0 evaluations after 30 days MUST auto-retire (`candidate_expiry`) | S9 Auto |
| IB-9.10 | Auto-transition: Active technique with effective confidence below 0.2 (FSRS decay) MUST auto-suspend (`low_confidence`) | S9 Auto |
| IB-9.11 | Auto-transition: Suspended technique with no new evaluations after 60 days MUST auto-retire (`stale`) | S9 Auto |

**Totals: 11 requirements**

---

## Section 10: Rust Trait -- AgentIntelligenceBridge

| ID | Requirement | Source |
|---|---|---|
| IB-10.1 | Rust trait `AgentIntelligenceBridge` MUST be `Send + Sync` | S10 |
| IB-10.2 | `extract_technique` MUST accept `&TechniqueObservation` and return `Result<AgentTechnique, IntelligenceError>` | S10 |
| IB-10.3 | `evaluate_technique` MUST accept `&ClaimId`, `&TechniqueEvaluation` and return `Result<EvaluationResult, IntelligenceError>` | S10 |
| IB-10.4 | `promote_technique` MUST accept `&ClaimId`, `&TechniquePromotionEvidence` and return `Result<PromotionDecision, IntelligenceError>` | S10 |
| IB-10.5 | `suspend_technique` MUST accept `&ClaimId`, `&str` reason and return `Result<(), IntelligenceError>` | S10 |
| IB-10.6 | `retire_technique` MUST accept `&ClaimId`, `TGPRetiredReason` and return `Result<(), IntelligenceError>` | S10 |
| IB-10.7 | `get_active_techniques` MUST accept `Option<&TechniqueFilter>` and return `Result<Vec<AgentTechnique>, IntelligenceError>` | S10 |
| IB-10.8 | `transfer_technique` MUST accept `&ClaimId`, `&AgentId` and return `Result<TransferResult, IntelligenceError>` | S10 |
| IB-10.9 | `get_health_report` MUST return `Result<AgentCognitiveHealth, IntelligenceError>` | S10 |
| IB-10.10 | `consolidate` MUST accept `Option<&ConsolidationOptions>` and return `Result<AgentConsolidationResult, IntelligenceError>` | S10 |
| IB-10.11 | `detect_gaps` MUST accept `Option<&str>` domain and return `Result<Vec<KnowledgeGap>, IntelligenceError>` | S10 |
| IB-10.12 | `get_narrative` MUST accept `Option<&NarrativeOptions>` and return `Result<AgentNarrative, IntelligenceError>` | S10 |
| IB-10.13 | `get_importance_map` MUST accept `Option<&ImportanceMapOptions>` and return `Result<ImportanceMap, IntelligenceError>` | S10 |
| IB-10.14 | `trigger_self_heal` MUST accept `Option<&SelfHealOptions>` and return `Result<SelfHealReport, IntelligenceError>` | S10 |
| IB-10.15 | `invalidate_evidence` MUST accept `&str` evidence_id, `&str` reason and return `Result<InvalidationCascade, IntelligenceError>` | S10 |
| IB-10.16 | `repair_stale_beliefs` MUST accept `Option<&RepairOptions>` and return `Result<RepairReport, IntelligenceError>` | S10 |
| IB-10.17 | `resolve_conflict` MUST accept `&str` conflict_id, `ConflictResolutionStrategy` and return `Result<ConflictResolutionResult, IntelligenceError>` | S10 |

**Totals: 17 requirements**

---

## Section 10 (continued): Rust Data Types

| ID | Requirement | Source |
|---|---|---|
| IB-10.18 | Rust `ConflictResolutionStrategy` MUST be enum with `ConfidenceWeighted`, `TemporalLatest`, `ManualKeepFirst`, `ManualKeepSecond`, `MergeBoth`, `RetractBoth` | S10 |
| IB-10.19 | Rust `SelfHealActionType` MUST be enum with `ArchiveStale`, `ResolveConflict`, `ClearOrphan`, `CascadeInvalidation`, `RefreshEvidence` | S10 |
| IB-10.20 | Rust `IntelligenceError` MUST be enum with all 16 error variants matching TS `AgentIntelligenceError` codes | S10 |
| IB-10.21 | All Rust enums MUST derive `Debug, Clone` (at minimum) and use `PartialEq, Eq` where applicable | S10 |
| IB-10.22 | **GAP (TC-21):** Rust trait `AgentIntelligenceBridge` has no `on`/`off` event subscription methods; TS `AgentIntelligenceClient` does. Implementation MUST define Rust event subscription mechanism | TC-21 Gap |
| IB-10.23 | **GAP (TC-21):** Rust trait methods do not accept `OperationContext`; TS methods do. Implementation MUST reconcile -- Rust may use session-scoped trait instances or add ctx parameter | TC-21 Gap |
| IB-10.24 | **GAP (TC-21):** Rust types missing for `TechniqueObservation`, `AgentTechnique`, `TechniqueEvaluation`, `EvaluationResult`, `TechniquePromotionEvidence`, `PromotionDecision`, `TechniqueFilter`, `TransferResult`, `TransferRecord`; implementation MUST define all | TC-21 Gap |
| IB-10.25 | **GAP (TC-21):** Rust types missing for `AgentCognitiveHealth`, `ConsolidationOptions`, `AgentConsolidationResult`, `KnowledgeGap`, `NarrativeOptions`, `AgentNarrative`, `NarrativeThread`, `ImportanceMapOptions`, `ImportanceMap`, `ImportanceEntry`, `ImportanceScore`; implementation MUST define all | TC-21 Gap |
| IB-10.26 | **GAP (TC-21):** Rust types missing for `SelfHealOptions`, `SelfHealReport`, `SelfHealAction`, `InvalidationCascade`, `CascadeAffectedClaim`, `RepairOptions`, `RepairReport`, `ConflictResolutionResult`, `UnresolvedConflict`; implementation MUST define all | TC-21 Gap |
| IB-10.27 | **GAP (TC-21):** Rust `IntelligenceError` does not include partial results (`partialResult`, `partialReport`) for `ConsolidationFailed` and `SelfHealAborted`; TS versions do. Implementation MUST reconcile | TC-21 Gap |
| IB-10.28 | **GAP (TC-21):** Rust types missing for `IntelligenceEvent`, `IntelligenceEventHandler`, `IntelligenceEventPayload`; implementation MUST define Rust equivalents | TC-21 Gap |
| IB-10.29 | Rust uses `impl Future<Output = ...> + Send` (RPITIT) instead of `async_trait`; implementation MUST ensure correct async semantics | S10 |

**Totals: 12 requirements**

---

## Section 11: Integration Map

| ID | Requirement | Source |
|---|---|---|
| IB-11.1 | `extractTechnique` MUST route to claim assertion with `technique.*` predicate, creating claim with status=candidate | S11 |
| IB-11.2 | `evaluateTechnique` MUST create TGP evaluation record and update confidence via SC-14 | S11 |
| IB-11.3 | `promoteTechnique` MUST verify thresholds server-side and create status claim + supersedes edge | S11 |
| IB-11.4 | `suspendTechnique` MUST create status claim + supersedes edge with suspension reason | S11 |
| IB-11.5 | `retireTechnique` MUST create terminal status claim + supersedes edge; transition is irreversible | S11 |
| IB-11.6 | `getActiveTechniques` MUST query claims with technique filter, filtered by agent context | S11 |
| IB-11.7 | `transferTechnique` MUST create new claim in target agent context + relationship; confidence capped at 0.5 | S11 |
| IB-11.8 | `getHealthReport` MUST be read-only aggregation (point-in-time snapshot) | S11 |
| IB-11.9 | `consolidate` MUST create supersedes relationships via `relate_claims` | S11 |
| IB-11.10 | `detectGaps` MUST be advisory only -- no automatic claim creation | S11 |
| IB-11.11 | `getNarrative` MUST derive threads from claim relationships and temporal clustering | S11 |
| IB-11.12 | `getImportanceMap` MUST compute ImportanceScore using access patterns + graph | S11 |
| IB-11.13 | `triggerSelfHeal` MUST be composite operation spanning cascade + repair + conflict resolution | S11 |
| IB-11.14 | `invalidateEvidence` MUST perform deterministic cascade to dependent claims | S11 |
| IB-11.15 | `repairStaleBeliefs` MUST use FSRS check for aged claims; behavior depends on strategy | S11 |
| IB-11.16 | `resolveConflict` MUST create relationship record (supersedes) + optional retraction with audit trail | S11 |

**Totals: 16 requirements**

---

## Section 12: Invariants

| ID | Requirement | Source |
|---|---|---|
| IB-12.1 | **Techniques are claims:** All CCP invariants apply -- confidence ceiling 0.7 without evidence, FSRS temporal decay, classification inheritance, immutable audit history | S12 I1 |
| IB-12.2 | **State machine is law:** Transitions MUST follow Section 9 exactly; no state skipped; invalid transitions MUST return `INVALID_TRANSITION` | S12 I2 |
| IB-12.3 | **Promotion is gated:** Requires minimum eval count AND success rate AND confidence threshold; all three verified server-side | S12 I3 |
| IB-12.4 | **Transfer reduces confidence:** Transferred techniques receive `min(0.5, source_confidence * 0.5)` initial confidence | S12 I4 |
| IB-12.5 | **Self-healing never deletes:** Only archives, flags for review, or refreshes; no physical deletion; audit trail permanent | S12 I5 |
| IB-12.6 | **Consolidation is idempotent:** Running twice with identical state produces same result; merged claims carry `supersedes` relationships | S12 I6 |
| IB-12.7 | **Cascade determinism:** Same claim graph + same invalidated evidence MUST produce identical affected set | S12 I7 |
| IB-12.8 | **Health reports are snapshots:** `getHealthReport` computes at call time; no caching; no stale data | S12 I8 |
| IB-12.9 | **Conflict resolution is audited:** Every resolution creates relationship record with strategy and reasoning | S12 I9 |
| IB-12.10 | **Gap detection is advisory:** Gaps suggest but do not mandate; no automatic claim creation | S12 I10 |
| IB-12.11 | **Session and governance scope:** All operations require valid `OperationContext`; read ops need `query_claims`; technique mutation needs `assert_claim`; cognitive admin needs `manage_cognitive` | S12 I11 |
| IB-12.12 | **Narrative threads are derived:** Computed from claim relationships and temporal clustering; no separate storage; no thread CRUD | S12 I12 |

**Totals: 12 requirements**

---

## Section 13: Governance Gates

| ID | Requirement | Source |
|---|---|---|
| IB-13.1 | `extractTechnique` MUST require `assert_claim` + `query_claims` permissions, `unrestricted` clearance | S13 |
| IB-13.2 | `evaluateTechnique` MUST require `assert_claim` + `query_claims` permissions, `unrestricted` clearance | S13 |
| IB-13.3 | `promoteTechnique` MUST require `assert_claim` + `relate_claims` permissions, `internal` clearance | S13 |
| IB-13.4 | `suspendTechnique` MUST require `assert_claim` permission, `internal` clearance | S13 |
| IB-13.5 | `retireTechnique` MUST require `retract_claim` + `assert_claim` permissions, `internal` clearance | S13 |
| IB-13.6 | `transferTechnique` MUST require `query_claims` + `assert_claim` + `relate_claims` permissions, `confidential` clearance | S13 |
| IB-13.7 | `consolidate` MUST require `manage_cognitive` + `query_claims` permissions, `internal` clearance | S13 |
| IB-13.8 | `triggerSelfHeal` MUST require `manage_cognitive` permission, `confidential` clearance | S13 |
| IB-13.9 | `invalidateEvidence` MUST require `manage_cognitive` + `retract_claim` permissions, `confidential` clearance | S13 |
| IB-13.10 | `resolveConflict` MUST require `manage_cognitive` + `relate_claims` permissions, `internal` clearance | S13 |
| IB-13.11 | `getHealthReport` MUST require `manage_cognitive` permission, `unrestricted` clearance, produce no audit | S13 |
| IB-13.12 | `detectGaps` MUST require `manage_cognitive` + `query_claims` permissions, `unrestricted` clearance, produce no audit | S13 |
| IB-13.13 | `getNarrative` MUST require `manage_cognitive` + `query_claims` permissions, `unrestricted` clearance, produce no audit | S13 |
| IB-13.14 | `getImportanceMap` MUST require `manage_cognitive` + `query_claims` permissions, `unrestricted` clearance, produce no audit | S13 |
| IB-13.15 | `getActiveTechniques` MUST require `query_claims` permission, `unrestricted` clearance, produce no audit | S13 |

**Totals: 15 requirements**

---

## Section 14: Concurrency and Ordering

| ID | Requirement | Source |
|---|---|---|
| IB-14.1 | Technique status transitions MUST be serialized per technique via optimistic locking on version field; concurrent promotions: first wins, second gets `INVALID_TRANSITION` | S14 |
| IB-14.2 | Consolidation MUST acquire domain-level advisory lock; one consolidation per domain per tenant at a time; second attempt returns `CONSOLIDATION_FAILED` with reason `concurrent_consolidation` | S14 |
| IB-14.3 | Self-heal MUST acquire agent-level advisory lock; one heal per agent at a time | S14 |
| IB-14.4 | Event emission MUST be ordered within a session; cross-session ordering not guaranteed | S14 |
| IB-14.5 | Evidence invalidation cascades MUST execute atomically -- all affected claims updated in single transaction; partial cascade MUST never be visible | S14 |

**Totals: 5 requirements**

---

## Section 15: Performance Constraints

| ID | Requirement | Source |
|---|---|---|
| IB-15.1 | `extractTechnique` p95 latency MUST be < 50ms | S15 |
| IB-15.2 | `evaluateTechnique` p95 latency MUST be < 30ms | S15 |
| IB-15.3 | `getActiveTechniques` p95 latency MUST be < 100ms, max 200 results | S15 |
| IB-15.4 | `getHealthReport` p95 latency MUST be < 200ms | S15 |
| IB-15.5 | `consolidate` p95 latency MUST be < 5000ms, max 100 operations | S15 |
| IB-15.6 | `triggerSelfHeal` p95 latency MUST be < 10000ms, max 500 actions | S15 |
| IB-15.7 | `invalidateEvidence` p95 latency MUST be < 500ms, max cascade depth 10 | S15 |
| IB-15.8 | `detectGaps` p95 latency MUST be < 300ms | S15 |
| IB-15.9 | `getNarrative` p95 latency MUST be < 500ms, max 50 threads | S15 |

**Totals: 9 requirements**

---

## Section 16: Testing Requirements

| ID | Requirement | Source |
|---|---|---|
| IB-16.1 | Every state transition edge in S9 MUST be tested (valid + invalid) | S16 |
| IB-16.2 | Every error code in S8 MUST have a trigger test | S16 |
| IB-16.3 | FSRS decay calculation MUST be verified against reference implementation | S16 |
| IB-16.4 | Cascade determinism MUST be verified: same graph + same invalidation = same result (property test) | S16 |
| IB-16.5 | Integration test: full technique lifecycle extract -> evaluate x3 -> promote -> suspend -> evaluate x2 -> reactivate | S16 |
| IB-16.6 | Integration test: transfer lifecycle extract -> promote -> transfer -> evaluate in new context -> promote | S16 |
| IB-16.7 | Integration test: self-heal pipeline seed stale claims -> trigger heal -> verify archives + cascades | S16 |
| IB-16.8 | Integration test: conflict detection and resolution with all 6 strategies | S16 |
| IB-16.9 | Property test: consolidation idempotency (fast-check) | S16 |
| IB-16.10 | Property test: state machine never enters invalid state under random operation sequences | S16 |
| IB-16.11 | Property test: health score always in [0.0, 1.0] regardless of input distribution | S16 |
| IB-16.12 | Mutation test: all invariants independently killable -- no surviving mutants on governance checks | S16 |

**Totals: 12 requirements**

---

## Section 17: Migration Path

| ID | Requirement | Source |
|---|---|---|
| IB-17.1 | Phase 1 MUST implement technique learning (extract, evaluate, promote, suspend, retire, getActive) | S17 |
| IB-17.2 | Phase 2 MUST implement technique transfer (transferTechnique + cross-agent claim creation) | S17 |
| IB-17.3 | Phase 3 MUST implement cognitive health (getHealthReport, consolidate, detectGaps, getNarrative, getImportanceMap) | S17 |
| IB-17.4 | Phase 4 MUST implement self-healing (triggerSelfHeal, invalidateEvidence, repairStaleBeliefs, resolveConflict) | S17 |
| IB-17.5 | Phase 5 MUST implement events (subscription system, all event types, handler lifecycle) | S17 |

**Totals: 5 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| Section 1: Purpose & Scope | 5 |
| Section 2: Shared Type References | 1 |
| Section 3: AgentIntelligenceClient Interface | 18 |
| Section 4: Technique Learning Data Models | 32 |
| Section 5: Cognitive Health Data Models | 28 |
| Section 6: Self-Healing Data Models | 24 |
| Section 7: Intelligence Events | 9 |
| Section 8: Error Types | 17 |
| Section 9: Technique Lifecycle State Machine | 11 |
| Section 10: Rust Trait + Data Types + TC-21 Gaps | 29 |
| Section 11: Integration Map | 16 |
| Section 12: Invariants | 12 |
| Section 13: Governance Gates | 15 |
| Section 14: Concurrency and Ordering | 5 |
| Section 15: Performance Constraints | 9 |
| Section 16: Testing Requirements | 12 |
| Section 17: Migration Path | 5 |
| **GRAND TOTAL** | **248** |
