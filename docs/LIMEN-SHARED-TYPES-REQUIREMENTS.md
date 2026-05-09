# Limen v5 -- SHARED_TYPES.md Requirement Extraction

**Source:** `contracts/SHARED_TYPES.md` v1.4.1
**Extracted:** 2026-05-09
**Governing Standard:** SolisForge Protocol v1.4
**Governance Tier:** Forge Critical
**Purpose:** Every implementable requirement from the shared types contract.

---

## Governing Rules (from Preamble)

| ID | Requirement | Source |
|---|---|---|
| ST-0.01 | Types defined in SHARED_TYPES.md are the SOLE definitions for all Phase X contracts | Preamble Rule |
| ST-0.02 | No Phase X contract may redefine any shared type listed in this document | Preamble Rule |
| ST-0.03 | Local types are contract-specific and not used by other contracts | Preamble Rule |
| ST-0.04 | Machine-readable status, HB-37/HB-38 coverage, LCI assertion, and monotonicity proof MUST be recorded in `contracts/phase-x.contracts.json` | Phase 8 Gate |

**Totals: 4 requirements**

---

## S1 Limen Core Types

### S1.1a Kernel IDs (10 branded types)

| ID | Requirement | Source |
|---|---|---|
| ST-1.01 | TenantId MUST be a branded string type `string & { readonly __brand: 'TenantId' }` | S1.1a |
| ST-1.02 | UserId MUST be a branded string type `string & { readonly __brand: 'UserId' }` | S1.1a |
| ST-1.03 | AgentId MUST be a branded string type `string & { readonly __brand: 'AgentId' }` | S1.1a |
| ST-1.04 | MissionId MUST be a branded string type `string & { readonly __brand: 'MissionId' }` | S1.1a |
| ST-1.05 | TaskId MUST be a branded string type `string & { readonly __brand: 'TaskId' }` | S1.1a |
| ST-1.06 | EventId MUST be a branded string type `string & { readonly __brand: 'EventId' }` | S1.1a |
| ST-1.07 | ArtifactId MUST be a branded string type `string & { readonly __brand: 'ArtifactId' }` | S1.1a |
| ST-1.08 | PolicyId MUST be a branded string type `string & { readonly __brand: 'PolicyId' }` | S1.1a |
| ST-1.09 | RoleId MUST be a branded string type `string & { readonly __brand: 'RoleId' }` | S1.1a |
| ST-1.10 | SessionId MUST be a branded string type `string & { readonly __brand: 'SessionId' }` | S1.1a |

### S1.1b Protocol IDs (6 branded types)

| ID | Requirement | Source |
|---|---|---|
| ST-1.11 | ClaimId MUST be a branded string type `string & { readonly __brand: 'ClaimId' }` from CCP `claims/interfaces/claim_types.ts` | S1.1b |
| ST-1.12 | RelationshipId MUST be a branded string type `string & { readonly __brand: 'RelationshipId' }` from CCP | S1.1b |
| ST-1.13 | ReservationId MUST be a branded string type `string & { readonly __brand: 'ReservationId' }` from EGP | S1.1b |
| ST-1.14 | WaveId MUST be a branded string type `string & { readonly __brand: 'WaveId' }` from EGP | S1.1b |
| ST-1.15 | EvaluationId MUST be a branded string type `string & { readonly __brand: 'EvaluationId' }` from TGP | S1.1b |
| ST-1.16 | PromotionDecisionId MUST be a branded string type `string & { readonly __brand: 'PromotionDecisionId' }` from TGP | S1.1b |

### S1.2 Permission (1 type, 31 values)

| ID | Requirement | Source |
|---|---|---|
| ST-1.17 | Permission MUST be a union type of exactly 31 string literal values | S1.2 |
| ST-1.18 | Permission values MUST include: `create_agent`, `modify_agent`, `delete_agent`, `chat`, `infer`, `create_mission`, `view_telemetry`, `view_audit`, `manage_providers`, `manage_budgets`, `manage_roles`, `purge_data`, `approve_response`, `edit_response`, `takeover_session`, `review_batch`, `classify_claims`, `manage_classification_rules`, `manage_protected_predicates`, `request_erasure`, `export_compliance`, `assert_claim`, `retract_claim`, `query_claims`, `relate_claims`, `write_wm`, `read_wm`, `manage_consent`, `view_consent`, `manage_cognitive`, `manage_agents` | S1.2 |

### S1.3 OperationContext

| ID | Requirement | Source |
|---|---|---|
| ST-1.19 | OperationContext MUST be an interface with readonly fields: `tenantId: TenantId | null`, `userId: UserId | null`, `agentId: AgentId | null`, `permissions: ReadonlySet<Permission>` | S1.3 |
| ST-1.20 | OperationContext MUST have optional readonly fields: `sessionId?: SessionId`, `clearanceLevel?: number` | S1.3 |
| ST-1.21 | OperationContext.clearanceLevel mapping for Phase X: untrusted=0, low=1, medium=2, high=3, verified=4 | S1.3 comment |

### S1.4 KernelError

| ID | Requirement | Source |
|---|---|---|
| ST-1.22 | KernelError MUST be an interface with readonly fields: `code: string`, `message: string`, `spec: string` | S1.4 |
| ST-1.23 | KernelError MUST have optional readonly field: `violations?: readonly LimenViolation[]`. Note: `LimenViolation` is an external dependency defined in Limen Core (`kernel/interfaces/`), not in SHARED_TYPES | S1.4 |

### S1.5 Result

| ID | Requirement | Source |
|---|---|---|
| ST-1.24 | Result<T> MUST be a discriminated union: `{ ok: true; value: T }` or `{ ok: false; error: KernelError }` | S1.5 |
| ST-1.25 | Result fields MUST be readonly | S1.5 |
| ST-1.26 | All Limen Core types in S1 are inherited and MUST NOT be modified by Phase X contracts | S1 preamble |

**Totals: 26 requirements**

---

## S2 CCP Types

| ID | Requirement | Source |
|---|---|---|
| ST-2.01 | ObjectType MUST be a union type: `'string' | 'number' | 'boolean' | 'date' | 'json'` | S2 |
| ST-2.02 | ClaimStatus MUST be a union type: `'active' | 'retracted'` | S2 |
| ST-2.03 | GroundingMode MUST be a union type: `'evidence_path' | 'runtime_witness'` | S2 |
| ST-2.04 | FreshnessLabel MUST be a union type: `'fresh' | 'aging' | 'stale'` | S2 |
| ST-2.05 | ArchiveMode MUST be a union type: `'exclude' | 'include' | 'only'` | S2 |
| ST-2.06 | EvidenceType MUST be a union type: `'memory' | 'artifact' | 'claim' | 'capability_result'` | S2 |
| ST-2.07 | RelationshipType MUST be a union type: `'supports' | 'contradicts' | 'supersedes' | 'derived_from'` | S2 |
| ST-2.08 | All CCP types in S2 are inherited and MUST NOT be modified by Phase X contracts | S2 preamble |

**Totals: 8 requirements**

---

## S3 Classification Types

| ID | Requirement | Source |
|---|---|---|
| ST-3.01 | ClassificationLevel MUST be a union type: `'unrestricted' | 'internal' | 'confidential' | 'restricted' | 'critical'` | S3 |
| ST-3.02 | CLASSIFICATION_NUMERIC MUST map `unrestricted` to 0 | S3 |
| ST-3.03 | CLASSIFICATION_NUMERIC MUST map `internal` to 1 | S3 |
| ST-3.04 | CLASSIFICATION_NUMERIC MUST map `confidential` to 2 | S3 |
| ST-3.05 | CLASSIFICATION_NUMERIC MUST map `restricted` to 3 | S3 |
| ST-3.06 | CLASSIFICATION_NUMERIC MUST map `critical` to 4 | S3 |
| ST-3.07 | CLASSIFICATION_NUMERIC MUST be typed as `Record<ClassificationLevel, number>` | S3 |
| ST-3.08 | Classification types are inherited and MUST NOT be modified by Phase X contracts | S3 preamble |

**Totals: 8 requirements**

---

## S4 Phase X Branded Types

| ID | Requirement | Source |
|---|---|---|
| ST-4.01 | AgentBranchId MUST be a branded string type `string & { readonly __brand: 'AgentBranchId' }` | S4 |
| ST-4.02 | AdapterId MUST be a branded string type `string & { readonly __brand: 'AdapterId' }` | S4 |
| ST-4.03 | ConsentId MUST be a branded string type `string & { readonly __brand: 'ConsentId' }` | S4 |
| ST-4.04 | AuditEntryId MUST be a branded string type `string & { readonly __brand: 'AuditEntryId' }` | S4 |
| ST-4.05 | TriggerConfigId MUST be a branded string type `string & { readonly __brand: 'TriggerConfigId' }` | S4 |
| ST-4.06 | KnowledgePackageId MUST be a branded string type `string & { readonly __brand: 'KnowledgePackageId' }` | S4 |

**Totals: 6 requirements**

---

## S5 Trust and Clearance Model

### S5 Type Definitions

| ID | Requirement | Source |
|---|---|---|
| ST-5.01 | CoreTrustLevel MUST be a union type: `'untrusted' | 'probationary' | 'trusted' | 'admin'` | S5 |
| ST-5.02 | AgentTrustLevel MUST be a union type: `'untrusted' | 'low' | 'medium' | 'high' | 'verified'` | S5 |
| ST-5.03 | TRUST_TO_CLEARANCE MUST be a const `Record<AgentTrustLevel, number>` | S5 |
| ST-5.04 | TRUST_TO_CLEARANCE MUST map `untrusted` to 0 | S5 |
| ST-5.05 | TRUST_TO_CLEARANCE MUST map `low` to 1 | S5 |
| ST-5.06 | TRUST_TO_CLEARANCE MUST map `medium` to 2 | S5 |
| ST-5.07 | TRUST_TO_CLEARANCE MUST map `high` to 3 | S5 |
| ST-5.08 | TRUST_TO_CLEARANCE MUST map `verified` to 4 | S5 |
| ST-5.09 | PHASE_X_TO_CORE_TRUST MUST be a const `Record<AgentTrustLevel, CoreTrustLevel>` | S5 |
| ST-5.10 | PHASE_X_TO_CORE_TRUST MUST map `untrusted` to `'untrusted'` | S5 |
| ST-5.11 | PHASE_X_TO_CORE_TRUST MUST map `low` to `'probationary'` | S5 |
| ST-5.12 | PHASE_X_TO_CORE_TRUST MUST map `medium` to `'trusted'` | S5 |
| ST-5.13 | PHASE_X_TO_CORE_TRUST MUST map `high` to `'trusted'` | S5 |
| ST-5.14 | PHASE_X_TO_CORE_TRUST MUST map `verified` to `'admin'` | S5 |

