# PHASE 2 -- CONTRACT SPECIFICATION

**Project:** Limen V5 Cognitive Governance Substrate
**SolisForge Phase:** 2 (Contract Specification)
**Governing Constitution:** SolisForge v1.5 Generic Reference (`docs/SOLISFORGE-v1.5-GENERIC-REFERENCE.md`)
**Derived From:**
- `PHASE_0_INTENT_RECORD.md` -- scope, constraints, success definition
- `PHASE_0_PROPERTY_DERIVATION.md` -- 8 invariants, 2 process constraints, 5 quality targets
- `PHASE_1_FAILURE_MODE_ATLAS.md` -- 37 failure modes (10 CATASTROPHIC)
**Date:** 2026-05-13
**Status:** Bounded by current analysis
**Oracle Gate:** OG-CONSULT completed before design (Amendment 24)

---

## Table of Contents

1. [Foundational Types](#1-foundational-types)
2. [Error Taxonomy](#2-error-taxonomy)
3. [LimenAgentClient Interface](#3-limenagentclient-interface)
4. [Governance Interface](#4-governance-interface)
5. [Lifecycle Interface](#5-lifecycle-interface)
6. [Audit Interface](#6-audit-interface)
7. [Computer-Use Interface](#7-computer-use-interface)
8. [Self-Healing Interface](#8-self-healing-interface)
9. [Coordination Interface](#9-coordination-interface)
10. [AdapterRegistry Interface](#10-adapterregistry-interface)
11. [FMA-to-Contract Traceability](#11-fma-to-contract-traceability)
12. [Parameter Range Summary](#12-parameter-range-summary)
13. [Cross-Interface Invariants](#13-cross-interface-invariants)

---

## 1. Foundational Types

All types are defined here and referenced by every interface. No interface defines its own primitive types. Every field has an explicit type, constraint, and rationale.

### 1.1 Result Type

Every operation returns `Result<T, E>`. No thrown exceptions cross interface boundaries.

```
Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }
```

**Rationale:** Thrown exceptions are invisible in type signatures. Result forces the caller to handle both paths. This prevents FM-I1-03 (silent failure paths that bypass governance).

### 1.2 Branded Primitives

These are nominal types (branded in TypeScript via intersection with a unique symbol). They prevent accidental substitution of structurally identical but semantically different values.

```
ClaimId       = string & { readonly __brand: 'ClaimId' }
AgentId       = string & { readonly __brand: 'AgentId' }
MissionId     = string & { readonly __brand: 'MissionId' }
TaskId        = string & { readonly __brand: 'TaskId' }
AuditEntryId  = string & { readonly __brand: 'AuditEntryId' }
ConsentId     = string & { readonly __brand: 'ConsentId' }
AdapterId     = string & { readonly __brand: 'AdapterId' }
ActionId      = string & { readonly __brand: 'ActionId' }
RuleId        = string & { readonly __brand: 'RuleId' }
RelationshipId = string & { readonly __brand: 'RelationshipId' }
```

**Generation:** All IDs are UUIDv7 (time-ordered, 36 chars including hyphens). Time-ordering supports audit trail reconstruction and enables efficient range queries.

### 1.3 Confidence

```
Confidence = number & { readonly __brand: 'Confidence' }

Constraints:
  - Range: [0.0, 1.0] inclusive
  - Precision: IEEE 754 double (no explicit rounding -- clamped at boundaries)
  - Auto-cap: values written via any non-evidence-grounded path are clamped to maxAutoConfidence (0.7)
  - NaN/Infinity: REJECTED at validation boundary. Never stored. Never propagated. (Prevents FM-I2-01)
  - Negative values: REJECTED at validation boundary.

Semantic scale (advisory, not enforced):
  0.0       -- no confidence (retracted equivalent)
  0.0-0.3   -- speculative
  0.3-0.5   -- theoretical
  0.5-0.7   -- observed
  0.7-0.85  -- proven (requires evidence grounding for > 0.7)
  0.85-0.95 -- validated
  0.95-1.0  -- formally verified (requires evidence grounding)
```

### 1.4 SHA256Hash

```
SHA256Hash = string & { readonly __brand: 'SHA256Hash' }

Constraints:
  - Exactly 64 lowercase hexadecimal characters: /^[0-9a-f]{64}$/
  - Computed on exact UTF-8 bytes of content (per SolisForge v1.5 Section 3)
  - Never computed on stringified/serialized representations that may vary
```

### 1.5 Timestamp

```
Timestamp = string & { readonly __brand: 'Timestamp' }

Constraints:
  - ISO 8601 UTC format: YYYY-MM-DDTHH:mm:ss.sssZ
  - Must end with 'Z' (UTC only -- no timezone offsets)
  - Millisecond precision minimum
  - Must be obtainable ONLY from TimeProvider (never direct Date.now())
  - Range: [2020-01-01T00:00:00.000Z, 2100-01-01T00:00:00.000Z)
    (Lower bound: reasonable minimum. Upper bound: prevents absurd future dates.)
```

### 1.6 Subject URN

```
SubjectURN = string & { readonly __brand: 'SubjectURN' }

Format: "entity:<type>:<id>"
  - type: 1-64 alphanumeric chars plus hyphens, no whitespace
  - id: 1-256 chars, no whitespace, no path separators (/ or \)
  - Total max length: 512 chars
  - Pattern: /^entity:[a-z0-9-]{1,64}:[^\s/\\]{1,256}$/
```

### 1.7 Predicate

```
Predicate = string & { readonly __brand: 'Predicate' }

Format: "<domain>.<property>"
  - domain: 1-64 alphanumeric chars plus hyphens
  - property: 1-64 alphanumeric chars plus hyphens
  - Exactly one dot separator
  - Total max length: 130 chars
  - Pattern: /^[a-z0-9-]{1,64}\.[a-z0-9-]{1,64}$/
  - Protected predicates (see Section 4.4) require elevated trust level to write
```

### 1.8 ClaimContent

```
ClaimContent = string & { readonly __brand: 'ClaimContent' }

Constraints:
  - Max length: 500 UTF-8 characters
  - Min length: 1 character
  - No null bytes (\x00)
  - Unicode normalization: NFC form applied on input
  - Direction-override characters (U+202A-U+202E, U+2066-U+2069, U+200F, U+200E)
    are STRIPPED on input (prevents FM-CC-04 unicode injection vector)
```

### 1.9 Claim

The atomic unit of knowledge in the belief graph.

```
Claim = {
  id:              ClaimId               -- generated by system, never caller-supplied
  subject:         SubjectURN            -- what the claim is about
  predicate:       Predicate             -- what aspect of the subject
  objectValue:     ClaimContent          -- the knowledge content
  objectType:      ObjectType            -- type tag for the value
  confidence:      Confidence            -- [0.0, 1.0], capped by governance
  status:          ClaimStatus           -- active | retracted
  groundingMode:   GroundingMode         -- how truth is anchored
  classification:  DataClassification    -- MANDATORY. Never null. (Prevents FM-I3-02)
  createdAt:       Timestamp             -- immutable after creation
  createdBy:       AgentId               -- which agent asserted this
  retractedAt:     Timestamp | null      -- null if active
  retractedReason: RetractReason | null  -- null if active
  validAt:         Timestamp             -- temporal anchor for the claim
  missionId:       MissionId | null      -- mission context (null if unscoped)
  taskId:          TaskId | null         -- task context (null if unscoped)
  contentHash:     SHA256Hash            -- hash of canonical claim content
  previousHash:    SHA256Hash | null     -- hash chain link (null for genesis claim)
  sequenceNum:     number                -- monotonically increasing chain position, starts at 0
                                         -- assigned at write time, authoritative for chain ordering
  fsrsState:       FSRSState             -- decay parameters, stored at creation time
  version:         number                -- monotonically increasing, starts at 1
}
```

### 1.10 ObjectType

```
ObjectType = 'string' | 'number' | 'boolean' | 'date' | 'json'
```

### 1.11 ClaimStatus

```
ClaimStatus = 'active' | 'retracted'
```

### 1.12 GroundingMode

```
GroundingMode = 'evidence_path' | 'runtime_witness'
```

- `evidence_path`: claim backed by traceable evidence chain (may exceed maxAutoConfidence)
- `runtime_witness`: claim witnessed at runtime (may exceed maxAutoConfidence if witness data provided)

### 1.13 RetractReason

```
RetractReason = 'incorrect' | 'superseded' | 'expired' | 'manual' | 'cascade' | 'erasure'
```

### 1.14 DataClassification

```
DataClassification = 'public' | 'internal' | 'confidential' | 'personal' | 'sensitive' | 'secret'

Hierarchy (from least to most restrictive):
  public < internal < confidential < personal < sensitive < secret

Rules:
  - Classification is IMMUTABLE after creation (reclassification requires retract + re-assert)
  - Classification determines: consent scope matching, retention policy, recall redaction, audit visibility
  - 'secret' classification: content is NEVER returned in recall responses (redacted). (Prevents FM-CC-03)
  - 'personal' and above: require active consent before any operation (Prevents FM-I3-01)
```

### 1.15 FSRSState

FSRS (Free Spaced Repetition Scheduler) decay parameters stored per-claim at creation time. This ensures decay is consistent even if system-wide parameters change. (Prevents FM-CC-02)

```
FSRSState = {
  stability:    number    -- [0.01, 1000.0] -- initial stability factor
  difficulty:   number    -- [0.0, 1.0]     -- item difficulty
  elapsedDays:  number    -- [0, 36500]     -- days since last review (max ~100 years)
  scheduledDays: number   -- [0, 36500]     -- days until next review
  reps:         number    -- [0, 100000]    -- review count
  lapses:       number    -- [0, 100000]    -- lapse count
  paramVersion: string    -- semver string identifying the FSRS parameter set
}

All numeric fields:
  - Must be finite (Number.isFinite === true)
  - Must not be NaN
  - Must not be negative (except where range explicitly allows)
  - Enforced at Zod validation boundary (prevents FM-I2-01)
```

### 1.16 BeliefView

The read-side projection of a Claim with temporal decay applied.

```
BeliefView = {
  id:                  ClaimId
  subject:             SubjectURN
  predicate:           Predicate
  objectValue:         ClaimContent    -- redacted to '[REDACTED]' if classification = 'secret'
  objectType:          ObjectType
  storedConfidence:    Confidence      -- raw stored value
  effectiveConfidence: Confidence      -- after FSRS temporal decay applied at read time
  freshness:           FreshnessLabel  -- human-readable decay indicator
  status:              ClaimStatus
  classification:      DataClassification
  createdAt:           Timestamp
  createdBy:           AgentId
  validAt:             Timestamp
  missionId:           MissionId | null
  taskId:              TaskId | null
}

effectiveConfidence is ALWAYS computed at read time. Never cached beyond a single
request boundary. (Prevents FM-I2-03)
```

### 1.17 FreshnessLabel

```
FreshnessLabel = 'fresh' | 'recent' | 'aging' | 'stale' | 'expired'

Derived from effectiveConfidence:
  fresh:   effectiveConfidence >= 0.8 * storedConfidence
  recent:  effectiveConfidence >= 0.6 * storedConfidence
  aging:   effectiveConfidence >= 0.4 * storedConfidence
  stale:   effectiveConfidence >= 0.2 * storedConfidence
  expired: effectiveConfidence <  0.2 * storedConfidence
```

### 1.18 Relationship

```
Relationship = {
  id:        RelationshipId
  fromId:    ClaimId
  toId:      ClaimId
  type:      RelationshipType
  createdAt: Timestamp
  createdBy: AgentId
}

RelationshipType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from'

Constraints:
  - fromId !== toId (no self-referencing)
  - No duplicate relationships (same fromId + toId + type)
  - 'derived_from' creates a strong dependency (cascade-eligible)
  - 'supports' creates a weak association (NOT cascade-eligible)
  - 'supersedes' causes the target claim to transition to retracted with reason 'superseded'
  - 'contradicts' is informational -- does not trigger automatic state changes
```

### 1.19 AuditEntry

```
AuditEntry = {
  id:            AuditEntryId
  sequenceNum:   number          -- monotonically increasing, gap-free within a chain
  operation:     AuditOperation  -- what happened
  entityType:    AuditEntityType -- what entity was affected
  entityId:      string          -- the affected entity's ID
  agentId:       AgentId         -- who performed the operation
  timestamp:     Timestamp       -- when
  payload:       string          -- JSON-encoded operation-specific data, max 4096 chars
  contentHash:   SHA256Hash      -- hash of (sequenceNum + operation + entityType + entityId + agentId + timestamp + payload)
  previousHash:  SHA256Hash      -- hash of the previous AuditEntry's contentHash (genesis: hash of 'GENESIS')
  chainId:       string          -- identifies which hash chain this entry belongs to
}

AuditOperation =
  | 'claim.assert'
  | 'claim.retract'
  | 'claim.update'
  | 'relationship.create'
  | 'relationship.remove'
  | 'consent.register'
  | 'consent.revoke'
  | 'consent.check'
  | 'agent.register'
  | 'agent.promote'
  | 'agent.demote'
  | 'agent.suspend'
  | 'agent.decommission'
  | 'action.execute'
  | 'action.refuse'
  | 'action.kill'
  | 'cascade.trigger'
  | 'cascade.retract'
  | 'consolidation.merge'
  | 'consolidation.archive'
  | 'erasure.execute'
  | 'erasure.retract'
  | 'erasure.audit_tombstone'
  | 'rule.register'
  | 'rule.suspend'
  | 'rule.retire'
  | 'rule.execute_failed'
  | 'rule.recursion_blocked'
  | 'adapter.register'
  | 'adapter.remove'
  | 'WM_WRITE'
  | 'WM_READ'
  | 'WM_DISCARD'
  | 'chain.verify'
  | 'audit.export'

AuditEntityType =
  | 'claim'
  | 'relationship'
  | 'consent'
  | 'agent'
  | 'action'
  | 'cascade'
  | 'consolidation'
  | 'erasure'
  | 'rule'
  | 'adapter'
  | 'working_memory'
  | 'chain'
  | 'audit'

Immutability constraints:
  - AuditEntry fields are NEVER modified after creation. (Prevents FM-I6-01)
  - No DELETE operation exists on audit entries. Erasure (GDPR) tombstones but does not delete.
  - sequenceNum must be gap-free: entry N+1 has sequenceNum = entry N sequenceNum + 1.
  - previousHash MUST equal the contentHash of the immediately preceding entry in the same chainId.
  - Hash chain verification detects tampering (FM-I6-01) and gaps.
```

### 1.20 Agent

```
Agent = {
  id:           AgentId
  name:         string          -- 1-64 chars, unique, /^[a-z0-9-]{1,64}$/
  trustLevel:   TrustLevel
  capabilities: string[]        -- declared capability tags, max 32 items, each max 64 chars
  domains:      string[]        -- declared domain tags, max 32 items, each max 64 chars
  status:       AgentStatus
  registeredAt: Timestamp
  lastActiveAt: Timestamp
  metadata:     string          -- JSON, max 4096 chars
}

TrustLevel = 'untrusted' | 'probationary' | 'trusted' | 'admin'

Trust level hierarchy: untrusted < probationary < trusted < admin
Promotion/demotion must be sequential (no skipping levels).

AgentStatus = 'active' | 'suspended' | 'decommissioned'

Status transitions (state machine):
  active -> suspended          (via suspend)
  suspended -> active          (via reactivate)
  active -> decommissioned     (via decommission)
  suspended -> decommissioned  (via decommission)
  decommissioned -> (terminal) (no transitions out)
```

### 1.21 ConsentRecord

```
ConsentRecord = {
  id:             ConsentId
  dataSubjectId:  string            -- 1-256 chars, the data subject identifier
  basis:          ConsentBasis       -- GDPR Article 6 legal basis
  scope:          string             -- 1-256 chars, what processing is covered
  status:         ConsentStatus
  registeredAt:   Timestamp
  revokedAt:      Timestamp | null
  expiresAt:      Timestamp | null   -- null = indefinite
  registeredBy:   AgentId
}

ConsentBasis = 'explicit_consent' | 'contract_performance' | 'legal_obligation' | 'legitimate_interest'

ConsentStatus = 'active' | 'revoked' | 'expired'

Status transitions:
  active -> revoked    (explicit revocation)
  active -> expired    (expiresAt reached -- computed on read, not stored)
  revoked -> (terminal)
  expired -> (terminal)

Expiry rule: a consent with expiresAt <= now() is treated as expired
regardless of stored status. Computed at CHECK time, within the same
transaction as the operation it gates. (Prevents FM-I3-01 TOCTOU)
```

### 1.22 ComputerUseAction

```
ComputerUseAction = {
  id:               ActionId
  type:             ActionType
  command:          string            -- 1-4096 chars, the action to execute
  sandboxConfig:    SandboxConfig
  status:           ActionStatus
  requestedBy:      AgentId
  requestedAt:      Timestamp
  startedAt:        Timestamp | null
  completedAt:      Timestamp | null
  result:           ActionResult | null
  provenance:       ActionProvenance | null  -- MUST be non-null for any completed/failed/killed action
  killSwitchState:  KillSwitchState          -- checked CONTINUOUSLY during execution, not just at dispatch
}

ActionType = 'file_read' | 'file_write' | 'file_delete' | 'shell_execute' | 'network_request'

ActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'refused' | 'killed'

Status transitions:
  pending -> executing    (sandbox acquired, action starts)
  pending -> refused      (governance gate blocks)
  executing -> completed  (action finishes successfully)
  executing -> failed     (action errors)
  executing -> killed     (kill-switch activated -- within 100ms of signal)
  refused -> (terminal)
  completed -> (terminal)
  failed -> (terminal)
  killed -> (terminal)

ActionResult = {
  exitCode:    number | null    -- for shell_execute
  output:      string | null    -- max 65536 chars, stdout/response body
  error:       string | null    -- max 65536 chars, stderr/error message
  bytesRead:   number | null    -- for file_read
  bytesWritten: number | null   -- for file_write
}

ActionProvenance = {
  actionId:        ActionId
  sandboxId:       string          -- unique sandbox instance identifier
  containedPaths:  string[]        -- filesystem paths the sandbox allowed
  networkPolicy:   NetworkPolicy   -- what network access was permitted
  environmentHash: SHA256Hash      -- hash of sanitized environment variables (proves env was cleaned)
  startedAt:       Timestamp
  completedAt:     Timestamp
  exitReason:      ActionStatus    -- completed | failed | killed
  attestation:     SHA256Hash      -- hash of (sandboxId + containedPaths + networkPolicy + environmentHash + exitReason)
  generatedBy:     'sandbox_runtime'  -- LITERAL value. Provenance is ONLY generated by the sandbox runtime, never by action code. (Prevents FM-I5-02)
}

NetworkPolicy = 'none' | 'localhost_only' | 'allowlist'

SandboxConfig = {
  rootPath:           string       -- absolute path, canonicalized (no symlinks, no ..)
  allowedPaths:       string[]     -- each must be under rootPath after canonicalization
  networkPolicy:      NetworkPolicy
  allowedHosts:       string[]     -- only if networkPolicy = 'allowlist'
  maxExecutionMs:     number       -- [100, 300000] (100ms to 5min)
  maxOutputBytes:     number       -- [0, 67108864] (0 to 64MB)
  inheritEnv:         false        -- LITERAL false. Never inherit parent env. (Prevents FM-I5-04)
  explicitEnv:        Record<string, string>  -- only these env vars are set in sandbox
}

Sandbox path validation (prevents FM-I5-04):
  - All paths MUST be canonicalized via realpath() before comparison
  - Symlinks MUST be resolved before containment check
  - Path traversal (../) MUST be resolved and checked AFTER resolution
  - A path is contained IFF its canonical form starts with the canonical rootPath

KillSwitchState = {
  active:       boolean         -- true = kill-switch is engaged
  activatedAt:  Timestamp | null
  activatedBy:  AgentId | null
  propagationBudgetMs: 100      -- LITERAL 100. Actions MUST terminate within 100ms of activation. (Prevents FM-I5-01)
}
```

### 1.23 ProactiveRule

```
ProactiveRule = {
  id:           RuleId
  name:         string          -- 1-128 chars
  description:  string          -- 1-1024 chars
  triggerType:  RuleTriggerType
  triggerConfig: string         -- JSON, max 4096 chars, schema depends on triggerType
  actionType:   RuleActionType
  actionConfig:  string         -- JSON, max 4096 chars
  status:       RuleStatus
  approvedBy:   AgentId         -- MUST be admin trust level
  createdAt:    Timestamp
  lastFiredAt:  Timestamp | null
  fireCount:    number          -- [0, MAX_SAFE_INTEGER]
}

RuleTriggerType = 'claim_asserted' | 'claim_retracted' | 'confidence_threshold' | 'schedule' | 'pattern_match'
RuleActionType  = 'send_message' | 'assert_claim' | 'retract_claim' | 'trigger_cascade'
RuleStatus      = 'active' | 'suspended' | 'retired'

Status transitions:
  active -> suspended   (manual or governance)
  suspended -> active   (manual reactivation)
  active -> retired     (permanent)
  suspended -> retired  (permanent)
  retired -> (terminal)
```

### 1.24 ErasureCertificate

```
ErasureCertificate = {
  dataSubjectId:   string
  claimsAffected:  number        -- count of claims tombstoned
  auditEntries:    number        -- count of audit entries tombstoned
  cascadeDepth:    number        -- 0 if includeRelated=false
  executedAt:      Timestamp
  executedBy:      AgentId
  reason:          string        -- GDPR Article 17 basis
  certificateHash: SHA256Hash    -- hash of all above fields, serves as proof
}
```

### 1.25 WorkingMemoryEntry

```
WorkingMemoryEntry = {
  taskId:     TaskId
  key:        string      -- 1-256 chars, no whitespace, no / or \, no _wmp. prefix
  value:      string      -- max 65536 UTF-8 chars
  createdAt:  Timestamp
  updatedAt:  Timestamp
}
```

---

## 2. Error Taxonomy

Every error the system can produce. Discriminated union with code, severity, and recovery guidance. No interface method throws -- all errors are returned via `Result<T, E>`.

### 2.1 Error Severity

```
ErrorSeverity = 'fatal' | 'error' | 'warning'

  fatal:   system cannot continue. Kill-switch, DB corruption, chain break.
  error:   operation failed but system is healthy. Caller should handle.
  warning: operation succeeded but with degradation. Caller should be aware.
```

### 2.2 Error Base

```
LimenError = {
  code:       ErrorCode       -- unique, machine-readable
  severity:   ErrorSeverity
  message:    string          -- human-readable, max 512 chars
  context:    Record<string, string>  -- key-value pairs for debugging
  timestamp:  Timestamp
  recoveryGuidance: string    -- what the caller should do, max 256 chars
}
```

### 2.3 Error Codes (Exhaustive Enumeration)

Organized by subsystem. Each code is unique across the entire system.

**Validation Errors (E_VAL_*)**

```
E_VAL_CONFIDENCE_OUT_OF_RANGE   -- confidence not in [0.0, 1.0]
  severity: error
  recovery: "Provide confidence value between 0.0 and 1.0 inclusive"

E_VAL_CONFIDENCE_NAN            -- confidence is NaN or Infinity
  severity: error
  recovery: "Provide a finite numeric confidence value"

E_VAL_CONTENT_TOO_LONG          -- content exceeds 500 chars
  severity: error
  recovery: "Truncate content to 500 characters or split into multiple claims"

E_VAL_CONTENT_EMPTY             -- content is empty string
  severity: error
  recovery: "Provide non-empty content"

E_VAL_SUBJECT_INVALID           -- subject does not match URN format
  severity: error
  recovery: "Use format entity:<type>:<id>"

E_VAL_PREDICATE_INVALID         -- predicate does not match domain.property format
  severity: error
  recovery: "Use format <domain>.<property>"

E_VAL_TIMESTAMP_INVALID         -- timestamp is not valid ISO 8601 UTC
  severity: error
  recovery: "Use format YYYY-MM-DDTHH:mm:ss.sssZ"

E_VAL_TIMESTAMP_OUT_OF_RANGE    -- timestamp outside [2020, 2100)
  severity: error
  recovery: "Provide timestamp within valid range"

E_VAL_HASH_INVALID              -- hash is not 64 lowercase hex chars
  severity: error
  recovery: "Provide valid SHA-256 hash (64 lowercase hex characters)"

E_VAL_ID_INVALID                -- ID does not match expected format
  severity: error
  recovery: "IDs are system-generated. Do not provide custom IDs"

E_VAL_UNKNOWN_FIELD             -- Zod strict parsing rejected an unknown field
  severity: error
  recovery: "Remove unrecognized fields from input"

E_VAL_SCHEMA_MISMATCH           -- input does not match expected schema
  severity: error
  recovery: "Check input against the documented schema"

E_VAL_INVALID_REASON            -- retract reason not permitted on this API surface
  severity: error
  recovery: "'cascade' and 'erasure' are system-internal reasons. Use incorrect, superseded, expired, or manual"

E_VAL_QUERY_SYNTAX              -- search query contains invalid FTS5 syntax
  severity: error
  recovery: "Fix the search query syntax. FTS5 supports terms, phrases (\"...\"), AND, OR, NOT, prefix*"
```

**Claim Errors (E_CLM_*)**

```
E_CLM_NOT_FOUND                 -- claim ID does not exist
  severity: error
  recovery: "Verify claim ID. Claim may have been erased"

E_CLM_ALREADY_RETRACTED         -- attempt to retract an already-retracted claim
  severity: warning
  recovery: "No action needed. Claim is already retracted"

E_CLM_CONFIDENCE_CAPPED         -- confidence was clamped to maxAutoConfidence
  severity: warning
  recovery: "Use evidence_path grounding mode to set confidence above 0.7"

E_CLM_SELF_REFERENCE            -- relationship fromId === toId
  severity: error
  recovery: "Claims cannot relate to themselves"

E_CLM_DUPLICATE_RELATIONSHIP    -- relationship already exists
  severity: warning
  recovery: "Relationship already recorded. No action needed"

E_CLM_SUPERSEDED                -- claim has been superseded by a newer claim
  severity: warning
  recovery: "Query with includeSuperseded=true to see this claim"
```

**Consent Errors (E_CON_*)**

```
E_CON_NOT_FOUND                 -- no consent record for this subject+scope
  severity: error
  recovery: "Register consent before performing this operation"

E_CON_EXPIRED                   -- consent exists but has expired
  severity: error
  recovery: "Re-register consent for this data subject and scope"

E_CON_REVOKED                   -- consent was explicitly revoked
  severity: error
  recovery: "Re-register consent for this data subject and scope"

E_CON_SCOPE_MISMATCH            -- active consent exists but for a different scope
  severity: error
  recovery: "Register consent for the specific scope required"

E_CON_REQUIRED                  -- operation on personal/sensitive/secret data requires consent
  severity: error
  recovery: "Register consent for the data subject before operating on classified data"

E_CON_RACE_DETECTED             -- consent state changed during transaction (TOCTOU prevention)
  severity: error
  recovery: "Retry the operation. Consent was revoked/expired between check and use"
```

**Classification Errors (E_CLS_*)**

```
E_CLS_MISSING                   -- claim has no classification (should be structurally impossible)
  severity: fatal
  recovery: "SYSTEM ERROR: classification gate was bypassed. Report immediately"

E_CLS_INVALID                   -- unrecognized classification value
  severity: error
  recovery: "Use one of: public, internal, confidential, personal, sensitive, secret"

E_CLS_IMMUTABLE                 -- attempt to change classification of existing claim
  severity: error
  recovery: "Retract the claim and re-assert with correct classification"
```

**Agent Errors (E_AGT_*)**

```
E_AGT_NOT_FOUND                 -- agent name/ID does not exist
  severity: error
  recovery: "Register the agent first"

E_AGT_DUPLICATE_NAME            -- agent name already taken
  severity: error
  recovery: "Choose a different agent name"

E_AGT_INVALID_TRANSITION        -- illegal status transition
  severity: error
  recovery: "Check the AgentStatus state machine for valid transitions"

E_AGT_INVALID_PROMOTION         -- trust level promotion skips a level
  severity: error
  recovery: "Trust levels must be promoted sequentially"

E_AGT_SUSPENDED                 -- agent is suspended, cannot perform operation
  severity: error
  recovery: "Reactivate the agent before performing operations"

E_AGT_DECOMMISSIONED            -- agent is decommissioned (terminal)
  severity: error
  recovery: "Decommissioned agents cannot be reactivated. Register a new agent"

E_AGT_INSUFFICIENT_TRUST        -- agent's trust level is below required minimum
  severity: error
  recovery: "Promote the agent to the required trust level first"
```

**Audit Errors (E_AUD_*)**

```
E_AUD_CHAIN_BROKEN              -- hash chain verification failed
  severity: fatal
  recovery: "CRITICAL: Audit chain integrity compromised. Investigate immediately"

E_AUD_GAP_DETECTED              -- missing sequence number in audit chain
  severity: fatal
  recovery: "CRITICAL: Audit entries are missing. Investigate immediately"

E_AUD_TAMPER_DETECTED            -- content hash does not match recorded hash
  severity: fatal
  recovery: "CRITICAL: Audit entry has been tampered with. Investigate immediately"

E_AUD_QUERY_TIMEOUT             -- audit query exceeded time budget
  severity: warning
  recovery: "Narrow the query time range or use pagination"

E_AUD_EXPORT_TOO_LARGE          -- export period contains too many entries
  severity: error
  recovery: "Narrow the export time range"
```

**Computer-Use Errors (E_CU_*)**

```
E_CU_KILL_SWITCH_ACTIVE         -- kill-switch is engaged, all actions refused
  severity: fatal
  recovery: "Kill-switch is active. No computer-use actions are permitted"

E_CU_SANDBOX_ESCAPE_BLOCKED     -- path traversal or symlink escape attempt detected
  severity: error
  recovery: "Action attempted to access paths outside sandbox boundary"

E_CU_SHELL_INJECTION_BLOCKED    -- shell metacharacter injection detected
  severity: error
  recovery: "Action command contains blocked shell metacharacters"

E_CU_NETWORK_BLOCKED            -- network access denied by sandbox policy
  severity: error
  recovery: "Sandbox network policy does not allow this request"

E_CU_EXECUTION_TIMEOUT          -- action exceeded maxExecutionMs
  severity: error
  recovery: "Action took too long. Increase maxExecutionMs or optimize the action"

E_CU_PROVENANCE_FAILED          -- sandbox could not generate provenance record
  severity: fatal
  recovery: "CRITICAL: Action cannot be completed without provenance. System error"

E_CU_ACTION_NOT_FOUND           -- action ID does not exist
  severity: error
  recovery: "Verify action ID"

E_CU_INVALID_ACTION_TYPE        -- unrecognized action type
  severity: error
  recovery: "Use one of: file_read, file_write, file_delete, shell_execute, network_request"

E_CU_ENV_LEAK_BLOCKED           -- sandbox detected attempt to access parent environment
  severity: error
  recovery: "Use explicitEnv in SandboxConfig to pass required environment variables"
```

**Cascade Errors (E_CAS_*)**

```
E_CAS_DEPTH_EXCEEDED            -- cascade exceeded max depth limit
  severity: warning
  recovery: "Cascade stopped at depth limit. Deeper dependents were not retracted"

E_CAS_CYCLE_DETECTED            -- circular dependency found in derived_from chain
  severity: error
  recovery: "Circular relationships detected. Cascade halted. Fix relationship graph"

E_CAS_ALREADY_RETRACTED         -- target claim already retracted during this cascade
  severity: warning
  recovery: "No action needed. Claim was already retracted by an earlier path in this cascade"
```

**Adapter Errors (E_ADP_*)**

```
E_ADP_NOT_FOUND                 -- adapter ID does not exist
  severity: error
  recovery: "Register the adapter first"

E_ADP_DUPLICATE_ID              -- adapter ID already registered
  severity: error
  recovery: "Choose a different adapter ID or remove existing adapter first"

E_ADP_REGISTRATION_FAILED       -- adapter threw during registration
  severity: error
  recovery: "Fix the adapter's register() implementation. Core continues without this adapter"

E_ADP_TIMEOUT                   -- adapter operation exceeded timeout
  severity: warning
  recovery: "Adapter operation was aborted. Core continues without adapter result"

E_ADP_SURFACE_VIOLATION         -- adapter attempted to access Core internals
  severity: error
  recovery: "Adapter must use the AdapterBridge interface, not Core internals"

E_ADP_MAX_COUNT_EXCEEDED        -- maximum registered adapters reached
  severity: error
  recovery: "Remove an existing adapter before registering a new one"
```

**Coordination Errors (E_CRD_*)**

```
E_CRD_CHANNEL_NOT_FOUND         -- A2A channel does not exist
  severity: error
  recovery: "Send a message to create the channel, or check channel name"

E_CRD_RULE_NOT_FOUND             -- proactive rule ID does not exist
  severity: error
  recovery: "Verify rule ID"

E_CRD_RULE_REQUIRES_ADMIN        -- rule registration requires admin trust
  severity: error
  recovery: "Only admin-level agents can register proactive rules"

E_CRD_MESSAGE_TOO_LONG           -- A2A message exceeds 2000 chars
  severity: error
  recovery: "Truncate message to 2000 characters"
```

**System Errors (E_SYS_*)**

```
E_SYS_DB_BUSY                   -- SQLite BUSY (concurrent write contention)
  severity: error
  recovery: "Retry after short delay. System uses single-writer enforcement"

E_SYS_DB_CORRUPT                -- SQLite integrity check failed
  severity: fatal
  recovery: "CRITICAL: Database corruption detected. Restore from backup"

E_SYS_INTERNAL                  -- unexpected internal error
  severity: fatal
  recovery: "Report this error with full context"

E_SYS_READ_ONLY                 -- system is in read-only mode (during backup/export)
  severity: error
  recovery: "System is temporarily read-only. Retry after operation completes"
```

---

## 3. LimenAgentClient Interface

The single entry point for all agent belief operations. Every agent operation MUST flow through this interface. No direct database access. No alternative paths. (Invariant 1; prevents FM-I1-01, FM-I1-02, FM-I1-03)

### 3.1 Construction

LimenAgentClient is obtained ONLY through the engine factory. It is never directly instantiated.

```
createLimenEngine(config: EngineConfig): Result<LimenEngine, E_SYS_INTERNAL | E_VAL_SCHEMA_MISMATCH>

EngineConfig = {
  dbPath:              string       -- absolute filesystem path to SQLite database
  maxAutoConfidence:   Confidence   -- default: 0.7, range [0.0, 1.0]
  maxCascadeDepth:     number       -- default: 10, range [1, 100]
  maxAdapters:         number       -- default: 16, range [1, 64]
  defaultDecayParams:  FSRSState    -- default FSRS parameters for new claims
  auditChainId:        string       -- identifier for this engine's audit chain
  timeProvider:        TimeProvider  -- injected clock (never Date.now())
}

TimeProvider = {
  now(): Timestamp
}
```

The engine provides client access:

```
LimenEngine.getClient(): LimenAgentClient
```

### 3.2 remember

Assert a knowledge claim into the belief graph.

```
remember(input: RememberInput): Result<Claim, RememberError>

RememberInput = {
  subject:        SubjectURN
  predicate:      Predicate
  objectValue:    ClaimContent
  objectType:     ObjectType          -- default: 'string'
  confidence:     Confidence          -- default: 0.7
  groundingMode:  GroundingMode       -- default: 'evidence_path'
  validAt:        Timestamp           -- default: now()
  missionId:      MissionId | null    -- default: null
  taskId:         TaskId | null       -- default: null
  agentId:        AgentId             -- REQUIRED: which agent is asserting
}

RememberError =
  | E_VAL_CONFIDENCE_OUT_OF_RANGE
  | E_VAL_CONFIDENCE_NAN
  | E_VAL_CONTENT_TOO_LONG
  | E_VAL_CONTENT_EMPTY
  | E_VAL_SUBJECT_INVALID
  | E_VAL_PREDICATE_INVALID
  | E_VAL_TIMESTAMP_INVALID
  | E_VAL_TIMESTAMP_OUT_OF_RANGE
  | E_VAL_UNKNOWN_FIELD
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_AGT_DECOMMISSIONED
  | E_AGT_INSUFFICIENT_TRUST      -- if predicate is protected
  | E_CON_REQUIRED                 -- if classification requires consent
  | E_CON_EXPIRED
  | E_CON_REVOKED
  | E_CON_RACE_DETECTED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Classification gate fires: content is classified. Classification is stored on claim. (Invariant 3)
  2. Confidence is clamped to maxAutoConfidence unless groundingMode permits higher. (Invariant 2)
     If clamped, E_CLM_CONFIDENCE_CAPPED is included as a warning in the result metadata.
  3. Content is sanitized: NFC normalized, direction-override chars stripped. (Prevents FM-CC-04)
  4. Secret detection runs: if content matches secret patterns, classification is upgraded to 'secret'.
     (Prevents FM-CC-03)
  5. Consent is checked within the same SQLite transaction if classification >= 'personal'. (Prevents FM-I3-01)
     Data subject extraction: the dataSubjectId for consent lookup is derived from the SubjectURN.
     If subject matches pattern `entity:user:<id>` or `entity:person:<id>`, the `<id>` portion
     is the dataSubjectId. If subject does not match a personal entity pattern, consent check
     is skipped (classification alone gates storage; consent gates personal-data operations).
  6. Hash chain is extended: contentHash computed, previousHash linked. (Invariant 6)
  7. Audit entry is appended. (Invariant 6)
  8. FSRSState is initialized from engine defaults and stored on claim. (Invariant 2; prevents FM-CC-02)
  9. All steps 1-8 are within a SINGLE SQLite transaction. If any step fails, all are rolled back.
```

### 3.3 recall

Query beliefs with temporal decay applied.

```
recall(input: RecallInput): Result<BeliefView[], RecallError>

RecallInput = {
  subject:           SubjectURN | null    -- exact match or null for all
  predicate:         Predicate | null     -- exact match, or trailing wildcard "domain.*"
  minConfidence:     Confidence           -- default: 0.0 (no filter)
  includeSuperseded: boolean              -- default: false
  limit:             number               -- default: 50, range [1, 1000]
  offset:            number               -- default: 0, range [0, MAX_SAFE_INTEGER]
  agentId:           AgentId              -- REQUIRED: for consent checking
}

RecallError =
  | E_VAL_SUBJECT_INVALID
  | E_VAL_PREDICATE_INVALID
  | E_VAL_CONFIDENCE_OUT_OF_RANGE
  | E_VAL_CONFIDENCE_NAN
  | E_VAL_SCHEMA_MISMATCH
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - effectiveConfidence is ALWAYS computed at read time via FSRS decay. (Prevents FM-I2-03)
  - Claims with classification='secret' have objectValue replaced with '[REDACTED]'. (Prevents FM-CC-03)
  - Claims with classification >= 'personal' are filtered out if no active consent exists for the
    requesting agent's context. No error returned -- they are simply invisible.
  - Results are ordered by effectiveConfidence descending, then createdAt descending.
  - NaN/Infinity never appears in effectiveConfidence. FSRS output is clamped to [0.0, 1.0]
    with finite-check before return. (Prevents FM-I2-01)
```

### 3.4 recallBulk

Batch recall for multiple subjects in one call.

```
recallBulk(input: RecallBulkInput): Result<RecallBulkResult, RecallBulkError>

RecallBulkInput = {
  subjects:      SubjectURN[]      -- 1-50 subjects
  predicate:     Predicate | null
  minConfidence: Confidence         -- default: 0.0
  limit:         number             -- per subject, default: 20, range [1, 100]
  agentId:       AgentId
}

RecallBulkResult = {
  results: Array<{
    subject: SubjectURN
    beliefs: BeliefView[]
  }>
}

RecallBulkError =
  | E_VAL_SUBJECT_INVALID
  | E_VAL_PREDICATE_INVALID
  | E_VAL_SCHEMA_MISMATCH
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

### 3.5 forget

Retract a claim. Public API — accepts only user-initiated retract reasons.

```
forget(input: ForgetInput): Result<Claim, ForgetError>

ForgetInput = {
  claimId:  ClaimId
  reason:   RetractReason    -- RESTRICTED: one of: incorrect, superseded, expired, manual
                             -- 'cascade' and 'erasure' are NOT accepted here (see below)
  agentId:  AgentId
}

ForgetError =
  | E_CLM_NOT_FOUND
  | E_CLM_ALREADY_RETRACTED
  | E_VAL_INVALID_REASON      -- if reason is 'cascade' or 'erasure'
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Claim status set to 'retracted', retractedAt set to now(), retractedReason set.
  2. Audit entry appended.
  3. If reason is 'incorrect' or 'manual', self-healing cascade MAY be triggered
     for claims with 'derived_from' relationships (see Section 8).
  4. Single transaction.

Reason restriction:
  `forget()` accepts only user-initiated reasons (incorrect, superseded, expired, manual).
  System-initiated retraction (cascade, erasure) uses `_internalRetract` (below), which
  is NOT exposed in the public API or MCP tool surface.
```

### 3.5.1 _internalRetract (engine-internal)

System-internal retraction method. NOT exposed via public API, MCP tools, or adapter surface. Called ONLY by the cascade engine (Section 8.1) and the erasure engine (Appendix C).

```
_internalRetract(claimId: ClaimId, reason: RetractReason): Result<Claim, InternalRetractError>

  reason: RetractReason    -- UNRESTRICTED: all 6 values accepted
                           -- cascade engine passes 'cascade'
                           -- erasure engine passes 'erasure'

InternalRetractError =
  | E_CLM_NOT_FOUND
  | E_CLM_ALREADY_RETRACTED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Claim status set to 'retracted', retractedAt set to now(), retractedReason set.
  2. Audit entry appended with operation reflecting the caller context
     (e.g., 'cascade.retract' for cascade, 'erasure.retract' for erasure).
  3. No agent validation — caller is trusted internal code.
  4. No cascade trigger — cascade decisions are the caller's responsibility.
  5. Within caller's existing transaction (not a new transaction).

Access control:
  - This method is a private engine internal. It MUST NOT appear on any public interface,
    adapter bridge, or MCP tool surface.
  - It is the ONLY code path that can set retractedReason to 'cascade' or 'erasure'.
  - If any public path attempts to set reason='cascade' or reason='erasure', it MUST
    return E_VAL_INVALID_REASON.
```

### 3.6 connect

Create a relationship between two claims.

```
connect(input: ConnectInput): Result<Relationship, ConnectError>

ConnectInput = {
  fromId:   ClaimId
  toId:     ClaimId
  type:     RelationshipType
  agentId:  AgentId
}

ConnectError =
  | E_CLM_NOT_FOUND            -- either claim does not exist
  | E_CLM_SELF_REFERENCE       -- fromId === toId
  | E_CLM_DUPLICATE_RELATIONSHIP
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Relationship record created.
  2. If type is 'supersedes': target claim (toId) is automatically retracted with reason 'superseded'.
  3. Audit entry appended.
  4. Single transaction.
```

### 3.7 search

Full-text search across claim content using FTS5 with BM25 ranking.

```
search(input: SearchInput): Result<SearchResult, SearchError>

SearchInput = {
  query:              string          -- 1-256 chars, FTS5 query syntax
  minConfidence:      Confidence      -- default: 0.0
  includeSuperseded:  boolean         -- default: false
  limit:              number          -- default: 20, range [1, 200]
  agentId:            AgentId
}

SearchResult = {
  results: Array<{
    belief:         BeliefView
    relevanceScore: number        -- BM25 score, [0.0, +inf), higher = more relevant
  }>
  totalMatches: number            -- total count before limit
}

SearchError =
  | E_VAL_CONTENT_EMPTY
  | E_VAL_QUERY_SYNTAX           -- FTS5 syntax error in query
  | E_VAL_SCHEMA_MISMATCH
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - Same redaction and consent filtering as recall.
  - effectiveConfidence computed at read time.
  - FTS5 query syntax errors are returned as E_VAL_QUERY_SYNTAX with descriptive message
    identifying the syntax problem. This replaces the generic E_VAL_SCHEMA_MISMATCH to
    distinguish input schema violations from search query syntax errors.
```

### 3.8 reflect

Batch-store categorized learnings. Each entry becomes a claim with predicate `reflection.<category>`. All-or-nothing transaction.

```
reflect(input: ReflectInput): Result<ReflectResult, ReflectError>

ReflectInput = {
  entries: ReflectEntry[]     -- 1-50 entries
  agentId: AgentId
}

ReflectEntry = {
  category:   ReflectCategory
  statement:  ClaimContent      -- max 500 chars
  confidence: Confidence        -- default: 0.7
}

ReflectCategory = 'decision' | 'pattern' | 'warning' | 'finding'

ReflectResult = {
  claims: Claim[]             -- one per entry, in order
}

ReflectError =
  | E_VAL_CONTENT_TOO_LONG
  | E_VAL_CONTENT_EMPTY
  | E_VAL_CONFIDENCE_OUT_OF_RANGE
  | E_VAL_CONFIDENCE_NAN
  | E_VAL_SCHEMA_MISMATCH
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - ALL entries succeed or ALL fail (single transaction).
  - Each entry generates predicate = "reflection.<category>" where category is from the input
    (one of: decision, pattern, warning, finding).
  - Subject is generated as `entity:reflection:<UUIDv7>`. The UUIDv7 is generated at assertion
    time, one per entry. This ensures each reflection entry has a unique, time-ordered subject.
  - Same classification, consent, hash-chain, audit as individual remember calls.
```

### 3.9 workingMemoryWrite

Write to a task's ephemeral working memory.

```
workingMemoryWrite(input: WMWriteInput): Result<WorkingMemoryEntry, WMWriteError>

WMWriteInput = {
  taskId:   TaskId
  key:      string      -- 1-256 chars, /^[^\s/\\][^\s/\\]{0,255}$/, no _wmp. prefix
  value:    string      -- max 65536 UTF-8 chars
  agentId:  AgentId
}

WMWriteError =
  | E_VAL_SCHEMA_MISMATCH
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Entry created or replaced in working memory store.
  2. Appends audit entry with operation='WM_WRITE', entityType='working_memory',
     entityId=taskId+'/'+key. (Invariant 13.3)
  3. Single transaction.
```

### 3.10 workingMemoryRead

Read from a task's working memory.

```
workingMemoryRead(input: WMReadInput): Result<WorkingMemoryEntry | WorkingMemoryEntry[], WMReadError>

WMReadInput = {
  taskId:  TaskId
  key:     string | null   -- null returns all entries for this task
  agentId: AgentId
}

WMReadError =
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Appends audit entry with operation='WM_READ', entityType='working_memory',
     entityId=taskId+'/'+key (or taskId+'/*' if key is null). (Invariant 13.3)
  2. Single transaction.
```

### 3.11 workingMemoryDiscard

Discard entries from a task's working memory.

```
workingMemoryDiscard(input: WMDiscardInput): Result<{ discarded: number }, WMDiscardError>

WMDiscardInput = {
  taskId:  TaskId
  key:     string | null   -- null discards all entries for this task
  agentId: AgentId
}

WMDiscardError =
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Entry or entries deleted from working memory store.
  2. Appends audit entry with operation='WM_DISCARD', entityType='working_memory',
     entityId=taskId+'/'+key (or taskId+'/*' if key is null). (Invariant 13.3)
  3. Single transaction.
```

---

## 4. Governance Interface

Consent, classification, refusal provenance, and protected predicates. Enforces Invariant 3.

### 4.1 consentRegister

Register a new consent record for a data subject.

```
consentRegister(input: ConsentRegisterInput): Result<ConsentRecord, ConsentRegisterError>

ConsentRegisterInput = {
  dataSubjectId:  string            -- 1-256 chars
  basis:          ConsentBasis
  scope:          string            -- 1-256 chars
  expiresAt:      Timestamp | null  -- null = indefinite
  agentId:        AgentId           -- registering agent
}

ConsentRegisterError =
  | E_VAL_SCHEMA_MISMATCH
  | E_VAL_TIMESTAMP_INVALID
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. ConsentRecord created with status 'active'.
  2. Audit entry appended with operation 'consent.register'.
  3. Single transaction.
```

### 4.2 consentCheck

Check if active consent exists for a data subject and scope.

```
consentCheck(input: ConsentCheckInput): Result<ConsentCheckResult, ConsentCheckError>

ConsentCheckInput = {
  dataSubjectId:  string
  scope:          string
}

ConsentCheckResult = {
  hasConsent: boolean
  record:     ConsentRecord | null   -- the matching record if hasConsent=true
}

ConsentCheckError =
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - Expiry is computed at CHECK time (not from stored status). (Prevents FM-I3-01)
  - A consent with expiresAt <= now() returns hasConsent=false even if stored status is 'active'.
```

### 4.3 consentRevoke

Revoke consent for a data subject and scope.

```
consentRevoke(input: ConsentRevokeInput): Result<ConsentRecord, ConsentRevokeError>

ConsentRevokeInput = {
  dataSubjectId:  string
  scope:          string
  agentId:        AgentId
}

ConsentRevokeError =
  | E_CON_NOT_FOUND
  | E_CON_REVOKED            -- already revoked
  | E_CON_EXPIRED            -- already expired
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. ConsentRecord status set to 'revoked', revokedAt set to now().
  2. Audit entry appended with operation 'consent.revoke'.
  3. Single transaction.
```

### 4.4 Protected Predicates

Certain predicates require elevated trust levels to write. This is a governance policy, not data.

```
ProtectedPredicatePolicy = {
  predicate:         Predicate          -- exact match or domain wildcard ("governance.*")
  minimumTrustLevel: TrustLevel
}

Default protected predicates:
  "governance.*"     -> requires 'admin'
  "system.*"         -> requires 'admin'
  "decision.*"       -> requires 'trusted'
  "lock.*"           -> requires 'trusted'

Enforcement:
  - Checked in remember() before the claim is stored.
  - If agent trust level < minimumTrustLevel, return E_AGT_INSUFFICIENT_TRUST.
```

### 4.5 Classification Engine

The classification engine is an internal subsystem invoked during `remember()`. It is NOT a public interface -- it is described here to define its contract.

```
ClassificationEngine.classify(content: ClaimContent, metadata: ClassificationMetadata): DataClassification

ClassificationMetadata = {
  subject:   SubjectURN
  predicate: Predicate
}

Behavior:
  1. Inspect content for PII patterns (email, phone, IP, names, ID numbers).
  2. Inspect content for secret patterns (API keys: AKIA*, ghp_*, Bearer *, connection strings).
  3. Inspect content for nested JSON containing PII/secret fields.
  4. Apply predicate-based heuristics (e.g., "personal.*" -> at least 'personal').
  5. Return the HIGHEST classification detected.

Classification is MANDATORY for every claim. A claim without classification
MUST NOT exist in the store. (Prevents FM-I3-02)

Misclassification mitigation (FM-I3-04):
  - The classification engine is conservative: it classifies UP, never DOWN.
  - Secret patterns are checked with OWASP-derived regex patterns (minimum: AWS AKIA,
    GitHub ghp_/gho_/ghs_, JWT, connection strings with passwords, PEM private keys).
  - Classification accuracy is measurable and subject to Quality Target verification.
```

### 4.6 Refusal Provenance

When a governance gate refuses an operation, a refusal provenance record is created.

```
RefusalRecord = {
  id:               string              -- UUIDv7
  sequenceNum:      number              -- monotonically increasing within chainId='refusal', assigned by engine at insertion time
  operation:        AuditOperation      -- what was attempted
  reason:           ErrorCode           -- which error code caused refusal
  agentId:          AgentId             -- who attempted
  timestamp:        Timestamp
  inputHash:        SHA256Hash          -- hash of the input that was refused (for replay analysis)
  contentHash:      SHA256Hash          -- hash of (sequenceNum + operation + reason + agentId + timestamp + inputHash)
  previousHash:     SHA256Hash          -- chain link to previous refusal record
  chainId:          string              -- 'refusal' chain
}

Refusal provenance is hash-chained separately from the main audit chain.
Chain integrity rules are identical to AuditEntry (Section 1.19).
Concurrent refusals are serialized to prevent chain forks. (Prevents FM-I3-03)
```

#### 4.6.1 verifyRefusalChain

Verify the integrity of the refusal provenance chain.

```
verifyRefusalChain(input: RefusalVerifyInput): Result<ChainVerifyResult, RefusalVerifyError>

RefusalVerifyInput = {
  since:  Timestamp | null    -- null = from genesis
}

ChainVerifyResult = {
  valid:          boolean
  entriesChecked: number
  firstFailure:   string | null         -- refusal record ID where failure was detected
  failureType:    'hash_mismatch' | 'gap_detected' | 'tamper_detected' | null
  verifiedAt:     Timestamp
}

RefusalVerifyError =
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Verification algorithm:
  Same as auditVerifyChain (Section 6.3) but operates on RefusalRecord entries
  using the 'refusal' chainId. RefusalRecord contains all fields needed for chain
  verification: contentHash, previousHash, and explicit sequenceNum (monotonically
  increasing, gap-free within chainId='refusal').

Note: RefusalRecord fields (contentHash, previousHash, chainId='refusal') follow
  identical integrity rules to AuditEntry. The verification walk is structurally
  identical -- recompute contentHash from fields, verify previousHash linkage,
  detect gaps.
```

### 4.7 Retention Policy Engine

The retention policy engine defines how long claims are retained based on their classification, and enforces automatic cleanup.

```
RetentionPolicy = {
  maxAgeDays:  number           -- maximum age in days before action is taken
  action:      RetentionAction  -- what happens when maxAgeDays is exceeded
}

RetentionAction = 'archive' | 'delete' | 'tombstone'

  archive:   claim is retracted with reason 'expired' (soft removal, still in DB)
  delete:    claim row is physically removed (only for 'public' and 'internal')
  tombstone: claim is retracted + tombstone appended (for classified data, preserves chain)
```

#### 4.7.1 getRetentionPolicy

```
getRetentionPolicy(classification: DataClassification): RetentionPolicy
```

Default policies per classification level:

| Classification | maxAgeDays | Action | Rationale |
|---------------|------------|--------|-----------|
| public | 730 (2 years) | delete | Low-value data, safe to purge |
| internal | 365 (1 year) | archive | Operational data, retain for audit |
| confidential | 365 (1 year) | archive | Business data, retain for audit |
| personal | 180 (6 months) | tombstone | GDPR minimization principle |
| sensitive | 90 (3 months) | tombstone | Minimize exposure window |
| secret | 30 (1 month) | tombstone | Maximum restriction |

Default policies are engine configuration. They can be overridden at engine construction time via `EngineConfig.retentionPolicies: Record<DataClassification, RetentionPolicy>`.

#### 4.7.2 enforceRetention

```
enforceRetention(input: EnforceRetentionInput): Result<RetentionResult, RetentionError>

EnforceRetentionInput = {
  agentId:  AgentId       -- must be admin
  dryRun:   boolean       -- default: false
}

RetentionResult = {
  archived:    number     -- claims archived (retracted with reason 'expired')
  deleted:     number     -- claims physically removed
  tombstoned:  number     -- claims tombstoned
  dryRun:      boolean
}

RetentionError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST    -- requires admin
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Execution:
  1. For each active claim where (now() - createdAt) > policy.maxAgeDays:
     a. If action='archive': retract via _internalRetract(claimId, 'expired').
     b. If action='delete': physically remove claim row (ONLY for public/internal).
     c. If action='tombstone': retract + append tombstone entry (same pattern as erasure).
  2. Audit entries are NEVER deleted by retention. Audit entries follow a separate
     retention policy: archive only, never delete. (Preserves audit chain integrity.)
  3. Every action generates an audit entry.
  4. Single transaction.
```

---

## 5. Lifecycle Interface

Agent registration, trust management, and status management. Enforces agent identity and trust hierarchy.

### 5.1 agentRegister

```
agentRegister(input: AgentRegisterInput): Result<Agent, AgentRegisterError>

AgentRegisterInput = {
  name:          string       -- 1-64 chars, /^[a-z0-9-]{1,64}$/
  capabilities:  string[]     -- max 32 items, each max 64 chars
  domains:       string[]     -- max 32 items, each max 64 chars
  metadata:      string       -- JSON, max 4096 chars, default: '{}'
}

AgentRegisterError =
  | E_AGT_DUPLICATE_NAME
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - New agents start at trustLevel='untrusted', status='active'.
  - Agent ID is system-generated (UUIDv7).
  - Audit entry appended.
```

### 5.2 agentPromote

```
agentPromote(input: AgentPromoteInput): Result<Agent, AgentPromoteError>

AgentPromoteInput = {
  agentId:     AgentId        -- agent to promote
  promoterId:  AgentId        -- agent performing the promotion (must be admin for trusted->admin)
}

AgentPromoteError =
  | E_AGT_NOT_FOUND
  | E_AGT_INVALID_PROMOTION
  | E_AGT_SUSPENDED
  | E_AGT_DECOMMISSIONED
  | E_AGT_INSUFFICIENT_TRUST   -- promoter lacks authority
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Promotion path: untrusted -> probationary -> trusted -> admin
  - untrusted -> probationary: any agent with trust >= probationary can promote
  - probationary -> trusted: any agent with trust >= trusted can promote
  - trusted -> admin: ONLY admin agents can promote

Side effects:
  1. Trust level incremented by one step.
  2. Audit entry appended.
```

### 5.3 agentDemote

```
agentDemote(input: AgentDemoteInput): Result<Agent, AgentDemoteError>

AgentDemoteInput = {
  agentId:    AgentId
  demoterId:  AgentId       -- must be admin
}

AgentDemoteError =
  | E_AGT_NOT_FOUND
  | E_AGT_INVALID_PROMOTION   -- already at lowest level
  | E_AGT_SUSPENDED
  | E_AGT_DECOMMISSIONED
  | E_AGT_INSUFFICIENT_TRUST  -- only admin can demote
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Demotion path: admin -> trusted -> probationary -> untrusted
  - Only admin agents can demote.
  - Demotion is by one level per call.

Side effects:
  1. Trust level decremented by one step.
  2. Audit entry appended.
```

### 5.4 agentSuspend

```
agentSuspend(input: AgentSuspendInput): Result<Agent, AgentSuspendError>

AgentSuspendInput = {
  agentId:     AgentId
  suspenderId: AgentId      -- must be admin or trusted
  reason:      string       -- 1-256 chars
}

AgentSuspendError =
  | E_AGT_NOT_FOUND
  | E_AGT_INVALID_TRANSITION  -- already suspended or decommissioned
  | E_AGT_INSUFFICIENT_TRUST
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Agent status set to 'suspended'.
  2. All pending computer-use actions by this agent are killed.
  3. Audit entry appended with reason.
```

### 5.5 agentReactivate

```
agentReactivate(input: AgentReactivateInput): Result<Agent, AgentReactivateError>

AgentReactivateInput = {
  agentId:       AgentId
  reactivatorId: AgentId     -- must be admin or trusted
}

Constraint: reactivatorId must have trust level >= the suspended agent's trust level.
  A trusted-level agent cannot reactivate an admin-level agent. Violation returns
  E_AGT_INSUFFICIENT_TRUST.

AgentReactivateError =
  | E_AGT_NOT_FOUND
  | E_AGT_INVALID_TRANSITION  -- not suspended, or decommissioned
  | E_AGT_INSUFFICIENT_TRUST  -- reactivator trust < suspended agent trust, or reactivator is untrusted/probationary
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Agent status set to 'active'.
  2. Audit entry appended.
```

### 5.6 agentDecommission

```
agentDecommission(input: AgentDecommissionInput): Result<Agent, AgentDecommissionError>

AgentDecommissionInput = {
  agentId:          AgentId
  decommissionerId: AgentId     -- must be admin
  reason:           string      -- 1-256 chars
}

AgentDecommissionError =
  | E_AGT_NOT_FOUND
  | E_AGT_INVALID_TRANSITION  -- already decommissioned
  | E_AGT_INSUFFICIENT_TRUST  -- only admin
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. Agent status set to 'decommissioned' (TERMINAL -- no recovery).
  2. All pending computer-use actions by this agent are killed.
  3. Audit entry appended with reason.
```

### 5.7 agentGet

```
agentGet(input: { agentId: AgentId } | { name: string }): Result<Agent, E_AGT_NOT_FOUND | E_SYS_INTERNAL>
```

### 5.8 agentList

```
agentList(input: AgentListInput): Result<Agent[], E_SYS_INTERNAL>

AgentListInput = {
  status:      AgentStatus | null    -- filter by status, null = all
  trustLevel:  TrustLevel | null     -- filter by trust, null = all
  limit:       number                -- default: 50, range [1, 200]
}
```

---

## 6. Audit Interface

Immutable, hash-chained audit trail. Queryable in real time. Enforces Invariant 6.

### 6.1 auditAppend

Internal method -- NOT directly callable by agents. Called automatically by all state-changing operations.

```
auditAppend(input: AuditAppendInput): Result<AuditEntry, AuditAppendError>

AuditAppendInput = {
  operation:   AuditOperation
  entityType:  AuditEntityType
  entityId:    string
  agentId:     AgentId
  payload:     string          -- JSON, max 4096 chars
}

AuditAppendError =
  | E_AUD_CHAIN_BROKEN         -- previous hash mismatch (indicates corruption)
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - sequenceNum is assigned within a transaction (gap-free).
  - contentHash is computed deterministically from all fields.
  - previousHash is the contentHash of the most recent entry in the same chainId.
  - For the FIRST entry in a chain: previousHash = SHA256('GENESIS').
  - Append is SYNCHRONOUS with the operation it records. Never fire-and-forget.
    (Prevents FM-I5-03 -- provenance omission vector)
```

### 6.2 auditQuery

```
auditQuery(input: AuditQueryInput): Result<AuditQueryResult, AuditQueryError>

AuditQueryInput = {
  chainId:      string | null       -- filter by chain, null = all
  operation:    AuditOperation | null
  entityType:   AuditEntityType | null
  entityId:     string | null
  agentId:      AgentId | null
  fromTimestamp: Timestamp | null   -- inclusive
  toTimestamp:   Timestamp | null   -- exclusive
  limit:        number              -- default: 100, range [1, 1000]
  offset:       number              -- default: 0
}

AuditQueryResult = {
  entries:     AuditEntry[]
  totalCount:  number
  hasMore:     boolean
}

AuditQueryError =
  | E_VAL_TIMESTAMP_INVALID
  | E_VAL_SCHEMA_MISMATCH
  | E_AUD_QUERY_TIMEOUT
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Performance guarantee:
  - Queries on indexed fields (timestamp, operation, entityType, entityId, agentId)
    must return within 50ms for up to 100,000 entries. (Quality Target QT-1; prevents FM-I6-02)
  - Indices MUST exist on: (chainId, sequenceNum), (timestamp), (entityType, entityId), (agentId).
```

### 6.3 auditVerifyChain

Verify the integrity of an audit chain.

```
auditVerifyChain(input: AuditVerifyInput): Result<AuditVerifyResult, AuditVerifyError>

AuditVerifyInput = {
  chainId:       string
  fromSequence:  number | null    -- null = from genesis
  toSequence:    number | null    -- null = to latest
}

AuditVerifyResult = {
  valid:          boolean
  entriesChecked: number
  firstFailure:   AuditEntryId | null   -- null if valid
  failureType:    'hash_mismatch' | 'gap_detected' | 'tamper_detected' | null
  verifiedAt:     Timestamp
}

AuditVerifyError =
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Verification algorithm:
  1. Walk entries in sequenceNum order within chainId.
  2. For each entry: recompute contentHash from fields. If != stored contentHash -> tamper_detected.
  3. For each entry after first: check previousHash === preceding entry's contentHash. If != -> hash_mismatch.
  4. Check sequenceNum is gap-free: entry[i].sequenceNum === entry[i-1].sequenceNum + 1. If != -> gap_detected.
  5. Return on first failure (short-circuit for efficiency). (Prevents FM-QT1-01 -- O(n) on every write)

Performance:
  - Verification is NOT performed on every write. It is an on-demand operation.
  - Write-time integrity is guaranteed by the transaction: previousHash is read and contentHash
    is computed within the same SQLite transaction.
  - Full chain verification is O(n) but only runs on explicit request, not on every claim write.
    This prevents FM-QT1-01 (latency spike from chain verification on write).
```

### 6.4 auditExport

Generate SOC 2 audit export for a time period.

```
auditExport(input: AuditExportInput): Result<AuditExportResult, AuditExportError>

AuditExportInput = {
  fromDate:   string       -- ISO 8601 date (YYYY-MM-DD)
  toDate:     string       -- ISO 8601 date (YYYY-MM-DD)
  agentId:    AgentId      -- exporting agent, must be admin
}

AuditExportResult = {
  entries:           AuditEntry[]
  chainIntegrity:    AuditVerifyResult
  statistics: {
    totalEntries:    number
    byOperation:     Record<AuditOperation, number>
    byEntityType:    Record<AuditEntityType, number>
    dateRange:       { from: string; to: string }
  }
  exportedAt:        Timestamp
  exportHash:        SHA256Hash    -- hash of the entire export payload
}

AuditExportError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST    -- requires admin
  | E_AUD_EXPORT_TOO_LARGE     -- > 100,000 entries in period
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

---

## 7. Computer-Use Interface

Sandbox execution, provenance, kill-switch, and refusal. Enforces Invariant 5.

### 7.1 actionExecute

Execute a computer-use action within a governed sandbox.

```
actionExecute(input: ActionExecuteInput): Result<ComputerUseAction, ActionExecuteError>

ActionExecuteInput = {
  type:          ActionType
  command:       string          -- 1-4096 chars
  sandboxConfig: SandboxConfig
  agentId:       AgentId
  missionId:     MissionId | null
  taskId:        TaskId | null
}

ActionExecuteError =
  | E_CU_KILL_SWITCH_ACTIVE
  | E_CU_SANDBOX_ESCAPE_BLOCKED
  | E_CU_SHELL_INJECTION_BLOCKED
  | E_CU_NETWORK_BLOCKED
  | E_CU_EXECUTION_TIMEOUT
  | E_CU_PROVENANCE_FAILED
  | E_CU_INVALID_ACTION_TYPE
  | E_CU_ENV_LEAK_BLOCKED
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_AGT_INSUFFICIENT_TRUST    -- requires trusted or above
  | E_CON_REQUIRED               -- computer-use on sensitive data requires consent
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Execution sequence (ALL steps mandatory, ALL audited):
  1. CHECK kill-switch state. If active -> refuse with E_CU_KILL_SWITCH_ACTIVE.
  2. VALIDATE agent trust level >= 'trusted'.
  3. VALIDATE sandbox config: all paths canonicalized, no symlink escape, no traversal.
  4. VALIDATE command: scan for shell injection metacharacters.
  5. CREATE sandbox environment:
     a. Mount only allowedPaths (canonicalized, under rootPath).
     b. Set network policy.
     c. Set ONLY explicitEnv variables (NEVER inherit parent env). (Prevents FM-I5-04)
     d. Set execution timeout.
  6. EXECUTE action within sandbox.
     - Kill-switch is polled every 10ms during execution. If activated, action is SIGKILL'd.
       (Prevents FM-I5-01)
  7. GENERATE provenance record from sandbox runtime (NOT from action code). (Prevents FM-I5-02)
     - If provenance generation fails -> action result is DISCARDED. E_CU_PROVENANCE_FAILED returned.
       (Prevents FM-I5-03 -- no action completes without provenance)
  8. APPEND audit entry with full provenance.
  9. RETURN result.

  Steps 7-8 are in the SAME transaction. If audit write fails, provenance is not orphaned.

Kill-switch enforcement:
  - The kill-switch check is NOT just at step 1. It is checked CONTINUOUSLY (every 10ms poll)
    during execution (step 6). (Prevents FM-I5-01)
  - After kill-switch activation, any action still executing MUST terminate within 100ms
    (propagationBudgetMs). Actions exceeding this budget are SIGKILL'd.
```

### 7.2 actionRefuse

Record that an action was refused by governance.

```
actionRefuse(input: ActionRefuseInput): Result<RefusalRecord, ActionRefuseError>

ActionRefuseInput = {
  operation:  AuditOperation
  reason:     ErrorCode
  agentId:    AgentId
  inputHash:  SHA256Hash      -- hash of the refused input
}

ActionRefuseError =
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Side effects:
  1. RefusalRecord created and hash-chained.
  2. Audit entry appended.
  3. Single transaction.
```

### 7.3 killSwitchActivate

Activate the system-wide kill-switch. All in-flight and future computer-use actions are stopped/refused.

```
killSwitchActivate(input: KillSwitchInput): Result<KillSwitchState, KillSwitchError>

KillSwitchInput = {
  agentId: AgentId    -- must be admin
}

KillSwitchError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST   -- only admin
  | E_SYS_INTERNAL

Side effects:
  1. KillSwitchState.active set to true.
  2. ALL in-flight actions are sent SIGKILL.
  3. Audit entry appended with operation 'action.kill'.
  4. New actions are refused with E_CU_KILL_SWITCH_ACTIVE until deactivated.
```

### 7.4 killSwitchDeactivate

```
killSwitchDeactivate(input: KillSwitchInput): Result<KillSwitchState, KillSwitchError>

Same signature and errors as activate. Must be admin.
Side effects: KillSwitchState.active set to false. Audit entry appended.
```

### 7.5 killSwitchStatus

```
killSwitchStatus(): Result<KillSwitchState, E_SYS_INTERNAL>
```

---

## 8. Self-Healing Interface

Cascade retraction, depth limiting, and relationship graph management. Enforces the self-healing aspect of Invariant 2.

### 8.1 cascadeTrigger

Trigger a retraction cascade from a root claim through its `derived_from` dependency tree.

```
cascadeTrigger(input: CascadeTriggerInput): Result<CascadeResult, CascadeTriggerError>

CascadeTriggerInput = {
  rootClaimId:   ClaimId
  reason:        RetractReason     -- typically 'cascade' for automatic, 'incorrect' for manual
  maxDepth:      number | null     -- null = use engine default (maxCascadeDepth from config)
  agentId:       AgentId
}

CascadeResult = {
  rootClaimId:     ClaimId
  retractedClaims: ClaimId[]       -- all claims retracted (including root)
  depth:           number          -- actual depth reached
  depthLimited:    boolean         -- true if cascade stopped at maxDepth
  cyclesDetected:  ClaimId[]       -- claim IDs where cycles were found (should be empty in healthy graph)
  duration:        number          -- milliseconds
}

CascadeTriggerError =
  | E_CLM_NOT_FOUND
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Cascade algorithm:
  1. Start at rootClaimId. Mark as visited. Retract via _internalRetract(rootClaimId, reason) (Section 3.5.1).
  2. Find all claims where relationship.type='derived_from' AND relationship.toId=currentClaimId.
     These are claims that DERIVE FROM the current claim (strong dependency).
  3. For each dependent:
     a. If already visited -> skip (prevents infinite loops). Record in cyclesDetected. (Prevents FM-I2-04 loop case)
     b. If already retracted -> skip. (Prevents FM-I2-04 double retraction)
     c. If depth >= maxDepth -> skip. Record depthLimited=true. (Prevents FM-I2-04 unbounded depth)
     d. Retract the claim via _internalRetract(claimId, 'cascade') (Section 3.5.1).
     e. Recurse to step 2 with this claim.
  4. 'supports' relationships are NOT followed. Only 'derived_from'. (Prevents FM-I2-04 over-retraction)
  5. Every retraction generates an audit entry with operation 'cascade.retract'.
  6. Entire cascade is within a SINGLE transaction.

Depth limit:
  - Default: engine config maxCascadeDepth (default 10, range [1, 100]).
  - When hit: cascade stops, CascadeResult.depthLimited=true, E_CAS_DEPTH_EXCEEDED warning logged.
  - Claims beyond the depth limit are NOT retracted. This is a safety valve, not a bug.
```

### 8.2 consolidate

Merge similar claims, archive stale low-confidence claims.

```
consolidate(input: ConsolidateInput): Result<ConsolidateResult, ConsolidateError>

ConsolidateInput = {
  mergeSimilarityThreshold:  number     -- [0.0, 1.0], default: 0.98
  archiveMaxConfidence:      Confidence -- claims below this are archive candidates, default: 0.3
  archiveMaxAccessCount:     number     -- max access count for archive, default: 1
  dryRun:                    boolean    -- preview without applying, default: false
  agentId:                   AgentId    -- must be trusted or admin
}

ConsolidateResult = {
  merged:    number          -- pairs merged
  archived:  number          -- claims archived (retracted with reason 'expired')
  conflicts: ConflictReport[] -- detected contradictions
  dryRun:    boolean
}

ConflictReport = {
  claimA:    ClaimId
  claimB:    ClaimId
  type:      'contradicts'
  resolution: 'suggested' | 'applied'
  suggestion: string          -- what the system suggests
}

ConsolidateError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_AGT_SUSPENDED
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Similarity computation:
  - Similarity is computed via exact content hash comparison (deduplication) and optional
    embedding cosine similarity when vector search is configured.
  - Without vector search, only exact-match merging is performed: two claims with identical
    contentHash, same subject, and same predicate are merge candidates.
  - The mergeSimilarityThreshold parameter applies ONLY when embedding-based similarity is
    available. It is ignored in exact-match-only mode (exact match is effectively threshold=1.0).
  - When embeddings are available, similarity = cosine(embedding_A, embedding_B) where
    embeddings are computed by the configured embedding model. Claims are merge candidates
    when similarity >= mergeSimilarityThreshold AND same subject AND same predicate.

Guarantees:
  - Merge: two claims are merged IFF content similarity >= threshold AND same subject AND same predicate.
    The claim with higher confidence survives. The lower is retracted with reason 'superseded'.
  - Archive: a claim is archived IFF effectiveConfidence < archiveMaxConfidence AND access count <= archiveMaxAccessCount AND status = 'active'.
  - Conflicts: claims connected by 'contradicts' relationships are reported.
  - Every merge and archive generates an audit entry.
  - Single transaction (all-or-nothing).
```

### 8.3 relationshipQuery

Query relationships for a given claim.

```
relationshipQuery(input: RelationshipQueryInput): Result<Relationship[], RelationshipQueryError>

RelationshipQueryInput = {
  claimId:     ClaimId
  direction:   'outgoing' | 'incoming' | 'both'   -- default: 'both'
  type:        RelationshipType | null              -- filter by type, null = all
  limit:       number                               -- default: 50, range [1, 200]
}

RelationshipQueryError =
  | E_CLM_NOT_FOUND
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

---

## 9. Coordination Interface

Agent-to-agent messaging, proactive rules, and channel management. Supports multi-agent coordination.

### 9.1 a2aSend

Send a message to a channel or direct to another agent.

```
a2aSend(input: A2ASendInput): Result<A2AMessage, A2ASendError>

A2ASendInput = {
  sender:    AgentId
  message:   string          -- 1-2000 chars
  channel:   string | null   -- 1-64 chars, null for DM
  to:        AgentId | null  -- recipient for DM, null for channel
  mentions:  AgentId[]       -- max 10
}

A2AMessage = {
  id:         ClaimId         -- messages are stored as claims
  sender:     AgentId
  channel:    string | null
  to:         AgentId | null
  message:    string
  mentions:   AgentId[]
  sentAt:     Timestamp
}

A2ASendError =
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_CRD_MESSAGE_TOO_LONG
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - Messages are stored as governed claims (subject + predicate pattern).
  - Messages are immutable (same as claims).
  - Audit entry appended.

Classification of A2A messages:
  - A2A messages are classified as `internal` by default. This means they are exempt from
    personal-data consent requirements, preventing a pathological scenario where every
    inter-agent message triggers consent lookups.
  - Messages containing PII patterns (detected by the same PII scanner used in the
    Classification Engine, Section 4.5) are upgraded to `personal` classification and
    require consent before storage. This preserves PII protection without burdening
    routine agent coordination with consent overhead.
  - Messages containing secret patterns are upgraded to `secret` classification and
    redacted in read responses (same as claims).
```

### 9.2 a2aRead

Read messages from a channel or DM thread.

```
a2aRead(input: A2AReadInput): Result<A2AMessage[], A2AReadError>

A2AReadInput = {
  channel:  string | null      -- channel name, null for DM
  agentId:  AgentId            -- reading agent (for DM thread identification)
  from:     AgentId | null     -- other party in DM, null for channel
  limit:    number             -- default: 20, range [1, 100]
  since:    Timestamp | null   -- only messages after this time
}

A2AReadError =
  | E_AGT_NOT_FOUND
  | E_AGT_SUSPENDED
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Guarantees:
  - Messages returned in chronological order.
  - DMs are transparent -- any agent can read any thread (governance design decision).
```

### 9.3 a2aChannels

List active channels and DM threads.

```
a2aChannels(): Result<A2AChannelInfo[], E_SYS_INTERNAL>

A2AChannelInfo = {
  name:           string
  type:           'channel' | 'dm'
  participants:   AgentId[]
  lastActivity:   Timestamp
  messageCount:   number
}
```

### 9.4 ruleRegister

Register a proactive automation rule.

```
ruleRegister(input: RuleRegisterInput): Result<ProactiveRule, RuleRegisterError>

RuleRegisterInput = {
  name:          string           -- 1-128 chars
  description:   string           -- 1-1024 chars
  triggerType:   RuleTriggerType
  triggerConfig: string           -- JSON, max 4096 chars
  actionType:    RuleActionType
  actionConfig:  string           -- JSON, max 4096 chars
  agentId:       AgentId          -- must be admin
}

RuleRegisterError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST     -- requires admin
  | E_CRD_RULE_REQUIRES_ADMIN
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

### 9.5 Proactive Rule Execution

Defines how registered proactive rules are evaluated and executed at runtime.

```
Rule Evaluation Lifecycle:

  1. TRIGGER POINT: Rules are evaluated on every `remember()` call, after the claim
     has been successfully stored but before the transaction commits. This means
     rule-triggered actions participate in the same transaction boundary.

  2. TRIGGER MATCHING: For each active rule where triggerType='claim_asserted' or
     triggerType='pattern_match', the newly asserted claim's predicate is compared
     against the rule's triggerConfig. Match semantics:
       - 'claim_asserted': triggerConfig.predicates (array of Predicate patterns)
         are compared against the new claim's predicate. Supports exact match and
         trailing wildcard (e.g., "decision.*").
       - 'pattern_match': triggerConfig.pattern (regex) is tested against the claim's
         objectValue content.
       - 'confidence_threshold': triggerConfig.threshold (Confidence) is compared
         against the new claim's confidence. Fires when confidence crosses threshold.
       - 'schedule': evaluated by a separate timer, not on remember(). Period defined
         in triggerConfig.intervalMs.

  3. EXECUTION IDENTITY: Matched rules execute under the system agent identity
     (the agent registered with name 'system', trust level 'admin'). The rule's
     approvedBy field serves as the authorization chain — proving an admin approved
     this automated action.

  4. GOVERNANCE PIPELINE: Rule-triggered actions go through the FULL governance
     pipeline — classification, consent check, protected predicate enforcement,
     audit trail. No shortcuts. A rule-triggered remember() is identical to an
     agent-initiated remember() except for the executing identity.

  5. FAILURE HANDLING: If a rule-triggered action fails:
       a. The failure is logged as an audit entry (operation='rule.execute_failed').
       b. The rule's consecutive failure counter is incremented.
       c. After 3 consecutive failures, the rule is automatically suspended
          (status set to 'suspended'). Audit entry with operation='rule.suspend'
          is appended with reason 'auto_suspend_consecutive_failures'.
       d. Manual reactivation is required to re-enable the rule.

  6. RECURSION BLOCKING: Rule execution depth is capped at 1. If a rule-triggered
     remember() would itself trigger another rule, the nested trigger is SKIPPED.
     This prevents infinite loops and unbounded chain reactions. The skipped trigger
     is logged as an audit entry (operation='rule.recursion_blocked').

  7. ORDERING: When multiple rules match the same claim, they execute in rule
     registration order (by createdAt ascending). Earlier-registered rules fire first.
```

### 9.6 ruleList

```
ruleList(input: RuleListInput): Result<ProactiveRule[], E_SYS_INTERNAL>

RuleListInput = {
  status: RuleStatus | null    -- filter, null = all
  limit:  number               -- default: 50, range [1, 200]
}
```

### 9.7 ruleSuspend

```
ruleSuspend(input: { ruleId: RuleId; agentId: AgentId }): Result<ProactiveRule, RuleSuspendError>

RuleSuspendError =
  | E_CRD_RULE_NOT_FOUND
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

### 9.8 ruleRetire

```
ruleRetire(input: { ruleId: RuleId; agentId: AgentId }): Result<ProactiveRule, RuleRetireError>

RuleRetireError =
  | E_CRD_RULE_NOT_FOUND
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL
```

---

## 10. AdapterRegistry Interface

Framework integration. Thin. Zero core change. Enforces Invariant 4.

### 10.1 Design Principles

The AdapterRegistry provides a controlled bridge between external frameworks (LangChain, CrewAI, etc.) and LimenAgentClient. It does NOT provide direct access to Core internals.

```
AdapterBridge = {
  // The ONLY interface an adapter receives. A frozen, read-only view of LimenAgentClient.
  // No engine internals, no DB handle, no event bus, no internal types.
  // (Prevents FM-I1-02)

  remember:              LimenAgentClient['remember']
  recall:                LimenAgentClient['recall']
  recallBulk:            LimenAgentClient['recallBulk']
  forget:                LimenAgentClient['forget']
  connect:               LimenAgentClient['connect']
  search:                LimenAgentClient['search']
  reflect:               LimenAgentClient['reflect']
  workingMemoryWrite:    LimenAgentClient['workingMemoryWrite']
  workingMemoryRead:     LimenAgentClient['workingMemoryRead']
  workingMemoryDiscard:  LimenAgentClient['workingMemoryDiscard']
}

The AdapterBridge object is:
  - Object.freeze()'d -- properties cannot be added, removed, or reconfigured.
  - Methods are bound -- `this` cannot be rebound to access engine internals.
  - Prototype chain is null -- Object.getPrototypeOf(bridge) === null.
    (Prevents FM-I1-02 prototype chain walk)
```

### 10.2 Adapter Interface

What an adapter must implement to register with the system.

```
LimenAdapter = {
  id:          AdapterId
  name:        string           -- 1-64 chars, human-readable
  version:     string           -- semver
  register:    (bridge: AdapterBridge) => Result<void, AdapterRegistrationError>
  unregister:  () => Result<void, AdapterUnregistrationError>
}

AdapterRegistrationError = {
  code: string
  message: string
}

AdapterUnregistrationError = {
  code: string
  message: string
}
```

### 10.3 adapterRegister

```
adapterRegister(input: AdapterRegisterInput): Result<RegisteredAdapter, AdapterRegisterError>

AdapterRegisterInput = {
  adapter:   LimenAdapter
  agentId:   AgentId            -- registering agent, must be trusted or admin
}

RegisteredAdapter = {
  id:           AdapterId
  name:         string
  version:      string
  registeredAt: Timestamp
  status:       'active' | 'failed' | 'removed'
}

AdapterRegisterError =
  | E_ADP_DUPLICATE_ID
  | E_ADP_REGISTRATION_FAILED
  | E_ADP_MAX_COUNT_EXCEEDED
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_SYS_INTERNAL

Registration sequence:
  1. Check adapter count < maxAdapters.
  2. Create AdapterBridge (frozen, null-prototype, bound methods).
  3. Call adapter.register(bridge) within a try/catch with timeout (5000ms).
     - If adapter throws: return E_ADP_REGISTRATION_FAILED. Core is unaffected. (Prevents FM-I4-02)
     - If adapter times out: return E_ADP_TIMEOUT. Core is unaffected. (Prevents FM-I4-02)
  4. Record adapter in registry.
  5. Audit entry appended.

Isolation guarantees:
  - Adapter registration does NOT modify any shared state. (Prevents FM-I4-01)
  - The AdapterBridge is unique per adapter -- no shared mutable references.
  - Adapter code runs in try/catch with timeout -- crashes are caught, not propagated. (Prevents FM-I4-02)
  - Global configuration is frozen before any adapter registration occurs.
```

### 10.4 adapterRemove

```
adapterRemove(input: { adapterId: AdapterId; agentId: AgentId }): Result<void, AdapterRemoveError>

AdapterRemoveError =
  | E_ADP_NOT_FOUND
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_SYS_INTERNAL

Side effects:
  1. Call adapter.unregister() within try/catch with timeout. Failures are logged, not propagated.
  2. Remove adapter from registry.
  3. Audit entry appended.
```

### 10.5 adapterList

```
adapterList(): Result<RegisteredAdapter[], E_SYS_INTERNAL>
```

### 10.6 Surface Size Limit

The AdapterRegistry public surface is LIMITED to:
  - adapterRegister
  - adapterRemove
  - adapterList

Total: 3 methods. Maximum permitted: 5 methods (to allow bounded growth for adapter health/metrics).
Any growth beyond 5 requires explicit PA authorization and FORGE-GATE.md entry. (Prevents FM-I8-01)

---

## 11. FMA-to-Contract Traceability

For each of the 10 CATASTROPHIC failure modes, the specific contract clause(s) that prevent it.

| FM ID | Failure Mode | Preventing Contract Clause(s) |
|-------|-------------|-------------------------------|
| **FM-I1-01** | SQLite direct access bypass | Section 3 preamble: "Every agent operation MUST flow through this interface." Section 10.1: AdapterBridge is the ONLY interface adapters receive -- no DB handle, no engine internals. Section 3.1: LimenAgentClient obtained ONLY through engine factory. |
| **FM-I1-02** | Adapter re-export of Core internals | Section 10.1: AdapterBridge is Object.freeze()'d, methods are bound, prototype chain is null. Section 10.3: bridge is unique per adapter, no shared mutable references. |
| **FM-I1-03** | MCP tool handler bypass | Section 2.3: E_VAL_UNKNOWN_FIELD rejects unknown fields via Zod strict parsing. Section 3.2: remember() has explicit input schema -- no `sql`, `rawMode`, or `admin` fields. All operations are typed with exhaustive error unions. |
| **FM-I3-03** | Refusal provenance hash chain break | Section 4.6: RefusalRecord has contentHash and previousHash chain. "Concurrent refusals are serialized to prevent chain forks." |
| **FM-I5-01** | Kill-switch failure | Section 7.1 step 6: "Kill-switch is polled every 10ms during execution." Section 1.22: propagationBudgetMs=100 literal. Section 7.3: kill-switch activation SIGKILLs all in-flight actions. |
| **FM-I5-02** | Sandbox provenance forgery | Section 1.22: ActionProvenance.generatedBy = 'sandbox_runtime' (LITERAL). Section 7.1 step 7: "GENERATE provenance record from sandbox runtime (NOT from action code)." |
| **FM-I5-03** | Provenance omission | Section 7.1 step 7: "If provenance generation fails -> action result is DISCARDED." Section 6.1: "Append is SYNCHRONOUS with the operation it records. Never fire-and-forget." |
| **FM-I5-04** | Sandbox containment escape | Section 1.22: SandboxConfig.inheritEnv = false (LITERAL). Path canonicalization via realpath(). Symlink resolution before containment check. Section 7.1 step 3: validation of paths, step 4: shell injection scan. |
| **FM-I6-01** | Audit chain silent tampering | Section 1.19: AuditEntry immutability constraints -- no modification, no deletion. Gap-free sequenceNum. Hash chain with previousHash. Section 6.3: verification detects tamper, gap, and hash mismatch. |
| **FM-I7-02** | FORGE-GATE.md forgery | Section 6.4: auditExport includes chainIntegrity verification. Export hash (exportHash) serves as cross-validation anchor. (FORGE-GATE.md itself is a process artifact outside the runtime system -- its integrity is verified by SolisForge gate process, not by Limen code.) |

---

## 12. Parameter Range Summary

Consolidated reference for all constrained parameters.

| Parameter | Type | Range | Default | Validation |
|-----------|------|-------|---------|------------|
| confidence | number | [0.0, 1.0] | 0.7 | Reject NaN, Infinity, negative. Clamp to range. |
| maxAutoConfidence | number | [0.0, 1.0] | 0.7 | Engine config. Applied to all non-evidence-grounded writes. |
| maxCascadeDepth | number | [1, 100] | 10 | Engine config. Cascade stops at this depth. |
| maxAdapters | number | [1, 64] | 16 | Engine config. |
| content length | chars | [1, 500] | -- | Reject empty and overlength. |
| subject length | chars | [10, 512] | -- | Must match URN format. |
| predicate length | chars | [3, 130] | -- | Must match domain.property format. |
| timestamp range | date | [2020-01-01, 2100-01-01) | now() | Reject out of range. |
| hash length | chars | exactly 64 | -- | Lowercase hex only. |
| agent name | chars | [1, 64] | -- | Lowercase alphanumeric + hyphens. |
| message length | chars | [1, 2000] | -- | A2A messages. |
| payload length | chars | [0, 4096] | -- | Audit entry payload. |
| WM value length | chars | [1, 65536] | -- | Working memory entry. |
| WM key length | chars | [1, 256] | -- | No whitespace, no path separators. |
| FSRS stability | number | [0.01, 1000.0] | engine default | Finite, positive. |
| FSRS difficulty | number | [0.0, 1.0] | engine default | Finite. |
| FSRS elapsedDays | number | [0, 36500] | 0 | Non-negative integer. |
| FSRS reps | number | [0, 100000] | 0 | Non-negative integer. |
| recall limit | number | [1, 1000] | 50 | -- |
| recallBulk subjects | count | [1, 50] | -- | -- |
| recallBulk limit | number | [1, 100] | 20 | Per subject. |
| search limit | number | [1, 200] | 20 | -- |
| reflect entries | count | [1, 50] | -- | -- |
| audit query limit | number | [1, 1000] | 100 | -- |
| agent list limit | number | [1, 200] | 50 | -- |
| adapter timeout | ms | 5000 | 5000 | Registration timeout. |
| action maxExecutionMs | ms | [100, 300000] | -- | Required in SandboxConfig. |
| action maxOutputBytes | bytes | [0, 67108864] | -- | 64MB max. |
| kill-switch propagation | ms | 100 | 100 | LITERAL. Non-configurable. |
| kill-switch poll interval | ms | 10 | 10 | During action execution. |
| governance latency budget | ms | 50 | 50 | Quality Target QT-1. |
| governance overhead | % | [0, 40] | -- | Quality Target QT-4. |

---

## 13. Cross-Interface Invariants

These are system-wide truths that span multiple interfaces and cannot be expressed within a single interface contract.

### 13.1 Single-Writer Enforcement

All write operations to the SQLite database go through a single connection. There is no multi-connection write path. Concurrent write attempts from different callers are serialized by the engine (not by SQLite's BUSY handler). This prevents FM-I6-03 (concurrent write corruption).

### 13.2 Transaction Atomicity

Every state-changing operation (remember, forget, connect, cascade, consolidate, consent operations, agent operations, action execution) is wrapped in a single SQLite transaction. If any step fails, all changes are rolled back. There are no partial writes.

### 13.3 Audit Completeness

Every state-changing operation appends an audit entry within the same transaction as the state change. There is no state change without a corresponding audit entry. There is no audit entry without a corresponding state change (except chain verification and export, which are read operations that audit themselves).

### 13.4 Consent-Before-Data

For claims with classification >= 'personal': consent check and claim write are in the SAME SQLite transaction. There is no window between consent check and claim write where consent could be revoked. This prevents FM-I3-01 (TOCTOU).

### 13.5 Classification Completeness

Every claim in the store has a non-null classification. This is enforced by:
  1. The `remember()` method always runs the classification engine.
  2. The `reflect()` method runs classification per entry.
  3. The database schema has a NOT NULL constraint on the classification column.
  4. There is no UPDATE path that can null out classification.
  5. There is no bulk insert path that bypasses classification. (Prevents FM-I3-02)

### 13.6 Decay Completeness

Every read path that returns claim data computes FSRS decay at read time:
  - `recall()` -- applies decay
  - `recallBulk()` -- applies decay
  - `search()` -- applies decay
  - `relationshipQuery()` -- does NOT return confidence (returns Relationship, not BeliefView)
  - `auditQuery()` -- does NOT return belief data (returns AuditEntry)
  - Working memory operations -- not claims, no decay applicable

There is no read path that returns a BeliefView without computing effectiveConfidence. (Prevents FM-I2-03)

### 13.7 Hash Chain Integrity

Two independent hash chains exist:
  1. **Audit chain** (AuditEntry.contentHash -> AuditEntry.previousHash) -- one per chainId.
  2. **Refusal chain** (RefusalRecord.contentHash -> RefusalRecord.previousHash) -- chainId='refusal'.

Both chains:
  - Start with previousHash = SHA256('GENESIS').
  - Are append-only (no modification, no deletion except GDPR erasure tombstoning).
  - Have gap-free sequence numbers.
  - Are verifiable via auditVerifyChain().

Claim-level hashes (Claim.contentHash, Claim.previousHash) form a THIRD chain for the belief graph:
  - **Chain scope:** Global. One chain across ALL claims (not per-subject or per-predicate).
  - **Chain ID:** `claimChainId = 'belief-graph'` (constant, analogous to audit chain's chainId).
  - **Ordering:** `previousHash` references the contentHash of the most recently committed
    claim, ordered by sequenceNum (monotonically increasing integer assigned at write time),
    NOT by timestamp. SequenceNum is authoritative for ordering; timestamps may collide.
  - **Genesis:** The first claim in the chain has `previousHash = null` and `sequenceNum = 0`.
  - **Concurrency:** Single-writer enforced at engine level. All claim writes are serialized
    through the SQLite transaction (WAL mode, single connection for writes). No concurrent
    claim writes are possible, so chain ordering is deterministic.
  - **Verification:** Same integrity rules as audit and refusal chains — append-only, no
    modification, no deletion (erasure uses tombstone append per Appendix C), gap-free
    sequence numbers, verifiable end-to-end.

### 13.8 No Direct DB Access

The SQLite database handle is:
  1. Created by the engine factory.
  2. Held privately by the engine (not exported, not on any public property).
  3. Not passed to adapters (AdapterBridge has no DB reference).
  4. Not accessible via MCP tool inputs (no path, no SQL field).
  5. Not accessible via prototype chain (engine prototype is not leaked).

The ONLY code that executes SQL is the engine's internal store modules. (Prevents FM-I1-01)

### 13.9 Clock Consistency

All temporal operations use the injected TimeProvider. No code path calls `Date.now()` or `new Date()` directly. This enables:
  - Deterministic testing (time can be controlled).
  - Consistent timestamps within a transaction (single `now()` call per transaction).
  - FSRS decay computation with controlled time advancement.

### 13.10 Error Boundary Guarantee

No error thrown inside the engine propagates as an uncaught exception to the caller. Every public method returns `Result<T, E>`. Internal errors are caught, wrapped in the appropriate error code, and returned. This prevents adapter or caller crashes from engine bugs. (Prevents FM-I4-02 vector in reverse -- engine crashes from adapter calls are also caught.)

---

## Appendix A: Defect Category Coverage

Per the Constitution's 10 mandatory defect categories, here is how this contract addresses each:

| # | Category | Contract Coverage |
|---|----------|------------------|
| 1 | **Data integrity** | Claim immutability (retract, not update). Hash chains. Transaction atomicity (13.2). Classification NOT NULL (13.5). |
| 2 | **State consistency** | Agent state machine (1.20). Action state machine (1.22). Consent state machine (1.21). Rule state machine (1.23). All transitions explicit, terminal states defined. |
| 3 | **Concurrency** | Single-writer enforcement (13.1). TOCTOU prevention via same-transaction consent (13.4). Serialized refusal chain (4.6). |
| 4 | **Authority / governance** | Trust levels (1.20). Protected predicates (4.4). Admin-only operations (kill-switch, decommission, rules). Agent status checks on every operation. |
| 5 | **Causality / observability** | Audit completeness (13.3). Hash chain integrity (13.7). Refusal provenance (4.6). Every operation audited. |
| 6 | **Migration / evolution** | FSRSState.paramVersion per claim (1.15). Embedding model version tracking (acknowledged in FM-CC-01, to be designed at architecture phase). |
| 7 | **Credential / secret** | Classification engine secret detection (4.5). Secret claims redacted in recall (1.16). SandboxConfig.inheritEnv=false (1.22). |
| 8 | **Behavioral / model quality** | Confidence capping (maxAutoConfidence). FSRS decay (computed at read). Classification detects adversarial content patterns. Content sanitization (direction-override stripping). |
| 9 | **Availability / resource** | Cascade depth limit (8.1). Adapter timeout (10.3). Action execution timeout (7.1). Kill-switch propagation budget (1.22). Audit query performance requirements (6.2). |
| 10 | **Performance / latency regression** | Governance latency budget 50ms P99 (QT-1, Appendix D). Audit query indexed-field return within 50ms for 100K entries (6.2). FSRS decay computed per-claim at read time without caching beyond request boundary (prevents FM-QT1-01, FM-QT1-02). Kill-switch poll interval 10ms (7.1). Adapter registration timeout 5000ms (10.3). |

---

## Appendix B: Interface Method Index

Quick reference: every public method in the system.

| Interface | Method | Section |
|-----------|--------|---------|
| LimenEngine | createLimenEngine | 3.1 |
| LimenEngine | getClient | 3.1 |
| LimenAgentClient | remember | 3.2 |
| LimenAgentClient | recall | 3.3 |
| LimenAgentClient | recallBulk | 3.4 |
| LimenAgentClient | forget | 3.5 |
| LimenAgentClient | connect | 3.6 |
| LimenAgentClient | search | 3.7 |
| LimenAgentClient | reflect | 3.8 |
| LimenAgentClient | workingMemoryWrite | 3.9 |
| LimenAgentClient | workingMemoryRead | 3.10 |
| LimenAgentClient | workingMemoryDiscard | 3.11 |
| Governance | consentRegister | 4.1 |
| Governance | consentCheck | 4.2 |
| Governance | consentRevoke | 4.3 |
| Lifecycle | agentRegister | 5.1 |
| Lifecycle | agentPromote | 5.2 |
| Lifecycle | agentDemote | 5.3 |
| Lifecycle | agentSuspend | 5.4 |
| Lifecycle | agentReactivate | 5.5 |
| Lifecycle | agentDecommission | 5.6 |
| Lifecycle | agentGet | 5.7 |
| Lifecycle | agentList | 5.8 |
| Audit | auditAppend (internal) | 6.1 |
| Audit | auditQuery | 6.2 |
| Audit | auditVerifyChain | 6.3 |
| Audit | auditExport | 6.4 |
| Computer-Use | actionExecute | 7.1 |
| Computer-Use | actionRefuse | 7.2 |
| Computer-Use | killSwitchActivate | 7.3 |
| Computer-Use | killSwitchDeactivate | 7.4 |
| Computer-Use | killSwitchStatus | 7.5 |
| Self-Healing | cascadeTrigger | 8.1 |
| Self-Healing | consolidate | 8.2 |
| Self-Healing | relationshipQuery | 8.3 |
| Coordination | a2aSend | 9.1 |
| Coordination | a2aRead | 9.2 |
| Coordination | a2aChannels | 9.3 |
| Coordination | ruleRegister | 9.4 |
| Coordination | ruleList | 9.6 |
| Coordination | ruleSuspend | 9.7 |
| Coordination | ruleRetire | 9.8 |
| Governance | verifyRefusalChain | 4.6.1 |
| Governance | getRetentionPolicy | 4.7.1 |
| Governance | enforceRetention | 4.7.2 |
| AdapterRegistry | adapterRegister | 10.3 |
| AdapterRegistry | adapterRemove | 10.4 |
| AdapterRegistry | adapterList | 10.5 |

**Total: 43 methods (41 public + 2 internal)**

---

## Appendix C: GDPR Erasure Contract

GDPR Article 17 erasure is a cross-cutting concern that affects claims, audit entries, and relationships.

```
erasureExecute(input: ErasureInput): Result<ErasureCertificate, ErasureError>

ErasureInput = {
  dataSubjectId:  string          -- 1-256 chars
  reason:         string          -- GDPR Article 17 basis, 1-512 chars
  includeRelated: boolean         -- cascade through derived_from chains, default: false
  agentId:        AgentId         -- must be admin
}

ErasureError =
  | E_AGT_NOT_FOUND
  | E_AGT_INSUFFICIENT_TRUST
  | E_VAL_SCHEMA_MISMATCH
  | E_SYS_DB_BUSY
  | E_SYS_INTERNAL

Erasure semantics:
  1. Find all claims where SubjectURN matches pattern `entity:user:<dataSubjectId>` or
     `entity:person:<dataSubjectId>` (exact match on the `<id>` segment, same extraction
     pattern as consent check in Section 3.2).
  2. For each matched claim:
     a. The original claim row is NOT modified. Its contentHash and previousHash remain
        intact. The hash chain is append-only — modifying any entry would break the
        previousHash link of the subsequent entry, making the chain unverifiable.
     b. A new ERASURE_TOMBSTONE entry is appended to the claim chain:
        - subject:         original claim's subject
        - predicate:       'erasure.tombstone'
        - objectValue:     JSON: { erasedClaimId, dataSubjectId, reason, originalClaimHash }
        - objectType:      'json'
        - status:          'active'
        - retractedReason: null (tombstone itself is not retracted)
        - contentHash:     SHA-256 of the tombstone's canonical content
        - previousHash:    the most recent claim's contentHash (standard chain append)
     c. The original claim is retracted via _internalRetract(claimId, 'erasure').
        This sets status='retracted', retractedReason='erasure', retractedAt=now().
        It does NOT modify objectValue, contentHash, or previousHash.
     d. Downstream consumers (recall, search, query) check for active ERASURE_TOMBSTONE
        entries. When a tombstone exists for a claim, the original claim's objectValue
        MUST be redacted to '[ERASED]' in all read responses. The stored row is unchanged;
        redaction is applied at read time.
  3. TOMBSTONE related audit entries: for each audit entry containing dataSubjectId content,
     a NEW audit entry of operation 'erasure.audit_tombstone' is appended to the audit chain
     referencing the original entry's ID. The original audit entry is NOT modified (its
     contentHash is part of the audit chain). Read paths redact the original entry's payload
     when a tombstone audit entry exists for it.
  4. If includeRelated=true: follow derived_from relationships and apply steps 2-3 to
     those claims too.
  5. Generate ErasureCertificate as proof (includes all tombstone entry IDs and original
     claim IDs).
  6. Audit entry appended with operation 'erasure.execute' summarizing the full operation.
  7. Single transaction.

Consent bypass exception:
  GDPR erasure exercises data subject rights per Article 17. The consent-before-read
  gate (Section 13.4) is BYPASSED for the purpose of identifying erasure-eligible claims.
  The erasure operation itself IS the exercise of the data subject's rights. This exception
  applies ONLY to erasureExecute and ONLY for claims belonging to the requesting
  dataSubjectId.

Hash chain integrity note:
  No existing entry (claim or audit) is ever modified by erasure. All tombstones are
  APPENDED to their respective chains. This preserves verifiability: auditVerifyChain()
  and claim chain verification will pass without special-casing erasure. GDPR compliance
  is achieved through read-time redaction driven by tombstone entries, not by mutating
  stored data.
```

---

## Appendix D: Governance Latency Budget Allocation

The 50ms governance latency budget (QT-1) is allocated across subsystems:

| Subsystem | Budget | Notes |
|-----------|--------|-------|
| Zod input validation | 5ms | Pre-compiled schemas |
| Classification engine | 10ms | Pattern matching, not ML inference |
| Consent check | 5ms | Single indexed query within transaction |
| Confidence capping | <1ms | Arithmetic comparison |
| FSRS decay computation | 2ms | Per-claim, computed at read time |
| Content sanitization | 2ms | NFC normalization + regex strip |
| Hash computation | 3ms | SHA-256 of claim content |
| Audit entry append | 5ms | Single INSERT within transaction |
| SQLite transaction overhead | 10ms | BEGIN/COMMIT + WAL sync |
| **Remaining buffer** | **7ms** | For unexpected overhead |

Total: 50ms maximum P99 latency for a single claim assertion.

These are target allocations, bounded by current analysis. Actual measurements at Phase 5.5 Test Stand will validate or revise them.

---

**End of Phase 2 Contract Specification.**
**Bounded by current analysis. Not claimed exhaustive.**
**Derived from Phase 0 Intent Record, Phase 0 Property Derivation, and Phase 1 Failure Mode Atlas.**
**Next gate: Breaker adversarial review of this contract.**
