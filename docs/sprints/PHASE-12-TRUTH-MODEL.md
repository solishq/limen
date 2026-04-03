# Phase 12: Cognitive Engine — Truth Model

**Date**: 2026-04-03
**Criticality**: Tier 2 with Tier 1 inheritance
**Design Source**: PHASE-12-DESIGN-SOURCE.md

---

## Self-Healing Invariants

### I-P12-01: Auto-Retraction Threshold
**IF** a claim's effectiveConfidence (confidence * decay * cascadePenalty) falls below the configured threshold (default 0.1) due to a parent retraction **THEN** the claim MUST be auto-retracted with reason 'incorrect'.
**Assurance**: CONSTITUTIONAL

### I-P12-02: Cycle Prevention
**Self-healing MUST track visited claim IDs in a Set.** If a claim ID has already been visited in the current cascade, it MUST be skipped. No infinite loops.
**Assurance**: CONSTITUTIONAL

### I-P12-03: Depth Limit
**Self-healing MUST NOT cascade beyond maxCascadeDepth (default 5).** At depth limit, log SELF_HEALING_DEPTH_EXCEEDED and stop.
**Assurance**: CONSTITUTIONAL

### I-P12-04: Valid Retraction Reason
**Self-healing MUST use RetractionReason 'incorrect'.** No custom or invented reasons. The CONSTITUTIONAL taxonomy (I-P4-15) is inviolable.
**Assurance**: CONSTITUTIONAL

### I-P12-05: Self-Healing Audit
**Every auto-retraction MUST produce an entry in consolidation_log with operation='self_heal'.**
**Assurance**: CONSTITUTIONAL

---

## Consolidation Invariants

### I-P12-10: Merge Winner Selection
**The winner of a merge is the claim with the highest effectiveConfidence. If tied, the most recent (latest valid_at).** The winner MUST NOT be retracted.
**Assurance**: CONSTITUTIONAL

### I-P12-11: Merge Loser Retraction
**Every merge loser MUST be retracted with reason 'superseded'.** The retraction uses the existing retractClaim handler.
**Assurance**: CONSTITUTIONAL

### I-P12-12: Merge Relationship
**After merge, a 'supersedes' relationship MUST exist from the winner to each loser.**
**Assurance**: CONSTITUTIONAL

### I-P12-13: Merge Logging
**Every merge MUST produce an entry in consolidation_log with operation='merge'.**
**Assurance**: CONSTITUTIONAL

### I-P12-14: Archive Criteria
**A claim is archived ONLY IF freshness='stale' AND effectiveConfidence < archiveMaxConfidence (default 0.3) AND access_count <= archiveMaxAccessCount (default 1).** All three conditions required.
**Assurance**: CONSTITUTIONAL

### I-P12-15: Archive Reversibility
**Archiving sets archived=1 on the existing claim. The claim is NOT deleted.** Archival is reversible by setting archived=0.
**Assurance**: CONSTITUTIONAL

---

## Importance Invariants

### I-P12-20: Composite Formula
**importanceScore = w1*accessFreq + w2*recency + w3*density + w4*confidence + w5*governance.** Default weights: 0.25/0.20/0.20/0.25/0.10. All factors normalized to [0,1].
**Assurance**: QUALITY_GATE

### I-P12-21: Factor Normalization
**accessFrequency: log(1+count)/log(1+maxCount). recency: 1-(ageDays/maxAge) clamped [0,1]. density: min(relCount/10, 1). confidence: effectiveConfidence. governance: level-mapped [0.2-1.0].**
**Assurance**: QUALITY_GATE

---

## Auto-Connection Invariants

### I-P12-30: Suggestion-Only
**Auto-connection MUST NEVER create relationships directly.** All suggestions stored as 'pending' in connection_suggestions. Only acceptSuggestion() creates the relationship.
**Assurance**: CONSTITUTIONAL

### I-P12-31: Accept Creates Relationship
**acceptSuggestion() MUST delegate to the existing relateClaims handler.** The relationship is created through the standard path with full audit trail.
**Assurance**: CONSTITUTIONAL

### I-P12-32: Vector Degradation
**Without sqlite-vec, suggestConnections() MUST return an empty array, not an error.**
**Assurance**: CONSTITUTIONAL

---

## Narrative Invariants

### I-P12-40: Mission Scoping
**narrative(missionId) MUST only include claims where source_mission_id = missionId.** narrative() without missionId includes all claims.
**Assurance**: CONSTITUTIONAL

### I-P12-41: Momentum Computation
**growing: claimsAdded > claimsRetracted. stable: equal. declining: claimsAdded < claimsRetracted.** Measured over the mission scope.
**Assurance**: QUALITY_GATE

---

## Verification Invariants

### I-P12-50: Advisory Only
**verify() MUST NOT mutate any claim state.** It returns a VerificationResult. The caller decides what to do.
**Assurance**: CONSTITUTIONAL

### I-P12-51: Provider Failure Isolation
**IF the verification provider throws, verify() MUST return verdict='inconclusive', not propagate the error.**
**Assurance**: CONSTITUTIONAL

---

## Summary: 22 invariants — 17 CONSTITUTIONAL, 5 QUALITY_GATE

*SolisHQ — We innovate, invent, then disrupt.*