### S5.1 Capability Unlocking

| ID | Requirement | Source |
|---|---|---|
| ST-5.15 | Trust level `untrusted` (clearance 0) MUST unlock exactly: `memory_read`, `context_management` | S5.1 |
| ST-5.16 | Trust level `low` (clearance 1) MUST additionally unlock: `memory_write`, `belief_management` | S5.1 |
| ST-5.17 | Trust level `medium` (clearance 2) MUST additionally unlock: `branching`, `technique_learning`, `mission_creation`, `file_access`, `api_calls` | S5.1 |
| ST-5.18 | Trust level `high` (clearance 3) MUST additionally unlock: `computer_use`, `browser_use`, `terminal_use`, `code_execution`, `network_access`, `multi_agent`, `technique_transfer`, `mission_delegation`, `knowledge_export`, `knowledge_import` | S5.1 |
| ST-5.19 | Trust level `verified` (clearance 4) MUST additionally unlock: process spawn/kill (via `computer_use`), `governance_admin` | S5.1 |
| ST-5.29 | Trust level `untrusted` (clearance 0) MUST allow access to classifications: `unrestricted` only | S5.1 table |
| ST-5.30 | Trust level `low` (clearance 1) MUST allow access to classifications: `unrestricted`, `internal` | S5.1 table |
| ST-5.31 | Trust level `medium` (clearance 2) MUST allow access to classifications: `unrestricted`, `internal`, `confidential` | S5.1 table |
| ST-5.32 | Trust level `high` (clearance 3) MUST allow access to classifications: `unrestricted`, `internal`, `confidential`, `restricted` | S5.1 table |
| ST-5.33 | Trust level `verified` (clearance 4) MUST allow access to all classification levels | S5.1 table |

### S5.2 Promotion Requirements

| ID | Requirement | Source |
|---|---|---|
| ST-5.20 | Promotion from `untrusted` to `low` requires: registration complete, adapter connected | S5.2 |
| ST-5.21 | Promotion from `low` to `medium` requires: 10+ successful operations, 0 governance refusals in last 24h | S5.2 |
| ST-5.22 | Promotion from `medium` to `high` requires: 100+ successful operations, human approval OR senior agent endorsement | S5.2 |
| ST-5.23 | Promotion from `high` to `verified` requires: human approval required, Core admin transition record required | S5.2 |
| ST-5.24 | Trust promotions MUST be monotonic and single-step | S5.2 validation |
| ST-5.25 | `verified` MUST NOT be self-granted; it MUST use the Core `admin` human transition gate | S5.2 validation |
| ST-5.26 | `high` MUST NOT be written to `core_agents.trust_level`; it is represented by `AgentSession.trustLevel = 'high'`, `PHASE_X_TO_CORE_TRUST.high = 'trusted'`, and `clearanceLevel = 3` | S5.2 validation |
| ST-5.27 | The Phase X clearance mapping (0, 1, 2, 3, 4) is authoritative for all Phase X operations | S5 Note |
| ST-5.28 | Core's `clearanceLevel` field accepts any non-negative integer; the skip from 2 to 4 in Core is a legacy convention, not a validation constraint | S5 Note |

### S5 Behavioral

| ID | Requirement | Source |
|---|---|---|
| ST-5.34 | A high-trust session MUST store `trustLevel: 'high'`, pass `clearanceLevel: 3` to `OperationContext`, and leave the persisted Core trust row at `trusted` | S5.2 example |

**Totals: 34 requirements**

---

## S6 AgentCapability

| ID | Requirement | Source |
|---|---|---|
| ST-6.01 | AgentCapability MUST be a union type of exactly 20 string literal values | S6 |
| ST-6.02 | AgentCapability values MUST include: `memory_read`, `memory_write`, `belief_management`, `branching`, `technique_learning`, `technique_transfer`, `mission_creation`, `mission_delegation`, `computer_use`, `browser_use`, `terminal_use`, `file_access`, `code_execution`, `api_calls`, `network_access`, `multi_agent`, `knowledge_export`, `knowledge_import`, `context_management`, `governance_admin` | S6 |
| ST-6.03 | `memory_read` minimum trust level MUST be `untrusted` | S6.1 |
| ST-6.04 | `context_management` minimum trust level MUST be `untrusted` | S6.1 |
| ST-6.05 | `memory_write` minimum trust level MUST be `low` | S6.1 |
| ST-6.06 | `belief_management` minimum trust level MUST be `low` | S6.1 |
| ST-6.07 | `branching` minimum trust level MUST be `medium` | S6.1 |
| ST-6.08 | `technique_learning` minimum trust level MUST be `medium` | S6.1 |
| ST-6.09 | `mission_creation` minimum trust level MUST be `medium` | S6.1 |
| ST-6.10 | `file_access` minimum trust level MUST be `medium` | S6.1 |
| ST-6.11 | `api_calls` minimum trust level MUST be `medium` | S6.1 |
| ST-6.12 | `computer_use` minimum trust level MUST be `high` | S6.1 |
| ST-6.13 | `browser_use` minimum trust level MUST be `high` | S6.1 |
| ST-6.14 | `terminal_use` minimum trust level MUST be `high` | S6.1 |
| ST-6.15 | `code_execution` minimum trust level MUST be `high` | S6.1 |
| ST-6.16 | `network_access` minimum trust level MUST be `high` | S6.1 |
| ST-6.17 | `multi_agent` minimum trust level MUST be `high` | S6.1 |
| ST-6.18 | `technique_transfer` minimum trust level MUST be `high` | S6.1 |
| ST-6.19 | `mission_delegation` minimum trust level MUST be `high` | S6.1 |
| ST-6.20 | `knowledge_export` minimum trust level MUST be `high` | S6.1 |
| ST-6.21 | `knowledge_import` minimum trust level MUST be `high` | S6.1 |
| ST-6.22 | `governance_admin` minimum trust level MUST be `verified` | S6.1 |

**Totals: 22 requirements**

---

## S7 AgentSession

| ID | Requirement | Source |
|---|---|---|
| ST-7.01 | AgentSession MUST be a single canonical definition used by ALL contracts | S7 preamble |
| ST-7.02 | AgentSession MUST have readonly field `sessionId: SessionId` | S7 |
| ST-7.03 | AgentSession MUST have readonly field `agentId: AgentId` | S7 |
| ST-7.04 | AgentSession MUST have readonly field `tenantId: TenantId | null` | S7 |
| ST-7.05 | AgentSession MUST have readonly field `adapterId: AdapterId` | S7 |
| ST-7.06 | AgentSession MUST have readonly field `trustLevel: AgentTrustLevel` | S7 |
| ST-7.07 | AgentSession MUST have readonly field `coreTrustLevel: CoreTrustLevel` derived from `trustLevel` via `PHASE_X_TO_CORE_TRUST` | S7 |
| ST-7.08 | AgentSession MUST have readonly field `clearanceLevel: number` derived from `trustLevel` via `TRUST_TO_CLEARANCE` | S7 |
| ST-7.09 | AgentSession MUST have readonly field `capabilities: ReadonlySet<AgentCapability>` | S7 |
| ST-7.10 | AgentSession MUST have readonly field `startedAt: string` (ISO-8601) | S7 |
| ST-7.11 | AgentSession MUST have readonly field `workingMemoryNamespace: string` | S7 |
| ST-7.12 | AgentSession MUST have readonly field `activeMissions: readonly MissionId[]` | S7 |
| ST-7.13 | AgentSession MUST have readonly field `metadata: Readonly<Record<string, unknown>>` | S7 |
| ST-7.14 | `clearanceLevel` MUST equal `TRUST_TO_CLEARANCE[trustLevel]`; `coreTrustLevel` MUST equal `PHASE_X_TO_CORE_TRUST[trustLevel]`; `capabilities` MUST be the intersection of requested capabilities and the trust unlock table in S5.1 | S7 validation |

**Totals: 14 requirements**

---

## S8 Session-to-OperationContext Mapping

### S8 sessionToContext

| ID | Requirement | Source |
|---|---|---|
| ST-8.01 | `sessionToContext` function MUST accept an `AgentSession` and return an `OperationContext` | S8 |
| ST-8.02 | `sessionToContext` MUST set `tenantId` from `session.tenantId` | S8 |
| ST-8.03 | `sessionToContext` MUST set `userId` to `null` (agents are not users) | S8 |
| ST-8.04 | `sessionToContext` MUST set `agentId` from `session.agentId` | S8 |
| ST-8.05 | `sessionToContext` MUST set `permissions` from `derivePermissions(session.capabilities)` | S8 |
| ST-8.06 | `sessionToContext` MUST set `sessionId` from `session.sessionId` | S8 |
| ST-8.07 | `sessionToContext` MUST set `clearanceLevel` from `session.clearanceLevel` | S8 |

### S8.1 derivePermissions Mapping (20 capability mappings)

| ID | Requirement | Source |
|---|---|---|
| ST-8.08 | `derivePermissions` MUST accept `ReadonlySet<AgentCapability>` and return `ReadonlySet<Permission>` | S8.1 |
| ST-8.09 | `memory_read` capability MUST map to permissions: `query_claims`, `read_wm` | S8.1 |
| ST-8.10 | `memory_write` capability MUST map to permissions: `assert_claim`, `retract_claim`, `relate_claims`, `write_wm` | S8.1 |
| ST-8.11 | `belief_management` capability MUST map to permissions: `query_claims`, `relate_claims` | S8.1 |
| ST-8.12 | `branching` capability MUST map to permissions: `assert_claim`, `retract_claim`, `query_claims`, `relate_claims` | S8.1 |
| ST-8.13 | `technique_learning` capability MUST map to permissions: `query_claims`, `assert_claim` | S8.1 |
| ST-8.14 | `technique_transfer` capability MUST map to permissions: `query_claims`, `assert_claim`, `relate_claims` | S8.1 |
| ST-8.15 | `mission_creation` capability MUST map to permission: `create_mission` | S8.1 |
| ST-8.16 | `mission_delegation` capability MUST map to permissions: `create_mission`, `create_agent` | S8.1 |
| ST-8.17 | `computer_use` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.18 | `browser_use` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.19 | `terminal_use` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.20 | `file_access` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.21 | `code_execution` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.22 | `api_calls` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.23 | `network_access` capability MUST map to permission: `view_telemetry` | S8.1 |
| ST-8.24 | `multi_agent` capability MUST map to permissions: `create_agent`, `modify_agent` | S8.1 |
| ST-8.25 | `knowledge_export` capability MUST map to permissions: `query_claims`, `export_compliance` | S8.1 |
| ST-8.26 | `knowledge_import` capability MUST map to permissions: `assert_claim`, `relate_claims` | S8.1 |
| ST-8.27 | `context_management` capability MUST map to permissions: `read_wm`, `write_wm` | S8.1 |
| ST-8.28 | `governance_admin` capability MUST map to permissions: `classify_claims`, `manage_classification_rules`, `manage_protected_predicates`, `manage_agents`, `manage_roles`, `manage_consent`, `view_consent`, `manage_cognitive`, `view_audit`, `purge_data` | S8.1 |
| ST-8.29 | Permission derivation MUST be additive: all permissions from all held capabilities are unioned | S8.1 implementation |

