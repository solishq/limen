# Limen — AAS Integration Report

## Bug Fixes and Feature Requests for AAS Readiness

**Filed by:** Meta-Orchestrator (AAS Genesis Session)
**Date:** 2026-04-01
**Priority:** Implementation needed before AAS Phase 2 (Surface Governor) and Phase 6 (A2A Bridge)
**For:** Next Limen Orchestrator/Builder session
**Context:** AAS (Agent Avionics System) consumes Limen for governance enforcement, knowledge externalization, and A2A governance. This report identifies what Limen needs to support AAS integration.

**Reference docs:**
- AAS Spec: `~/SolisHQ/Docs/design/AGENT-AVIONICS-SYSTEM-SPEC.md` (v1.2)
- Boundary Analysis: `~/SolisHQ/Docs/design/AAS-LIMEN-BOUNDARY-ANALYSIS.md`
- AAS Swarm Analysis: `~/SolisHQ/Docs/design/AAS-SWARM-DEEP-ANALYSIS.md`

---

## FEATURE REQUESTS

### FR-001: Semantic Output Primitive Schemas (BLOCKING — AAS Phase 2)

**Priority:** Critical
**Needed by:** AAS Sprint 4 (Phase 2: Surface Governor)
**Estimated effort:** ~400 lines (schemas, validation, migration, tests)

**What AAS needs:**
AAS agents produce structured semantic output using 7 primitive types. These outputs need to be storable in Limen as governed knowledge — with confidence levels, source tracking, relationships, and retraction support.

**What to add:**
7 reserved predicate namespaces under `output.*`:

| Predicate Namespace | Maps to AAS Primitive | Schema |
|---|---|---|
| `output.assertion` | ASSERTION | `{ content: string, confidence: 0-1, source?: string, verifiable: boolean }` |
| `output.judgment` | JUDGMENT | `{ subject: string, assessment: string, score?: number, rationale: string }` |
| `output.evidence` | EVIDENCE | `{ supports: ref, data: string\|object, source: string, freshness: live\|cached\|historical }` |
| `output.action` | ACTION | `{ description: string, rationale: string, urgency: immediate\|soon\|background, reversible: boolean, requires_approval: boolean }` |
| `output.question` | QUESTION | `{ question: string, context: string, options?: string[], default?: string, blocking: boolean }` |
| `output.alert` | ALERT | `{ severity: info\|warning\|critical, subject: string, details: string, action_required: boolean }` |
| `output.narrative` | NARRATIVE | `{ topic: string, content: string, audience: technical\|business\|general, depth: brief\|moderate\|detailed }` |

**Implementation approach:**
1. Add Zod validation schemas for each primitive type
2. Register `output.*` as a reserved predicate namespace (like `system.*` and `lifecycle.*`)
3. Store primitives as claims with `object` field containing the structured JSON
4. Each primitive inherits Limen's existing governance: confidence, source tracking, evidence chains, retraction, relationships
5. Add convenience methods to the API:
   ```typescript
   limen.output.assert(primitive: SemanticPrimitive): ClaimId
   limen.output.query(type?: PrimitiveType, filters?): SemanticPrimitive[]
   ```

**Migration:** Forward-only. Add new predicate namespace validation. No schema changes to claim_assertions table (JSON object field already supports structured data).

**Tests needed:**
- Each primitive type stores and retrieves correctly
- Validation rejects malformed primitives
- Relationships between primitives work (Evidence supports Judgment, etc.)
- Retraction cascades work for output primitives
- Confidence inheritance from auto-extraction (capped at maxAutoConfidence)

**Why this matters:** Without this, AAS's Context Governor has no governed place to externalize structured output. It would fall back to unstructured text in working memory, losing all the governance benefits (confidence, source tracking, contradiction detection).

---

### FR-002: A2A Governance Block Schema (BLOCKING — AAS Phase 6)

**Priority:** High
**Needed by:** AAS Sprint 11 (Phase 6: A2A Bridge)
**Estimated effort:** ~600 lines (schemas, Agent Card extension, validation, tests)