**Totals: 22 requirements**

---

## S9 GovernanceContext

| ID | Requirement | Source |
|---|---|---|
| ST-9.01 | GovernanceContext MUST have readonly field `operationContext: OperationContext` | S9 |
| ST-9.02 | GovernanceContext MUST have readonly field `session: AgentSession` | S9 |
| ST-9.03 | GovernanceContext MUST have readonly field `action: GovernanceAction` | S9 |
| ST-9.04 | GovernanceContext MUST have readonly field `resource: string | null` | S9 |
| ST-9.05 | GovernanceContext MUST have readonly field `policyIds: readonly PolicyId[]` | S9 |
| ST-9.06 | GovernanceContext MUST have readonly field `actionHistory: readonly ActionDigest[]` | S9 |
| ST-9.07 | GovernanceAction MUST be a discriminated union with `domain` discriminant and 10 domain variants: `memory`, `computer`, `execution`, `lifecycle`, `knowledge`, `consent`, `context`, `search`, `coordination`, `output` | S9 |
| ST-9.08 | Domain `memory` operations MUST be: `'write' | 'read' | 'delete' | 'branch' | 'merge' | 'resolve_merge_conflict'` | S9 |
| ST-9.09 | Domain `computer` operation MUST be `ComputerActionType` | S9 |
| ST-9.10 | Domain `execution` operations MUST be: `'create_mission' | 'delegate' | 'cancel' | 'retry' | 'tool_call'` | S9 |
| ST-9.11 | Domain `lifecycle` operations MUST be: `'register' | 'promote' | 'demote' | 'suspend' | 'decommission'` | S9 |
| ST-9.12 | Domain `knowledge` operations MUST be: `'export' | 'import' | 'transfer'` | S9 |
| ST-9.13 | Domain `consent` operations MUST be: `'register' | 'revoke' | 'check'` | S9 |
| ST-9.14 | Domain `context` operations MUST be: `'write_wm' | 'discard_wm' | 'pin' | 'unpin' | 'evict' | 'boundary_trigger'` | S9 |
| ST-9.15 | Domain `search` operations MUST be: `'query' | 'embed' | 'duplicate_check' | 'configure'` | S9 |
| ST-9.16 | Domain `coordination` operations MUST be: `'a2a_send' | 'fork_session' | 'sync' | 'replay' | 'rule'` | S9 |
| ST-9.17 | Domain `output` operations MUST be: `'produce' | 'telemetry' | 'infer' | 'plugin' | 'hook'` | S9 |

### S9 ComputerActionType

| ID | Requirement | Source |
|---|---|---|
| ST-9.18 | ComputerActionType MUST be a union of exactly 17 string literal values | S9 |
| ST-9.19 | ComputerActionType values MUST include: `'file:read'`, `'file:write'`, `'file:delete'`, `'directory:list'`, `'terminal:execute'`, `'browser:navigate'`, `'browser:click'`, `'browser:input'`, `'browser:extract'`, `'api:call'`, `'code:execute'`, `'process:spawn'`, `'process:kill'`, `'network:connect'`, `'clipboard:access'`, `'screenshot:capture'`, `'database:query'` | S9 |

**Totals: 19 requirements**

---

## S10 GovernanceVerdict

| ID | Requirement | Source |
|---|---|---|
| ST-10.01 | GovernanceVerdict MUST be a discriminated union with `verdict` discriminant and 4 variants: `allow`, `refuse`, `escalate`, `sandbox` | S10 |
| ST-10.02 | `allow` variant MUST have: `auditId: EventId`, optional `conditions?: readonly string[]` | S10 |
| ST-10.03 | `refuse` variant MUST have: `auditId: EventId`, `reason: string`, `rule: string`, optional `alternatives?: readonly string[]` | S10 |
| ST-10.04 | `escalate` variant MUST have: `auditId: EventId`, `reason: string`, `requiredApproval: 'human' | 'senior_agent'` | S10 |
| ST-10.05 | `sandbox` variant MUST have: `auditId: EventId`, `config: SandboxConfig` | S10 |

### S10.1 GovernanceDecision

| ID | Requirement | Source |
|---|---|---|
| ST-10.06 | GovernanceDecision MUST have readonly fields: `allowed: boolean`, `verdict: GovernanceVerdict`, `reason: string | null`, `requiredPermissions: readonly Permission[]`, `missingPermissions: readonly Permission[]`, `clearanceRequired: number | null`, `clearanceActual: number | null`, `evaluatedAt: string` (ISO-8601) | S10.1 |
| ST-10.07 | `allowed` MUST be true ONLY when `verdict.verdict === 'allow'` | S10.1 validation |
| ST-10.08 | Rejections MUST include at least one of: `reason`, `missingPermissions`, or `clearanceRequired` | S10.1 validation |
| ST-10.09 | `evaluatedAt` value MUST come from the injected time provider | S10.1 validation |

### S10 Behavioral

| ID | Requirement | Source |
|---|---|---|
| ST-10.10 | A memory write without `assert_claim` MUST return `allowed: false` with `missingPermissions: ['assert_claim']` and a refusal verdict | S10.1 example |
| ST-10.11 | A non-executed escalation terminal audit entry MUST emit `event: 'governance:escalated'` with an escalation `governanceDecision` | S10.3 escalation mapping |
| ST-10.12 | No `action:escalated` event exists; escalation terminal actions MUST be represented canonically by `governance:escalated` | S10.3 escalation mapping |

**Totals: 12 requirements**

---

## S10.2 Memory and Belief Records

### AgentMemoryEntry

| ID | Requirement | Source |
|---|---|---|
| ST-10.2.01 | AgentMemoryEntry MUST have readonly field `id: ClaimId` | S10.2 |
| ST-10.2.02 | AgentMemoryEntry MUST have readonly field `content: string` | S10.2 |
| ST-10.2.03 | AgentMemoryEntry MUST have readonly field `subject: string` | S10.2 |
| ST-10.2.04 | AgentMemoryEntry MUST have readonly field `predicate: string` | S10.2 |
| ST-10.2.05 | AgentMemoryEntry MUST have readonly field `value: unknown` | S10.2 |
| ST-10.2.06 | AgentMemoryEntry MUST have readonly field `confidence: number` | S10.2 |
| ST-10.2.07 | AgentMemoryEntry MUST have readonly field `effectiveConfidence: number` | S10.2 |
| ST-10.2.08 | AgentMemoryEntry MUST have readonly field `freshness: FreshnessLabel` | S10.2 |
| ST-10.2.09 | AgentMemoryEntry MUST have readonly field `classification: ClassificationLevel` | S10.2 |
| ST-10.2.10 | AgentMemoryEntry MUST have readonly fields: `tags: readonly string[]`, `category: string | null`, `sourceAgentId: AgentId`, `missionId: MissionId | null`, `taskId: TaskId | null`, `groundingMode: GroundingMode`, `createdAt: string` (ISO-8601) | S10.2 |

### Validation Rules

| ID | Requirement | Source |
|---|---|---|
| ST-10.2.11 | `confidence` and `effectiveConfidence` MUST be in closed interval [0, 1] | S10.2 validation |
| ST-10.2.12 | `effectiveConfidence` MUST NOT exceed `confidence` | S10.2 validation |
| ST-10.2.13 | `classification` MUST be readable by the caller's `OperationContext.clearanceLevel` | S10.2 validation |
| ST-10.2.14 | `sourceAgentId` is mandatory for all Phase X writes | S10.2 validation |

### EvidenceRef, RelationshipRef, BeliefState

| ID | Requirement | Source |
|---|---|---|
| ST-10.2.15 | EvidenceRef MUST have readonly fields: `type: EvidenceType`, `id: string`, optional `description?: string` | S10.2 |
| ST-10.2.16 | RelationshipRef MUST have readonly fields: `id: RelationshipId`, `type: RelationshipType`, `targetId: ClaimId` | S10.2 |
| ST-10.2.17 | BeliefState MUST have readonly fields: `belief: AgentMemoryEntry`, `evidence: readonly EvidenceRef[]`, `relationships: readonly RelationshipRef[]`, `status: ClaimStatus`, `retentionPolicy: RetentionPolicy | null`, `governance: GovernanceDecision | null` | S10.2 |
| ST-10.2.18 | `AgentBeliefState` MUST be a type alias for `BeliefState` | S10.2 |

### S10.2.1 Request DTOs

| ID | Requirement | Source |
|---|---|---|
| ST-10.2.19 | StructuredContent MUST have readonly fields: `subject: string`, `predicate: string`, `value: unknown`, optional `objectType?: ObjectType` | S10.2.1 |
| ST-10.2.20 | AgentMemoryOptions MUST have all-optional readonly fields: `confidence`, `reasoning`, `classification`, `tags`, `category`, `missionId`, `taskId`, `groundingMode`, `retentionDays` | S10.2.1 |
| ST-10.2.21 | AgentRecallQuery MUST have all-optional readonly fields: `text`, `subject`, `predicate`, `tags`, `category`, `freshnessFilter` (single or array), `minConfidence`, `timeRange`, `classification`, `missionId`, `taskId`, `sourceAgentId`, `includeSuperseded`, `branchId` | S10.2.1 |
| ST-10.2.22 | AgentRecallOptions MUST have all-optional readonly fields: `limit`, `offset`, `includeEvidence`, `includeRelationships`, `searchMode` (`'text' | 'semantic' | 'hybrid'`), `archiveMode`, `sortBy` (`'relevance' | 'confidence' | 'recency'`) | S10.2.1 |
| ST-10.2.23 | `AgentMemoryOptions.confidence` is a requested confidence only; Memory Bridge MUST still enforce confidence ceilings before persistence | S10.2.1 validation |
| ST-10.2.24 | `AgentRecallQuery.classification` is a maximum requested classification, not authority; read authority derives ONLY from `OperationContext.clearanceLevel` | S10.2.1 validation |
| ST-10.2.25 | `AgentRecallQuery.timeRange` MUST be an object with readonly fields `from: string` (ISO-8601) and `to: string` (ISO-8601) | S10.2.1 |
| ST-10.2.26 | `AgentRecallOptions.limit` and `offset` MUST be non-negative integers when present | S10.2.1 validation |

### S10.2 Behavioral

| ID | Requirement | Source |
|---|---|---|
| ST-10.2.27 | A recalled claim with expired decay MUST keep `confidence` at its stored value but MAY return a lower `effectiveConfidence` and `freshness: 'stale'` (e.g., `confidence: 0.8`, `effectiveConfidence: 0.42`, `freshness: 'stale'`) | S10.2 example |

**Totals: 27 requirements**

---

## S10.3 AuditLogEntry

| ID | Requirement | Source |
|---|---|---|
| ST-10.3.01 | AuditLogEntry MUST have readonly fields: `id: EventId`, `timestamp: string` (ISO-8601), `tenantId: TenantId | null`, `agentId: AgentId`, `sessionId: SessionId`, `event: AgentEvent`, `action: GovernanceAction | null`, `governanceDecision: GovernanceDecision | null`, `details: Readonly<Record<string, unknown>>`, `previousHash: string`, `currentHash: string`, `classification: ClassificationLevel` | S10.3 |
| ST-10.3.02 | `AgentAuditEntry` MUST be a type alias for `AuditLogEntry` | S10.3 |
| ST-10.3.03 | Audit entries MUST be append-only | S10.3 validation |
| ST-10.3.04 | `previousHash` MUST match the prior retained entry for the same audit chain | S10.3 validation |
| ST-10.3.05 | `currentHash` MUST hash the canonical serialized entry excluding `currentHash` | S10.3 validation |
| ST-10.3.06 | Tombstones MAY redact `details` but MUST preserve: identity, hash chain linkage, event type, timestamp, and classification | S10.3 validation |
| ST-10.3.07 | A refused terminal action MUST emit `event: 'action:refused'`, a refusal `governanceDecision`, and `classification` inherited from the target resource | S10.3 example |
| ST-10.3.08 | A non-executed escalation terminal MUST emit `event: 'governance:escalated'` with an escalation `governanceDecision` and the same action/risk metadata shape as refused terminal actions | S10.3 escalation |
| ST-10.3.09 | No `action:escalated` event exists; escalation terminals MUST use `governance:escalated` | S10.3 escalation |

**Totals: 9 requirements**

---

## S11 ComputerAction

### S11.1 ActionBase

| ID | Requirement | Source |
|---|---|---|
| ST-11.01 | ActionBase MUST have readonly fields: `type: ComputerActionType`, `timestamp: string` (ISO-8601), `agentId: AgentId`, `sessionId: SessionId`, `missionId: MissionId | null`, `taskId: TaskId | null`, `requestId: EventId` | S11.1 |

### S11.2 Action Variants (17 variants)

| ID | Requirement | Source |
|---|---|---|
| ST-11.02 | FileReadAction MUST extend ActionBase with `type: 'file:read'`, `path: string`, optional `encoding?: string` | S11.2 |
| ST-11.03 | FileWriteAction MUST extend ActionBase with `type: 'file:write'`, `path: string`, `content: string`, optional `encoding?: string`, optional `createDirectories?: boolean` | S11.2 |
| ST-11.04 | FileDeleteAction MUST extend ActionBase with `type: 'file:delete'`, `path: string`, optional `recursive?: boolean` | S11.2 |
| ST-11.05 | DirectoryListAction MUST extend ActionBase with `type: 'directory:list'`, `path: string`, optional `recursive?: boolean`, optional `pattern?: string` | S11.2 |
| ST-11.06 | TerminalExecuteAction MUST extend ActionBase with `type: 'terminal:execute'`, `command: string`, optional `args?: readonly string[]`, optional `cwd?: string`, optional `env?: Readonly<Record<string, string>>`, optional `timeoutMs?: number` | S11.2 |
| ST-11.07 | BrowserNavigateAction MUST extend ActionBase with `type: 'browser:navigate'`, `url: string`, optional `waitFor?: string`, optional `timeoutMs?: number` | S11.2 |
| ST-11.08 | BrowserClickAction MUST extend ActionBase with `type: 'browser:click'`, `selector: string`, optional `button?: 'left' | 'right' | 'middle'`, optional `doubleClick?: boolean` | S11.2 |
| ST-11.09 | BrowserInputAction MUST extend ActionBase with `type: 'browser:input'`, `selector: string`, `value: string`, optional `clearFirst?: boolean` | S11.2 |
| ST-11.10 | BrowserExtractAction MUST extend ActionBase with `type: 'browser:extract'`, `selector: string`, optional `attribute?: string`, optional `multiple?: boolean` | S11.2 |
| ST-11.11 | ApiCallAction MUST extend ActionBase with `type: 'api:call'`, `url: string`, `method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'`, optional `headers?: Readonly<Record<string, string>>`, optional `body?: string`, optional `timeoutMs?: number` | S11.2 |
| ST-11.12 | CodeExecuteAction MUST extend ActionBase with `type: 'code:execute'`, `language: string`, `code: string`, optional `timeoutMs?: number`, `sandboxed: boolean` (required) | S11.2 |
| ST-11.13 | ProcessSpawnAction MUST extend ActionBase with `type: 'process:spawn'`, `command: string`, optional `args?: readonly string[]`, optional `cwd?: string`, optional `env?: Readonly<Record<string, string>>`, optional `detached?: boolean` | S11.2 |
| ST-11.14 | ProcessKillAction MUST extend ActionBase with `type: 'process:kill'`, `pid: number`, optional `signal?: string` | S11.2 |
| ST-11.15 | NetworkConnectAction MUST extend ActionBase with `type: 'network:connect'`, `host: string`, `port: number`, `protocol: 'tcp' | 'udp' | 'tls'`, optional `timeoutMs?: number` | S11.2 |
| ST-11.16 | ClipboardAccessAction MUST extend ActionBase with `type: 'clipboard:access'`, `operation: 'read' | 'write'`, optional `content?: string` (required for write) | S11.2 |
| ST-11.17 | ScreenshotCaptureAction MUST extend ActionBase with `type: 'screenshot:capture'`, optional `region?: { x: number; y: number; width: number; height: number }`, optional `format?: 'png' | 'jpeg'` | S11.2 |
| ST-11.18 | DatabaseQueryAction MUST extend ActionBase with `type: 'database:query'`, `connectionId: string`, `query: string`, optional `params?: readonly unknown[]`, `readOnly: boolean` (required) | S11.2 |

### S11.3 ComputerAction Union

| ID | Requirement | Source |
|---|---|---|
| ST-11.19 | ComputerAction MUST be a union of all 17 action variant interfaces | S11.3 |

### S11.4 NativeAgentAction

| ID | Requirement | Source |
|---|---|---|
| ST-11.20 | NativeAgentAction MUST have readonly fields: `adapterId: AdapterId`, `agentId: AgentId`, `sessionId: SessionId`, `nativeType: string`, `nativePayload: Readonly<Record<string, unknown>>`, `timestamp: string` | S11.4 |
| ST-11.21 | Adapters MUST translate their native format into ComputerAction for governance evaluation | S11.4 |

**Totals: 21 requirements**

---

## S12 SandboxConfig

| ID | Requirement | Source |
|---|---|---|
| ST-12.01 | SandboxConfig MUST have readonly fields: `filesystem: FilesystemSandbox`, `network: NetworkSandbox`, `process: ProcessSandbox`, `resources: ResourceSandbox`, `duration: DurationSandbox` | S12 |
| ST-12.02 | FilesystemSandbox MUST have: `allowedPaths: readonly string[]` (glob patterns), `deniedPaths: readonly string[]` (glob patterns, takes precedence), `readOnly: boolean`, `maxFileSize: number` (bytes), `maxTotalSize: number` (bytes) | S12 |
| ST-12.03 | FilesystemSandbox `deniedPaths` MUST take precedence over `allowedPaths` | S12 |
| ST-12.04 | NetworkSandbox MUST have: `allowedHosts: readonly string[]`, `deniedHosts: readonly string[]` (takes precedence), `allowedProtocols: readonly ('http' | 'https' | 'tcp' | 'udp' | 'tls')[]`, `maxConnections: number`, `maxBandwidth: number` (bytes/sec) | S12 |
| ST-12.05 | NetworkSandbox `deniedHosts` MUST take precedence over `allowedHosts` | S12 |
| ST-12.06 | ProcessSandbox MUST have: `allowedCommands: readonly string[]`, `deniedCommands: readonly string[]` (takes precedence), `maxProcesses: number`, `inheritEnv: boolean`, `allowedEnvVars: readonly string[]` | S12 |
| ST-12.07 | ProcessSandbox `deniedCommands` MUST take precedence over `allowedCommands` | S12 |
| ST-12.08 | ResourceSandbox MUST have: `maxMemory: number` (bytes), `maxCpu: number` (percentage 0-100), `maxDiskIO: number` (bytes/sec) | S12 |
| ST-12.09 | DurationSandbox MUST have: `maxDuration: number` (ms), `hardKillAfter: number` (ms after maxDuration before SIGKILL), `warningAt: number` (ms, emit warning event) | S12 |

### S12.1 AdapterSandboxDefaults

| ID | Requirement | Source |
|---|---|---|
| ST-12.10 | AdapterSandboxDefaults MUST have all-optional readonly fields: `allowedPathPatterns`, `deniedPathPatterns`, `allowedHostPatterns`, `deniedHostPatterns`, `allowedCommands`, `deniedCommands`, `maxDurationMs`, `readOnlyFilesystem` | S12.1 |
| ST-12.11 | AdapterSandboxDefaults is a lightweight config that adapters provide; the governance layer MUST expand it to a full SandboxConfig | S12.1 |

**Totals: 11 requirements**

---

## S13 RefusalRule