**What AAS needs:**
When agents communicate across organizational boundaries (A2A), each agent's Agent Card must declare its governance posture. This is what makes SolisHQ's A2A governed, not just connected.

**What to add:**

**A. Governance Block Schema** (extension to Agent Card):
```typescript
interface A2AGovernanceBlock {
  provider: 'limen';                          // governance substrate
  version: string;                            // governance schema version
  data_residency: string[];                   // ['US', 'EU'] — where data can be stored
  pii_handling: 'masked' | 'redacted' | 'allowed'; // how PII is treated
  audit_trail: boolean;                       // all interactions audited?
  compliance: string[];                       // ['GDPR', 'SOC2', 'HIPAA']
  max_confidence: number;                     // maximum auto-assigned confidence
  capability_boundaries: CapabilityBoundary[]; // per-skill access rules
}
```

**B. Capability Boundary Schema** (per-skill authorization):
```typescript
interface CapabilityBoundary {
  skill_id: string;                           // which A2A skill
  clearance_required: 'public' | 'confidential' | 'secret'; // minimum clearance
  data_fields_allowed: string[];              // which response fields are visible
  data_fields_masked: string[];               // which fields are PII-masked
  rate_limit?: { calls_per_minute: number };  // per-skill rate limiting
}
```

**C. Data Classification Schema** (cross-ring clearance):
```typescript
interface DataClassification {
  level: 'public' | 'confidential' | 'secret' | 'internal_only';
  applies_to: string;                         // predicate pattern or domain
  rule: 'allow' | 'mask' | 'redact' | 'deny'; // action at this level
}
```

**D. Proactive Rule Schema** (stored in Limen, executed by AAS):
```typescript
interface ProactiveRule {
  id: string;
  condition: string;                          // trigger condition expression
  precondition?: string;                      // additional requirement
  target_agent: string;                       // agent selector (discovered via A2A)
  action: string;                             // A2A task to send
  governance: {
    data_shared: string[];                    // what crosses the boundary
    data_prohibited: string[];                // what never crosses
  };
  cost_ceiling: number;                       // max cost per invocation
  cooldown_seconds: number;                   // min time between triggers
  approved_by: string;                        // who approved this rule (Femi/governance)
  status: 'active' | 'suspended' | 'retired';
}
```

**Implementation approach:**
1. Add Zod schemas for all 4 types
2. Extend `limen-a2a` Agent Card with optional `governance` block
3. Store proactive rules as governed claims (subject: `entity:proactive-rule:{id}`, predicate: `a2a.proactive.*`)
4. Capability boundaries stored per-agent (subject: `entity:agent:{id}`, predicate: `a2a.capability.*`)
5. Data classification stored per-tenant (subject: `entity:tenant:{id}`, predicate: `a2a.classification.*`)
6. Validation: proactive rules require `approved_by` field (governance mandate)

**Migration:** Forward-only. New predicate namespaces. No structural changes.

**Tests needed:**
- Agent Card with governance block serializes/deserializes correctly
- Capability boundaries enforce clearance levels
- Data classification rules apply correctly per ring level
- Proactive rules validate (must have cost_ceiling, cooldown, approved_by)
- Proactive rules with `status: suspended` are not queryable by default
- Rules without `approved_by` are rejected (AAS Invariant I12)

---

### FR-003: High-Frequency Vitals Optimization (IMPORTANT — AAS Phase 0)

**Priority:** High
**Needed by:** AAS Sprint 0 (Phase 0: Vitals System)
**Estimated effort:** ~200 lines (cache, optional subscription)

**What AAS needs:**
The AAS Vitals System calls `limen.cognitive.health()` (or similar) on EVERY TURN to check knowledge state. At active session rates (1 turn every 5-30 seconds), this means 2-12 calls per minute.

**Current problem:**
`cognitive.health()` computes freshness for ALL active claims on every call. At 10K claims, this could take 100-500ms — too slow for vitals (target: <50ms total vitals pipeline).

**What to add:**