| ID | Requirement | Source |
|---|---|---|
| ST-13.01 | RefusalRule MUST have readonly fields: `id: string`, `name: string`, `description: string`, `priority: number` (lower = higher priority, evaluated first), `condition: RefusalCondition`, `verdict: 'refuse' | 'escalate' | 'sandbox'`, `message: string`, `enabled: boolean`, `builtin: boolean` | S13 |
| ST-13.02 | `builtin: true` rules MUST NOT be disableable by tenant | S13 |
| ST-13.03 | `priority` MUST be evaluated in ascending order (lower number = evaluated first) | S13 |
| ST-13.04 | RefusalCondition MUST be a discriminated union with `type` discriminant and 9 variants | S13 |
| ST-13.05 | Condition `path_match`: `pattern: string`, `deny: boolean` | S13 |
| ST-13.06 | Condition `command_match`: `pattern: string` | S13 |
| ST-13.07 | Condition `host_match`: `pattern: string` | S13 |
| ST-13.08 | Condition `action_type`: `actionTypes: readonly ComputerActionType[]` | S13 |
| ST-13.09 | Condition `trust_below`: `minimumTrust: AgentTrustLevel` | S13 |
| ST-13.10 | Condition `rate_exceeded`: `policy: RateLimitPolicy` | S13 |
| ST-13.11 | Condition `classification_above`: `maxLevel: ClassificationLevel` | S13 |
| ST-13.12 | Condition `time_window`: `denyDuring: { start: string; end: string }` | S13 |
| ST-13.13 | Condition `composite`: `operator: 'and' | 'or' | 'not'`, `conditions: readonly RefusalCondition[]` (recursive) | S13 |

### S13.1 AdapterRefusalHint

| ID | Requirement | Source |
|---|---|---|
| ST-13.14 | AdapterRefusalHint MUST have readonly fields: `name: string`, `condition: RefusalCondition`, `verdict: 'refuse' | 'escalate' | 'sandbox'`, `message: string` | S13.1 |

**Totals: 14 requirements**

---

## S14 MergeStrategy

| ID | Requirement | Source |
|---|---|---|
| ST-14.01 | MergeStrategy MUST be a union type: `'highest_confidence' | 'evidence_weighted' | 'temporal_latest' | 'manual'` | S14 |
| ST-14.02 | `highest_confidence`: claim with higher confidence wins; tie falls to `temporal_latest`, then final tie-breaker | S14.1 |
| ST-14.03 | `evidence_weighted`: claim with more evidence references wins; tie falls to `highest_confidence`, then final tie-breaker | S14.1 |
| ST-14.04 | `temporal_latest`: most recently asserted claim wins; tie falls to final tie-breaker | S14.1 |
| ST-14.05 | `manual`: returns conflicts for human/agent resolution | S14.1 |
| ST-14.06 | Final tie-breaker: trunk claim wins over branch claim; otherwise earlier `branchIds` position wins; otherwise lexicographically smaller `ClaimId` wins | S14.1 |
| ST-14.07 | The final tie-breaker applies to every non-manual strategy and makes equal cases deterministic | S14.1 |

### S14.2 Manual Strategy

| ID | Requirement | Source |
|---|---|---|
| ST-14.08 | When `mergeBranches` is called with `strategy: 'manual'`, system MUST identify all conflicts (same subject+predicate, different values) | S14.2 step 1 |
| ST-14.09 | For each conflict, MUST return `MergeConflict` in `unresolvedConflicts` | S14.2 step 1 |
| ST-14.10 | Manual merge MUST NOT complete; result MUST have `status: 'pending_resolution'` | S14.2 step 1 |
| ST-14.11 | Caller MUST call `resolveConflict(mergeId, conflictId, resolution)` for each conflict | S14.2 step 2 |
| ST-14.12 | ManualMergeResolution MUST be: `'keep_branch' | 'keep_trunk' | 'keep_both' | 'discard_both' | 'merge_new_value'` | S14.2 step 3 |
| ST-14.13 | Once all conflicts are resolved, merge MUST auto-complete | S14.2 step 4 |
| ST-14.14 | If conflicts are not resolved within `session.timeout`, branch MUST be auto-discarded | S14.2 step 5 |
| ST-14.15 | If `endSession()` occurs while conflicts remain pending, merge MUST transition to `discarded`, all unmerged branch claims MUST be auto-discarded, and a forced-termination audit entry MUST be recorded | S14.2 step 6 |

### S14.2 Types

| ID | Requirement | Source |
|---|---|---|
| ST-14.16 | MergeConflict MUST have readonly fields: `conflictId: string`, `subject: string`, `predicate: string`, `branchValue: string`, `branchConfidence: number`, `trunkValue: string`, `trunkConfidence: number` | S14.2 |
| ST-14.17 | MergeConflictResolution MUST have readonly fields: `conflictId: string`, `resolution: ManualMergeResolution`, optional `newValue?: string` (required when resolution is `merge_new_value`), optional `newConfidence?: number` (required when resolution is `merge_new_value`), `resolvedBy: AgentId`, `resolvedAt: string` (ISO-8601) | S14.2 |
| ST-14.18 | ManualMergeState MUST have readonly fields: `mergeId: string`, `status: 'pending_resolution' | 'resolved' | 'timed_out' | 'discarded'`, `conflicts: readonly MergeConflict[]`, `resolved: readonly MergeConflictResolution[]`, `deadline: string` (ISO-8601), optional `discardedReason?: 'timeout' | 'session_ended' | 'explicit_discard'` | S14.2 |
| ST-14.19 | Session termination with pending manual merge MUST transition merge to `'discarded'` with reason `'session_ended_with_pending_merge'` in audit entry | S14 session termination |
| ST-14.20 | `newValue` and `newConfidence` MUST be provided when resolution is `merge_new_value` | S14.2 |

**Totals: 20 requirements**

---

## S15 SessionSummary

| ID | Requirement | Source |
|---|---|---|
| ST-15.01 | SessionSummary MUST have readonly fields: `sessionId: SessionId`, `agentId: AgentId`, `adapterId: AdapterId`, `startedAt: string`, `endedAt: string`, `duration: number` (ms), `operations: SessionOperationCounts`, `governance: SessionGovernanceCounts`, `branches: SessionBranchCounts`, `missions: SessionMissionCounts` | S15 |
| ST-15.02 | SessionOperationCounts MUST have readonly fields: `memoryWrites: number`, `memoryReads: number`, `memoryDeletes: number`, `computerActions: number`, `totalOperations: number` | S15 |
| ST-15.03 | SessionGovernanceCounts MUST have readonly fields: `allowed: number`, `refused: number`, `escalated: number`, `sandboxed: number` | S15 |
| ST-15.04 | SessionBranchCounts MUST have readonly fields: `created: number`, `merged: number`, `discarded: number` | S15 |
| ST-15.05 | SessionMissionCounts MUST have readonly fields: `created: number`, `completed: number`, `failed: number` | S15 |
| ST-15.06 | `totalOperations` MUST equal `memoryWrites + memoryReads + memoryDeletes + computerActions` | S15 (implied by structure) |
| ST-15.07 | `duration` MUST be in milliseconds | S15 |
| ST-15.08 | `startedAt` MUST be ISO-8601 format | S15 |
| ST-15.09 | `endedAt` MUST be ISO-8601 format | S15 |
| ST-15.10 | All count fields MUST be non-negative integers | S15 (implied) |

**Totals: 10 requirements**

---

## S16 Unified Event System

| ID | Requirement | Source |
|---|---|---|
| ST-16.01 | AgentEvent MUST be a union type of exactly 120 string literal values (including wildcard `'*'`) covering all event categories | S16.1 |
| ST-16.02 | Memory events MUST include: `memory:created`, `memory:recalled`, `memory:forgotten`, `memory:branch_created`, `memory:branch_merged`, `memory:branch_discarded` | S16.1 |
| ST-16.03 | Governance events MUST include: `governance:allowed`, `governance:refused`, `governance:escalated`, `governance:sandboxed` | S16.1 |
| ST-16.04 | Computer action events MUST include: `action:before`, `action:after`, `action:refused` | S16.1 |
| ST-16.05 | Session events MUST include: `session:started`, `session:ended`, `session:rejected` | S16.1 |
| ST-16.06 | Intelligence events MUST include: `technique:extracted`, `technique:evaluated`, `technique:promoted`, `technique:suspended`, `technique:retired`, `technique:transferred`, `cognitive:health_degraded`, `cognitive:consolidation_complete`, `cognitive:gap_detected`, `selfheal:triggered`, `selfheal:cascade`, `selfheal:complete`, `selfheal:conflict_resolved` | S16.1 |
| ST-16.07 | Execution events MUST include: `mission:created`, `mission:state_changed`, `mission:delegated`, `mission:completed`, `mission:failed`, `mission:cancelled`, `task:created`, `task:state_changed`, `task:completed`, `task:failed`, `task:retried`, `budget:reserved`, `budget:consumed`, `budget:released`, `budget:exhausted`, `wave:started`, `wave:completed`, `wave:failed` | S16.1 |
| ST-16.08 | Context events MUST include: `context:pressure_changed`, `context:eviction_triggered`, `context:eviction_complete`, `context:pin_added`, `context:pin_removed`, `working_memory:written`, `working_memory:discarded`, `working_memory:flushed` | S16.1 |
| ST-16.09 | Search events MUST include: `search:queried`, `embedding:queued`, `embedding:completed`, `duplicate:detected` | S16.1 |
| ST-16.10 | Coordination events MUST include: `a2a:sent`, `a2a:refused`, `session:forked`, `sync:watermark_advanced`, `replay:verified`, `replay:diverged`, `a2a:rule_registered`, `a2a:rule_removed`, `a2a:action_validated`, `a2a:action_denied`, `a2a:action_masked`, `a2a:rate_limited`, `fork:created`, `fork:merged`, `fork:discarded`, `fork:conflict_detected`, `sync:started`, `sync:completed`, `sync:failed`, `sync:conflict_resolved`, `sync:peer_registered`, `sync:peer_removed`, `sync:peer_unreachable`, `replay:snapshot_captured`, `replay:verification_complete`, `replay:verification_failed`, `replay:divergence_detected` | S16.1 |
| ST-16.11 | Output/telemetry/inference/plugin events MUST include: `output:produced`, `telemetry:reported`, `inference:completed`, `inference:rejected`, `plugin:installed`, `plugin:disabled`, `hook:failed`, `output:retracted`, `telemetry:cost_recorded`, `telemetry:vital_recorded`, `inference:started`, `inference:retry`, `inference:failed`, `plugin:uninstalled`, `plugin:error`, `hook:registered`, `hook:fired`, `hook:blocked` | S16.1 |
| ST-16.12 | Lifecycle events MUST include: `agent:registered`, `agent:updated`, `agent:suspended`, `agent:reactivated`, `agent:decommissioned`, `capability:granted`, `capability:revoked`, `trust:promoted`, `trust:demoted`, `consent:registered`, `consent:revoked`, `consent:expired`, `knowledge:exported`, `knowledge:imported`, `knowledge:transferred` | S16.1 |
| ST-16.13 | Wildcard `'*'` MUST be a valid AgentEvent value | S16.1 |

### S16.2 Event Payload and Bus

| ID | Requirement | Source |
|---|---|---|
| ST-16.14 | AgentEventPayload MUST have readonly fields: `type: AgentEvent`, `timestamp: string` (ISO-8601), `agentId: AgentId`, `sessionId: SessionId`, `auditId: EventId`, `data: Readonly<Record<string, unknown>>` | S16.2 |
| ST-16.15 | AgentEventHandler MUST be typed as `(payload: AgentEventPayload) => void | Promise<void>` | S16.2 |
| ST-16.16 | AgentEventBus MUST have method `on(event: AgentEvent, handler: AgentEventHandler): string` returning a subscription ID | S16.2 |
| ST-16.17 | AgentEventBus MUST have method `off(subscriptionId: string): void` | S16.2 |
| ST-16.18 | AgentEventBus MUST have method `emit(payload: AgentEventPayload): void` (internal use only) | S16.2 |
| ST-16.19 | `EventBus` MUST be a type alias for `AgentEventBus` | S16.2 |
| ST-16.20 | `emit` MUST be internal-only; adapters subscribe and translate but MUST NOT suppress audit-bound events | S16.2 validation |
| ST-16.21 | Wildcard `'*'` MUST receive every event AFTER the specific-event handler queue | S16.2 validation |
| ST-16.22 | Event ordering MUST be guaranteed within a single `sessionId`; cross-session ordering is by audit-chain timestamp only | S16.2 validation |

### S16 Behavioral

| ID | Requirement | Source |
|---|---|---|
| ST-16.23 | `eventBus.on('memory:created', handler)` MUST receive only memory creation events; `eventBus.on('*', handler)` MUST receive all Phase X events | S16.2 example |

**Totals: 24 requirements**

---

## S17 Retention Policy

| ID | Requirement | Source |
|---|---|---|
| ST-17.01 | RetentionPolicy MUST have readonly fields: `classification: ClassificationLevel`, `retentionDays: number`, `autoArchiveDays: number | null` (null = never auto-archive), `tombstoneOnExpiry: boolean`, `gdprOverride: boolean` | S17 |
| ST-17.02 | DEFAULT_RETENTION for `unrestricted`: retentionDays=90, autoArchiveDays=30, tombstoneOnExpiry=false, gdprOverride=true | S17 |
| ST-17.03 | DEFAULT_RETENTION for `internal`: retentionDays=365, autoArchiveDays=90, tombstoneOnExpiry=true, gdprOverride=true | S17 |
| ST-17.04 | DEFAULT_RETENTION for `confidential`: retentionDays=1095, autoArchiveDays=365, tombstoneOnExpiry=true, gdprOverride=true | S17 |
| ST-17.05 | DEFAULT_RETENTION for `restricted`: retentionDays=1825, autoArchiveDays=730, tombstoneOnExpiry=true, gdprOverride=false | S17 |
| ST-17.06 | DEFAULT_RETENTION for `critical`: retentionDays=2555, autoArchiveDays=null, tombstoneOnExpiry=true, gdprOverride=false | S17 |
| ST-17.07 | Only `unrestricted` classification MAY use hard delete (`tombstoneOnExpiry: false`) | S17 |
| ST-17.08 | `restricted` and `critical` MUST NOT allow GDPR override (`gdprOverride: false`) | S17 |
| ST-17.09 | `unrestricted` retention MUST be 90 days | S17 table |
| ST-17.10 | `internal` retention MUST be 1 year (365 days) | S17 table |
| ST-17.11 | `confidential` retention MUST be 3 years (1095 days) | S17 table |
| ST-17.12 | `critical` auto-archive MUST be `null` (never auto-archive) | S17 table |

**Totals: 12 requirements**

---

## S18 Rate Limit Policy

| ID | Requirement | Source |
|---|---|---|
| ST-18.01 | RateLimitPolicy MUST have readonly fields: `scope: 'per_agent' | 'per_session' | 'per_adapter' | 'global'`, `dimension: 'actions' | 'memory_writes' | 'computer_actions' | 'all_operations'`, `limit: number`, `windowSeconds: number`, `enforcement: 'hard_refuse' | 'soft_throttle' | 'queue'` | S18 |
| ST-18.02 | DEFAULT_RATE_LIMITS MUST include: per_agent/all_operations limit=1000, window=60s, enforcement=hard_refuse | S18 |
| ST-18.03 | DEFAULT_RATE_LIMITS MUST include: per_agent/computer_actions limit=100, window=60s, enforcement=hard_refuse | S18 |
| ST-18.04 | DEFAULT_RATE_LIMITS MUST include: per_agent/memory_writes limit=500, window=60s, enforcement=soft_throttle | S18 |
| ST-18.05 | DEFAULT_RATE_LIMITS MUST include: per_session/all_operations limit=5000, window=300s, enforcement=hard_refuse | S18 |
| ST-18.06 | DEFAULT_RATE_LIMITS MUST include: global/all_operations limit=10000, window=60s, enforcement=queue | S18 |
| ST-18.07 | Rate limit precedence: most specific wins. per_agent > per_session > per_adapter > global | S18 precedence |
| ST-18.08 | If an action would violate ANY applicable limit, the most restrictive enforcement MUST apply | S18 enforcement |
| ST-18.09 | `scope` MUST be exactly 4 values: `per_agent`, `per_session`, `per_adapter`, `global` | S18 |
| ST-18.10 | `dimension` MUST be exactly 4 values: `actions`, `memory_writes`, `computer_actions`, `all_operations` | S18 |
| ST-18.11 | `enforcement` MUST be exactly 3 values: `hard_refuse`, `soft_throttle`, `queue` | S18 |
| ST-18.12 | DEFAULT_RATE_LIMITS MUST be a readonly array of exactly 5 policies | S18 |

**Totals: 12 requirements**

---

## S19 Consent Integration

| ID | Requirement | Source |
|---|---|---|
| ST-19.01 | ConsentableOperation MUST be a union type: `'assert_claim' | 'transfer_knowledge' | 'export_data' | 'share_with_agent' | 'store_personal_data' | 'process_sensitive'` | S19 |
| ST-19.02 | ConsentPurpose MUST be a union type: `'memory_storage' | 'technique_extraction' | 'knowledge_transfer' | 'analytics' | 'improvement'` | S19 |
| ST-19.03 | ConsentRequirement MUST have readonly fields: `operation: ConsentableOperation`, `dataSubjectId: string`, `purpose: ConsentPurpose`, `checkBefore: 'memory_write' | 'knowledge_transfer' | 'data_export'` | S19 |
| ST-19.04 | ConsentContext MUST have readonly fields: `agentId: AgentId`, `tenantId: TenantId | null`, `dataSubjectId: string | null`, `operation: ConsentableOperation`, `purpose: ConsentPurpose`, `consentId: ConsentId | null`, `granted: boolean`, `checkedAt: string` (ISO-8601) | S19 |
| ST-19.05 | Memory Bridge `remember()` MUST check consent when content contains personal data identifiers (predicate patterns: `personal.*`, `user.*`, `identity.*`) | S19 triggers |
| ST-19.06 | Memory Bridge `remember()` MUST check consent when classification is `restricted` or `critical` | S19 triggers |
| ST-19.07 | Memory Bridge `remember()` MUST check consent when agent is operating on behalf of a data subject | S19 triggers |
| ST-19.08 | If `granted` is true, `consentId` MUST be present | S19 validation |
| ST-19.09 | If `dataSubjectId` is null, the operation MUST be one that does not process personal data | S19 validation |
| ST-19.10 | Consent checks MUST run before persistence or export | S19 validation |
| ST-19.11 | A `store_personal_data` operation for a user MUST return `granted: false` and block `remember()` when no active consent exists | S19 example |
| ST-19.12 | `checkBefore` MUST be exactly 3 values: `memory_write`, `knowledge_transfer`, `data_export` | S19 |
| ST-19.13 | ConsentableOperation MUST have exactly 6 values | S19 |
| ST-19.14 | ConsentPurpose MUST have exactly 5 values | S19 |

**Totals: 14 requirements**

---

## S20 Performance Budget

| ID | Requirement | Source |
|---|---|---|
| ST-20.01 | Governance check MUST complete within 10ms, covering rule evaluation and verdict production ONLY | S20 |
| ST-20.02 | Audit append MUST complete within 50ms in durable-before-success mode | S20 |
| ST-20.03 | Audit append MUST guarantee: no success returned without audit | S20 |
| ST-20.04 | Provenance hash MUST be batched background mode with batch size 100, max 100ms | S20 |
| ST-20.05 | Full chain verification MUST be on-demand only, NOT per-operation | S20 |
| ST-20.06 | PerformanceBudget MUST be a typed interface with 4 readonly fields: `governanceCheck: { readonly maxMs: 10; readonly includes: 'rule_evaluation, verdict_production' }`, `auditAppend: { readonly maxMs: 50; readonly mode: 'durable_before_success'; readonly guarantees: 'no_success_without_audit' }`, `provenanceHash: { readonly maxMs: 100; readonly mode: 'batched_background'; readonly batchSize: 100 }`, `fullChainVerification: { readonly mode: 'on_demand'; readonly notPerOperation: true }` | S20 |

### S20.1 TokenEstimator

| ID | Requirement | Source |
|---|---|---|
| ST-20.07 | TokenEncoding MUST be a union type: `'cl100k_base' | 'o200k_base' | 'provider_native'` | S20.1 |
| ST-20.08 | TokenEstimate MUST have readonly fields: `tokens: number`, `encoding: TokenEncoding`, `exact: boolean`, `varianceUpperBoundPct: number`, `overflow: boolean` | S20.1 |
| ST-20.09 | TokenEstimator MUST have method `estimate(input: string | Readonly<Record<string, unknown>>, encoding: TokenEncoding): TokenEstimate` | S20.1 |
| ST-20.10 | `tokens` MUST be a finite non-negative integer; `varianceUpperBoundPct` MUST be <= 10 for approximate estimates and 0 for exact estimates | S20.1 validation |
| ST-20.11 | If tokenization fails or estimate exceeds caller budget by more than variance bound, `overflow` MUST be true and caller MUST exclude the item rather than truncate silently | S20.1 validation |

**Totals: 11 requirements**

---

## S21 AgentFramework