**A. Cached health check:**
```typescript
// Add maxAge parameter — skip recomputation if cache is fresh
limen.cognitive.health({ maxAge: 5000 }) // Return cached result if <5s old
```

Implementation: Store last health computation result + timestamp. If `Date.now() - lastComputed < maxAge`, return cached. Otherwise recompute and cache.

**B. Lightweight claim count/delta query:**
```typescript
// Fast query for vitals — no full health scan
limen.cognitive.delta({
  since: '2026-04-01T14:28:00Z',  // since last vitals check
  types: ['output.*', 'decision.*'] // only relevant predicates
})
// Returns: { added: 3, retracted: 0, conflicts: 1 }
```

Implementation: Query `claim_assertions` with `WHERE createdAt > ? AND predicate LIKE ?` + count of `status = 'retracted'` in same window. Index on `(status, createdAt)` makes this fast.

**C. (Optional, later) Push subscription:**
```typescript
limen.cognitive.subscribe((event) => {
  // Called when: new claim, retraction, conflict detected
  // Vitals can react immediately instead of polling
})
```

Implementation: SQLite trigger or in-process event emitter. Emit on INSERT/UPDATE to claim_assertions.

**Migration:** None for options A and B. Option C may need event infrastructure.

**Tests needed:**
- `health({ maxAge: 5000 })` returns cached result within window
- `health({ maxAge: 5000 })` recomputes after window expires
- `delta()` returns correct counts for a time window
- `delta()` with predicate filter only counts matching claims
- Performance: `delta()` <10ms at 10K claims, `health({ maxAge: 5000 })` <1ms when cached

---

### FR-004: Telemetry Observation Schemas (NICE-TO-HAVE — AAS Phase 4)

**Priority:** Medium
**Needed by:** AAS Sprint 7 (Phase 4: Consolidation Engine)
**Estimated effort:** ~800 lines (schemas, storage, retention, tests)

**What AAS needs:**
The Consolidation Engine learns from operational telemetry (cost patterns, quality signals, routing effectiveness). If this telemetry lives in Limen, the learning loop is governed (confidence, source tracking, contradiction detection apply to operational knowledge too).

**What to add:**
3 reserved predicate namespaces under `telemetry.*`:

| Namespace | Purpose | Example |
|---|---|---|
| `telemetry.cost` | Cost ledger entries | `{ model: "opus-4-6", tokens: 50000, cost: 0.85, purpose: "primary" }` |
| `telemetry.vital` | Operational vital signals | `{ context_pct: 58, quality: "OK", cost_rate: 0.09 }` |
| `telemetry.audit` | Audit trail entries | `{ action: "file_write", target: "src/auth.ts", authorized: true }` |

**Important design consideration:**
Telemetry is HIGH VOLUME. AAS generates a cost entry per LLM call and a vital signal per turn. At 100 turns/day across 5 sessions, that's 500+ entries/day. Limen's claim storage is designed for knowledge (low volume, high value), not telemetry (high volume, time-decaying value).

**Options:**
1. **Store in Limen with retention policy:** Add TTL to telemetry claims. Auto-archive after N days. Consolidation Engine reads before archival and extracts PATTERNS (which become permanent knowledge claims).
2. **Store alongside Limen (not in it):** AAS keeps telemetry in JSONL files (current design). Consolidation Engine writes PATTERNS to Limen. Telemetry schemas are defined in Limen (for standardization) but stored externally.
3. **Hybrid:** High-frequency raw telemetry in JSONL. Aggregated daily summaries written to Limen as claims.

**Recommendation:** Option 3 (hybrid). Raw telemetry stays in JSONL (fast appends, no DB overhead). Daily aggregates go to Limen (governed, searchable, relatable). Limen provides the SCHEMAS (Zod validators) even if it doesn't store every raw entry.

**Migration:** Depends on option chosen. Option 3 needs only Zod schemas (no migration).

---

## BUG REPORTS

### BUG-001: cognitive.health() Has No Caching — Performance Risk