| ID | Requirement | Source |
|---|---|---|
| ST-21.01 | AgentFramework MUST be a union type of exactly 10 string literal values | S21 |
| ST-21.02 | AgentFramework values MUST include: `'claude'`, `'codex'`, `'openclaw'`, `'hermes'`, `'gemma'`, `'custom'`, `'crew_ai'`, `'auto_gen'`, `'semantic_kernel'`, `'llama_index'` | S21 |

**Totals: 2 requirements**

---

## S22 TGP Types

| ID | Requirement | Source |
|---|---|---|
| ST-22.01 | TGPTechniqueStatus MUST be a union type: `'candidate' | 'active' | 'suspended' | 'retired'` | S22 |
| ST-22.02 | TechniqueProvenanceKind MUST be a union type: `'local_extraction' | 'cross_agent_transfer' | 'template_seed'` | S22 |
| ST-22.03 | EvaluationSource MUST be a union type: `'runtime' | 'template' | 'transfer_history' | 'manual'` | S22 |
| ST-22.04 | EvaluationMethod MUST be a union type: `'shadow_execution' | 'dedicated_task' | 'retrospective' | 'human_review' | 'template_provided'` | S22 |
| ST-22.05 | PromotionResult MUST be a union type: `'promoted' | 'rejected'` | S22 |
| ST-22.06 | TGPRetiredReason MUST be a union type: `'low_success_rate' | 'low_confidence' | 'stale' | 'human_flagged' | 'candidate_expiry' | 'quarantine_permanent'` | S22 |
| ST-22.07 | All TGP types are used by Intelligence Bridge and Lifecycle Management contracts | S22 preamble |

**Totals: 7 requirements**

---

## S23 Multi-Branch Merge Ordering

| ID | Requirement | Source |
|---|---|---|
| ST-23.01 | When `mergeBranches` receives multiple branchIds, branches MUST be processed in ORDER of the `branchIds` array (first = highest priority) | S23 step 1 |
| ST-23.02 | For each branch, claims MUST be merged in chronological order (`createdAt` ascending) | S23 step 2 |
| ST-23.03 | If branch N's claim conflicts with an already-merged claim from branch M (M < N), branch M's claim MUST win (earlier position = higher priority) | S23 step 3 |
| ST-23.04 | If a branch's claim conflicts with a TRUNK claim, the merge strategy applies; if strategy comparison ties, the trunk claim MUST win | S23 step 4 |
| ST-23.05 | All conflict resolutions MUST be recorded in `MergeResult.conflictsResolved` | S23 step 5 |
| ST-23.06 | The algorithm MUST be deterministic: same inputs MUST always produce same outputs regardless of execution timing | S23 |

**Totals: 6 requirements**

---

## S24 ActionDigest

| ID | Requirement | Source |
|---|---|---|
| ST-24.01 | ActionDigest MUST have readonly field `actionId: EventId` | S24 |
| ST-24.02 | ActionDigest MUST have readonly field `type: string` (ComputerAction.type) | S24 |
| ST-24.03 | ActionDigest MUST have readonly field `timestamp: string` (ISO-8601) | S24 |
| ST-24.04 | ActionDigest MUST have readonly field `verdict: 'allow' | 'refuse' | 'escalate' | 'sandbox'` | S24 |
| ST-24.05 | ActionDigest MUST have readonly field `duration: number` (ms) | S24 |

**Totals: 5 requirements**

---

## S25 Rust Equivalents

### Governing Rule

| ID | Requirement | Source |
|---|---|---|
| ST-25.01 | Every TypeScript closed enum, branded type, and typed interface MUST have a structurally equivalent Rust projection (Dual-Projection Parity Rule) | S25 |
| ST-25.02 | `String` is forbidden in Rust where TypeScript uses a union literal type | S25 |
| ST-25.03 | `serde_json::Value` is forbidden in Rust where TypeScript uses a typed interface or discriminated union | S25 |
| ST-25.04 | TC-21 (Dual Projection Parity) MUST be enforced in every adapter contract | S25 |

### Branded IDs (Rust newtypes)

| ID | Requirement | Source |
|---|---|---|
| ST-25.05 | Rust TenantId MUST be `pub struct TenantId(pub String)` with Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize | S25 |
| ST-25.06 | Rust UserId MUST be `pub struct UserId(pub String)` with same derives | S25 |
| ST-25.07 | Rust AgentId MUST be `pub struct AgentId(pub String)` with same derives | S25 |
| ST-25.08 | Rust SessionId MUST be `pub struct SessionId(pub String)` with same derives | S25 |
| ST-25.09 | Rust EventId MUST be `pub struct EventId(pub String)` with same derives | S25 |
| ST-25.10 | Rust PolicyId MUST be `pub struct PolicyId(pub String)` with same derives | S25 |
| ST-25.11 | Rust MissionId MUST be `pub struct MissionId(pub String)` with same derives | S25 |
| ST-25.12 | Rust TaskId MUST be `pub struct TaskId(pub String)` with same derives | S25 |
| ST-25.13 | Rust AdapterId MUST be `pub struct AdapterId(pub String)` with same derives | S25 |
| ST-25.14 | Rust ClaimId MUST be `pub struct ClaimId(pub String)` with same derives | S25 |
| ST-25.15 | Rust RelationshipId MUST be `pub struct RelationshipId(pub String)` with same derives | S25 |
| ST-25.16 | Rust AgentBranchId MUST be `pub struct AgentBranchId(pub String)` with same derives | S25 |
| ST-25.17 | Rust ConsentId MUST be `pub struct ConsentId(pub String)` with same derives | S25 |
| ST-25.18 | Rust AuditEntryId MUST be `pub struct AuditEntryId(pub String)` with same derives | S25 |
| ST-25.19 | Rust KnowledgePackageId MUST be `pub struct KnowledgePackageId(pub String)` with same derives | S25 |

### Rust Enums

| ID | Requirement | Source |
|---|---|---|
| ST-25.20 | Rust ObjectType MUST be a closed enum with 5 variants matching TS, using `#[serde(rename_all = "snake_case")]` | S25 |
| ST-25.21 | Rust ClaimStatus MUST be a closed enum with 2 variants | S25 |
| ST-25.22 | Rust GroundingMode MUST be a closed enum with 2 variants | S25 |
| ST-25.23 | Rust FreshnessLabel MUST be a closed enum with 3 variants | S25 |
| ST-25.24 | Rust ArchiveMode MUST be a closed enum with 3 variants | S25 |
| ST-25.25 | Rust EvidenceType MUST be a closed enum with 4 variants | S25 |
| ST-25.26 | Rust RelationshipType MUST be a closed enum with 4 variants | S25 |
| ST-25.27 | Rust ConsentableOperation MUST be a closed enum with 6 variants | S25 |
| ST-25.28 | Rust ConsentPurpose MUST be a closed enum with 5 variants | S25 |
| ST-25.29 | Rust Permission MUST be a closed enum with 31 variants using `#[serde(rename_all = "snake_case")]` | S25 |
| ST-25.30 | Rust CoreTrustLevel MUST be a closed enum with 4 variants | S25 |
| ST-25.31 | Rust AgentTrustLevel MUST be a closed enum with 5 variants, deriving PartialOrd+Ord, with numeric discriminants 0-4 | S25 |
| ST-25.32 | Rust AgentTrustLevel MUST implement `clearance_level(&self) -> u8` matching TS TRUST_TO_CLEARANCE | S25 |
| ST-25.33 | Rust AgentTrustLevel MUST implement `core_trust_level(&self) -> CoreTrustLevel` matching TS PHASE_X_TO_CORE_TRUST | S25 |
| ST-25.34 | Rust GovernanceAction MUST be a tagged enum with `#[serde(tag = "domain", content = "operation")]` and 10 domain variants with typed operation enums | S25 |
| ST-25.35 | Rust MUST have 10 operation enums: MemoryOperation (6), ExecutionOperation (5), LifecycleOperation (5), KnowledgeOperation (3), ConsentOperation (3), ContextOperation (6), SearchOperation (4), CoordinationOperation (5), OutputOperation (5), ComputerActionType (17) | S25 |
| ST-25.36 | Rust AgentCapability MUST be a closed enum with 20 variants | S25 |
| ST-25.37 | Rust ComputerActionType MUST be a closed enum with 17 variants using `#[serde(rename = "...")]` for colon-separated values | S25 |
| ST-25.38 | Rust GovernanceVerdict MUST be a tagged enum with `#[serde(tag = "verdict")]` and 4 variants matching TS | S25 |
| ST-25.39 | Rust ApprovalType MUST be a closed enum with 2 variants: Human, SeniorAgent | S25 |
| ST-25.40 | Rust AgentEvent MUST be a closed enum mirroring ALL TS AgentEvent literal values (no String wrapper) | S25 |
| ST-25.41 | Rust MergeStrategy MUST be a closed enum with 4 variants | S25 |
| ST-25.42 | Rust AgentFramework MUST be a closed enum with 10 variants | S25 |

### Known TC-21 Parity Gaps (tracked for resolution)

| ID | Requirement | Source |
|---|---|---|
| ST-25.43 | Known gap: AdapterSandboxDefaults TS optional fields vs Rust required fields with Default derive -- MUST reconcile when Rust adapter layer ships | S25 R2-49/50 |
| ST-25.44 | Known gap: SessionSummary.duration TS `number` (IEEE 754) vs Rust `u64` -- semantic gap is precision, not meaning | S25 R2-49/50 |
| ST-25.45 | Known gap: NetworkSandbox.allowedProtocols Rust `Vec<String>` vs TS union literal -- MUST add Rust-side validation to match TS constraints | S25 R2-49/50 |

### Rust Structs (Dual-Projection Parity)