**Severity:** Medium (not a bug per se, but becomes a performance issue when AAS polls it)
**Current behavior:** Every call to `cognitive.health()` recomputes freshness for all active claims.
**Expected behavior:** Should support cached results for high-frequency polling.
**Impact:** AAS vitals pipeline targets <50ms. Uncached health check at scale could exceed this.
**Fix:** FR-003 above (add `maxAge` parameter).

---

### BUG-002: A2A Agent Card Missing Governance Field

**Severity:** Low (not a bug — the field didn't exist when A2A was built)
**Current behavior:** Agent Card schema has no `governance` field.
**Expected behavior:** Agent Card should optionally include governance posture for AAS Ring 2/3 trust evaluation.
**Impact:** Without governance declaration, external agents can't assess our governance posture, and we can't assess theirs. All A2A interactions default to Ring 3 (zero trust).
**Fix:** FR-002 above (add governance block schema).

---

### BUG-003: limen-a2a Lacks Streaming and Push Notifications

**Severity:** Low (not blocking AAS, but limits A2A capabilities)
**Current behavior:** Agent Card declares `streaming: false, pushNotifications: false`.
**Expected behavior:** For proactive A2A (AAS Phase 6), push notifications are needed so external agents can proactively notify us.
**Impact:** Without push, all A2A is request-response. Proactive scenarios (supplier notifies us of price change) require polling instead of push.
**Fix:** Future sprint — add SSE or WebSocket transport to limen-a2a for push notifications.

---

## IMPLEMENTATION SEQUENCING

These items should be scheduled relative to AAS sprints:

| AAS Sprint | AAS Phase | Limen Work Needed | Priority |
|---|---|---|---|
| Sprint 0 (Week 1) | Phase 0: Foundation | FR-003 (vitals optimization) | High — AAS vitals poll Limen |
| Sprint 4 (Week 5) | Phase 2: Surface Governor | FR-001 (semantic primitives) | Critical — Context Governor externalizes to Limen |
| Sprint 7 (Week 8) | Phase 4: Consolidation | FR-004 (telemetry schemas) | Medium — Consolidation reads patterns |
| Sprint 11 (Week 12) | Phase 6: A2A Bridge | FR-002 (A2A governance) | High — governed A2A requires governance schemas |
| Future | Post-Phase 6 | BUG-003 (push notifications) | Low — enables full proactive A2A |

**Recommended Limen sprint cadence:**
- **Limen Sprint A (align with AAS Sprint 0):** FR-003 — vitals optimization. Small, high impact.
- **Limen Sprint B (align with AAS Sprint 3-4):** FR-001 — semantic output primitives. The big one.
- **Limen Sprint C (align with AAS Sprint 7):** FR-004 — telemetry schemas (hybrid option).
- **Limen Sprint D (align with AAS Sprint 10-11):** FR-002 — A2A governance schemas.

Each Limen sprint should be a Builder dispatch with Breaker + Certifier cycle. Standard 7-control methodology.

---

## NOTES FOR THE LIMEN ORCHESTRATOR

1. **All changes are forward-compatible.** Nothing breaks existing Limen deployments. All new features are additive (new predicate namespaces, new optional fields, new convenience methods).

2. **The frozen zone is safe.** None of these changes modify existing public API signatures, system call contracts, or database schemas. They ADD to all three, but modify none.

3. **Limen version bump:** These features warrant a minor version bump (1.4.0 → 1.5.0 for FR-003 + FR-001, then 1.6.0 for FR-002 + FR-004).

4. **Open-source consideration:** FR-001 (semantic primitives) and FR-002 (A2A governance schemas) are designated for Limen's open-source release per the AAS-Limen Boundary Analysis. They are the SCHEMAS that create the standard. AAS's proprietary ENGINES consume them.

5. **Test requirements:** Each FR needs invariant tests, contract tests, and breaker attack tests per Limen's existing methodology. The test suite currently has 3,162 passing tests — maintain that standard.

---

*This report was generated from a comprehensive exploration of Limen v1.4.0 against AAS Specification v1.2 requirements. Every finding is traceable to a specific AAS spec section and Limen code location.*

*Filed by: Meta-Orchestrator, AAS Genesis Session, 2026-04-01*