| ID | Requirement | Source |
|---|---|---|
| ST-25.46 | Rust struct `OperationContext` MUST have fields structurally equivalent to TS interface `OperationContext` (6 fields: tenant_id, user_id, agent_id, permissions, session_id, clearance_level) | S25 |
| ST-25.47 | Rust struct `AgentSession` MUST have fields structurally equivalent to TS interface `AgentSession` (12 fields: session_id, agent_id, tenant_id, adapter_id, trust_level, core_trust_level, clearance_level, capabilities, started_at, working_memory_namespace, active_missions, metadata) | S25 |
| ST-25.48 | Rust struct `GovernanceContext` MUST have fields structurally equivalent to TS interface `GovernanceContext` (6 fields: operation_context, session, action, resource, policy_ids, action_history) | S25 |
| ST-25.49 | Rust struct `GovernanceDecision` MUST have fields structurally equivalent to TS interface `GovernanceDecision` (8 fields: allowed, verdict, reason, required_permissions, missing_permissions, clearance_required, clearance_actual, evaluated_at) | S25 |
| ST-25.50 | Rust struct `AgentMemoryEntry` MUST have fields structurally equivalent to TS interface `AgentMemoryEntry` (16 fields: id, content, subject, predicate, value, confidence, effective_confidence, freshness, classification, tags, category, source_agent_id, mission_id, task_id, grounding_mode, created_at) | S25 |
| ST-25.51 | Rust struct `EvidenceRef` MUST have fields structurally equivalent to TS interface `EvidenceRef` (3 fields: evidence_type, id, description) | S25 |
| ST-25.52 | Rust struct `RelationshipRef` MUST have fields structurally equivalent to TS interface `RelationshipRef` (3 fields: id, relationship_type, target_id) | S25 |
| ST-25.53 | Rust struct `BeliefState` MUST have fields structurally equivalent to TS interface `BeliefState` (6 fields: belief, evidence, relationships, status, retention_policy, governance) | S25 |
| ST-25.54 | Rust struct `StructuredContent` MUST have fields structurally equivalent to TS interface `StructuredContent` (4 fields: subject, predicate, value, object_type) | S25 |
| ST-25.55 | Rust struct `AgentMemoryOptions` MUST have fields structurally equivalent to TS interface `AgentMemoryOptions` (9 fields: confidence, reasoning, classification, tags, category, mission_id, task_id, grounding_mode, retention_days) | S25 |
| ST-25.56 | Rust struct `AgentRecallQuery` MUST have fields structurally equivalent to TS interface `AgentRecallQuery` (14 fields: text, subject, predicate, tags, category, freshness_filter, min_confidence, time_range, classification, mission_id, task_id, source_agent_id, include_superseded, branch_id) | S25 |
| ST-25.57 | Rust struct `AgentRecallOptions` MUST have fields structurally equivalent to TS interface `AgentRecallOptions` (7 fields: limit, offset, include_evidence, include_relationships, search_mode, archive_mode, sort_by) | S25 |
| ST-25.58 | Rust struct `AuditLogEntry` MUST have fields structurally equivalent to TS interface `AuditLogEntry` (12 fields: id, timestamp, tenant_id, agent_id, session_id, event, action, governance_decision, details, previous_hash, current_hash, classification) | S25 |
| ST-25.59 | Rust type alias `AgentAuditEntry` MUST be `pub type AgentAuditEntry = AuditLogEntry` | S25 |
| ST-25.60 | Rust struct `ConsentContext` MUST have fields structurally equivalent to TS interface `ConsentContext` (8 fields: agent_id, tenant_id, data_subject_id, operation, purpose, consent_id, granted, checked_at) | S25 |

### Rust Sandbox Structs

| ID | Requirement | Source |
|---|---|---|
| ST-25.61 | Rust struct `SandboxConfig` MUST have fields structurally equivalent to TS interface `SandboxConfig` (5 fields: filesystem, network, process, resources, duration) | S25 |
| ST-25.62 | Rust struct `FilesystemSandbox` MUST have fields structurally equivalent to TS interface `FilesystemSandbox` (5 fields: allowed_paths, denied_paths, read_only, max_file_size, max_total_size) | S25 |
| ST-25.63 | Rust struct `NetworkSandbox` MUST have fields structurally equivalent to TS interface `NetworkSandbox` (5 fields: allowed_hosts, denied_hosts, allowed_protocols, max_connections, max_bandwidth) | S25 |
| ST-25.64 | Rust struct `ProcessSandbox` MUST have fields structurally equivalent to TS interface `ProcessSandbox` (5 fields: allowed_commands, denied_commands, max_processes, inherit_env, allowed_env_vars) | S25 |
| ST-25.65 | Rust struct `ResourceSandbox` MUST have fields structurally equivalent to TS interface `ResourceSandbox` (3 fields: max_memory, max_cpu, max_disk_io) | S25 |
| ST-25.66 | Rust struct `DurationSandbox` MUST have fields structurally equivalent to TS interface `DurationSandbox` (3 fields: max_duration, hard_kill_after, warning_at) | S25 |

### Rust Policy Structs

| ID | Requirement | Source |
|---|---|---|
| ST-25.67 | Rust struct `RetentionPolicy` MUST have fields structurally equivalent to TS interface `RetentionPolicy` (5 fields: classification, retention_days, auto_archive_days, tombstone_on_expiry, gdpr_override) | S25 |
| ST-25.68 | Rust struct `RateLimitPolicy` MUST have fields structurally equivalent to TS interface `RateLimitPolicy` (5 fields: scope, dimension, limit, window_seconds, enforcement) | S25 |

### Rust Estimator Structs

| ID | Requirement | Source |
|---|---|---|
| ST-25.69 | Rust struct `TokenEstimate` MUST have fields structurally equivalent to TS interface `TokenEstimate` (5 fields: tokens, encoding, exact, variance_upper_bound_pct, overflow) | S25 |
| ST-25.70 | Rust struct `TimeRange` MUST have fields structurally equivalent to TS `{ from: string; to: string }` (2 fields: from, to) | S25 |

### Missing Rust Enums (Dual-Projection Parity)

| ID | Requirement | Source |
|---|---|---|
| ST-25.71 | Rust enum `ManualMergeResolution` MUST be a closed enum with 5 variants: KeepBranch, KeepTrunk, KeepBoth, DiscardBoth, MergeNewValue | S25 |
| ST-25.72 | Rust enum `SearchMode` MUST be a closed enum with 3 variants: Text, Semantic, Hybrid | S25 |
| ST-25.73 | Rust enum `RecallSortBy` MUST be a closed enum with 3 variants: Relevance, Confidence, Recency | S25 |
| ST-25.74 | Rust enum `TokenEncoding` MUST be a closed enum with 3 variants: Cl100kBase, O200kBase, ProviderNative | S25 |
| ST-25.75 | Rust enum `ClassificationLevel` MUST be a closed enum with 5 variants and numeric discriminants: Unrestricted=0, Internal=1, Confidential=2, Restricted=3, Critical=4, deriving PartialOrd+Ord | S25 |
| ST-25.76 | Rust enum `RateLimitScope` MUST be a closed enum with 4 variants: PerAgent, PerSession, PerAdapter, Global | S25 |
| ST-25.77 | Rust enum `RateLimitDimension` MUST be a closed enum with 4 variants: Actions, MemoryWrites, ComputerActions, AllOperations | S25 |
| ST-25.78 | Rust enum `RateLimitEnforcement` MUST be a closed enum with 3 variants: HardRefuse, SoftThrottle, Queue | S25 |

### TGP Rust Enums (Dual-Projection Parity)

| ID | Requirement | Source |
|---|---|---|
| ST-25.79 | Rust enum `TGPTechniqueStatus` MUST be a closed enum with 4 variants: Candidate, Active, Suspended, Retired, using `#[serde(rename_all = "snake_case")]` | S25 |
| ST-25.80 | Rust enum `TechniqueProvenanceKind` MUST be a closed enum with 3 variants: LocalExtraction, CrossAgentTransfer, TemplateSeed, using `#[serde(rename_all = "snake_case")]` | S25 |

### TGP Types -- TC-21 Parity Gaps (no Rust projection in contract)

| ID | Requirement | Source |
|---|---|---|
| ST-25.81 | Known TC-21 gap: `EvaluationSource` (TS union of 4 values) has no Rust enum projection in the contract -- MUST add Rust enum when Intelligence Bridge adapter ships | S25 / TC-21 |
| ST-25.82 | Known TC-21 gap: `EvaluationMethod` (TS union of 5 values) has no Rust enum projection in the contract -- MUST add Rust enum when Intelligence Bridge adapter ships | S25 / TC-21 |
| ST-25.83 | Known TC-21 gap: `PromotionResult` (TS union of 2 values) has no Rust enum projection in the contract -- MUST add Rust enum when Intelligence Bridge adapter ships | S25 / TC-21 |
| ST-25.84 | Known TC-21 gap: `TGPRetiredReason` (TS union of 6 values) has no Rust enum projection in the contract -- MUST add Rust enum when Intelligence Bridge adapter ships | S25 / TC-21 |

**Totals: 84 requirements**

---

## S26 Type Ownership Index

| ID | Requirement | Source |
|---|---|---|
| ST-26.01 | Every type in the ownership index MUST be owned by SHARED_TYPES | S26 |
| ST-26.02 | The ownership index MUST cross-reference which contracts reference each type | S26 |
| ST-26.03 | AgentSession and AgentEvent MUST be referenced by ALL Phase X contracts | S26 |

**Totals: 3 requirements**

---

## S27 Import Directive

| ID | Requirement | Source |
|---|---|---|
| ST-27.01 | Every Phase X contract MUST begin with the shared types import directive | S27 |
| ST-27.02 | The directive MUST state: "All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type." | S27 |
| ST-27.03 | Any contract referencing a type from this registry MUST use it verbatim: no narrowing, no widening, no aliasing that changes semantics | S27 |
| ST-27.04 | A contract MAY define a local type alias for readability but MUST note it resolves to the shared type | S27 |

**Totals: 4 requirements**

---

## Grand Total

| Section | Count |
|---|---|
| S0 Governing Rules | 4 |
| S1 Limen Core Types | 26 |
| S2 CCP Types | 8 |
| S3 Classification Types | 8 |
| S4 Phase X Branded Types | 6 |
| S5 Trust and Clearance Model | 34 |
| S6 AgentCapability | 22 |
| S7 AgentSession | 14 |
| S8 Session-to-OperationContext Mapping | 22 |
| S9 GovernanceContext | 19 |
| S10 GovernanceVerdict + GovernanceDecision | 12 |
| S10.2 Memory and Belief Records | 27 |
| S10.3 AuditLogEntry | 9 |
| S11 ComputerAction | 21 |
| S12 SandboxConfig | 11 |
| S13 RefusalRule | 14 |
| S14 MergeStrategy | 20 |
| S15 SessionSummary | 10 |
| S16 Unified Event System | 24 |
| S17 Retention Policy | 12 |
| S18 Rate Limit Policy | 12 |
| S19 Consent Integration | 14 |
| S20 Performance Budget | 11 |
| S21 AgentFramework | 2 |
| S22 TGP Types | 7 |
| S23 Multi-Branch Merge Ordering | 6 |
| S24 ActionDigest | 5 |
| S25 Rust Equivalents | 84 |
| S26 Type Ownership Index | 3 |
| S27 Import Directive | 4 |
| **GRAND TOTAL** | **477** |
