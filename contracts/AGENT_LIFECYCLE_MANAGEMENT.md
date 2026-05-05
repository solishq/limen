# Agent Lifecycle Management Contract v1.1.0

**Status:** RATIFIED DESIGN -- Pending Implementation
**Governing:** CDM v2.0 + Contract Compliance v2.0
**Scope:** Agent registration, capability evolution, consent governance, and knowledge exchange
**Classification:** internal

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

---

## 1. Purpose

This contract defines the full lifecycle of AI agents within Limen -- from registration through capability evolution, consent-governed operations, knowledge portability, and eventual decommissioning. It ensures every agent has a well-defined identity, governed capabilities, and clean lifecycle boundaries. All state transitions produce audit entries, all capability changes require evidence, and all knowledge exchange respects classification and consent constraints.

**Ordering Constraint:** Agent registration (this contract) creates the identity. Adapter registration (`AGENT_ADAPTER_ARCHITECTURE`) binds a framework adapter to that identity. Registration MUST happen first. An adapter cannot be bound to a non-existent agent identity.

## 2. AgentLifecycleClient Interface

```typescript
import type { AgentId, TenantId, UserId, ClaimId, SessionId, ConsentId, KnowledgePackageId } from 'SHARED_TYPES §1.1, §4';
import type { Result, KernelError } from 'SHARED_TYPES §1.4, §1.5';
import type { ClassificationLevel } from 'SHARED_TYPES §3';
import type { AgentTrustLevel, CoreTrustLevel, AgentCapability, AgentFramework } from 'SHARED_TYPES §5, §6, §21';
import type { AgentEvent, AgentEventPayload, AgentEventHandler, AgentEventBus } from 'SHARED_TYPES §16';
import type { ConsentableOperation, ConsentPurpose } from 'SHARED_TYPES §19';
import type { TGPTechniqueStatus } from 'SHARED_TYPES §22';

interface AgentLifecycleClient {
  // Registration & Identity
  registerAgent(spec: AgentRegistrationSpec): Promise<Result<RegisteredAgent>>;
  getAgent(agentId: AgentId): Promise<Result<RegisteredAgent>>;
  listAgents(filter?: AgentFilter): Promise<Result<RegisteredAgent[]>>;
  updateAgent(agentId: AgentId, update: AgentUpdate): Promise<Result<RegisteredAgent>>;
  decommissionAgent(agentId: AgentId, reason: string): Promise<Result<DecommissionResult>>;

  // Capability Management
  requestCapabilityUpgrade(agentId: AgentId, request: CapabilityRequest): Promise<Result<CapabilityDecision>>;
  revokeCapability(agentId: AgentId, capability: AgentCapability, reason: string): Promise<Result<void>>;
  getCapabilities(agentId: AgentId): Promise<Result<AgentCapabilitySet>>;
  getCapabilityHistory(agentId: AgentId): Promise<Result<CapabilityHistoryEntry[]>>;

  // Trust Promotion (trust level elevation)
  promoteAgent(agentId: AgentId, request: PromotionRequest): Promise<Result<TrustPromotionResult>>;
  demoteAgent(agentId: AgentId, reason: string): Promise<Result<DemotionResult>>;
  getTrustLevel(agentId: AgentId): Promise<Result<AgentTrustLevel>>;

  // Consent Governance
  registerConsent(agentId: AgentId, consent: AgentConsentRecord): Promise<Result<ConsentId>>;
  revokeConsent(consentId: ConsentId, reason: string): Promise<Result<ConsentRevocationResult>>;
  checkConsent(agentId: AgentId, operation: ConsentableOperation): Promise<Result<ConsentDecision>>;
  listConsents(agentId: AgentId): Promise<Result<AgentConsentRecord[]>>;

  // Knowledge Exchange
  exportKnowledge(agentId: AgentId, options: KnowledgeExportOptions): Promise<Result<KnowledgePackage>>;
  importKnowledge(agentId: AgentId, pkg: KnowledgePackage, options?: KnowledgeImportOptions): Promise<Result<KnowledgeImportResult>>;
  transferKnowledge(fromAgentId: AgentId, toAgentId: AgentId, options: KnowledgeTransferOptions): Promise<Result<KnowledgeTransferResult>>;

  // Events (delegates to unified AgentEventBus -- see SHARED_TYPES §16)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
```

## 3. Registration & Identity Data Models

### 3.1 AgentRegistrationSpec

```typescript
// AgentFramework: See SHARED_TYPES §21 (6 values: 'claude' | 'codex' | 'openclaw' | 'hermes' | 'gemma' | 'custom')

interface AgentRegistrationSpec {
  readonly name: string;
  readonly framework: AgentFramework;
  readonly version: string;
  readonly tenantId?: TenantId;
  readonly capabilities: readonly AgentCapability[];
  readonly requestedTrustLevel?: AgentTrustLevel; // optional; registration defaults to 'untrusted'
  readonly metadata?: Record<string, unknown>;
  readonly owner: UserId | AgentId;
}
```

### 3.2 RegisteredAgent

```typescript
interface RegisteredAgent {
  readonly id: AgentId;
  readonly name: string;
  readonly framework: AgentFramework;
  readonly version: string;
  readonly tenantId: TenantId | null;
  readonly state: AgentState;
  readonly capabilities: AgentCapabilitySet;
  readonly trustLevel: AgentTrustLevel;
  readonly coreTrustLevel: CoreTrustLevel; // derived via SHARED_TYPES §5
  readonly clearanceLevel: number; // derived via TRUST_TO_CLEARANCE
  readonly owner: UserId | AgentId;
  readonly metadata: Record<string, unknown>;
  readonly statistics: AgentStatistics;
  readonly registeredAt: string;
  readonly lastActiveAt: string | null;
  readonly decommissionedAt: string | null;
  readonly decommissionReason: string | null;
}
```

### 3.3 AgentState

```typescript
type AgentState = 'active' | 'suspended' | 'decommissioned';
// active: fully operational, processing missions and asserting claims
// suspended: temporarily disabled via governance action or manual intervention
// decommissioned: permanently retired, data retained per retention policy
```

### 3.4 AgentUpdate

```typescript
interface AgentUpdate {
  readonly name?: string;
  readonly version?: string;
  readonly metadata?: Record<string, unknown>;
  // Trust and clearance are changed only through promoteAgent/demoteAgent.
}
```

### 3.5 AgentFilter

```typescript
interface AgentFilter {
  readonly state?: AgentState | readonly AgentState[];
  readonly framework?: AgentFramework;
  readonly tenantId?: TenantId;
  readonly trustLevel?: AgentTrustLevel;
  readonly capability?: AgentCapability;
  readonly owner?: UserId | AgentId;
  readonly limit?: number;
  readonly offset?: number;
}
```

### 3.6 AgentStatistics

```typescript
interface AgentStatistics {
  readonly totalSessions: number;
  readonly totalClaimsAsserted: number;
  readonly totalClaimsRetracted: number;
  readonly totalMissionsCompleted: number;
  readonly totalMissionsFailed: number;
  readonly totalGovernanceRefusals: number;
  readonly activeTechniques: number;
  readonly lastSessionDuration: number | null; // milliseconds
  readonly averageSessionDuration: number; // milliseconds
}
```

### 3.7 DecommissionResult

```typescript
interface DecommissionResult {
  readonly agentId: AgentId;
  readonly decommissionedAt: string;
  readonly claimsPreserved: number;
  readonly sessionsTerminated: number;
  readonly knowledgeArchived: boolean;
  readonly consentsRevoked: number;
  readonly capabilitiesRevoked: number;
}
```

## 4. Capability Management Data Models

### 4.1 AgentCapability

See `SHARED_TYPES.md` §6 -- 20-value canonical union type.

Trust level to capability mapping: See `SHARED_TYPES.md` §6.1 (minimum trust level per capability).

### 4.2 AgentCapabilitySet

```typescript
interface AgentCapabilitySet {
  readonly granted: readonly AgentCapability[];
  readonly denied: readonly AgentCapability[];   // explicitly revoked
  readonly pending: readonly AgentCapability[];   // requested, awaiting approval
}
```

### 4.3 CapabilityRequest

```typescript
interface CapabilityRequest {
  readonly capabilities: readonly AgentCapability[];
  readonly justification: string;
  readonly evidence?: readonly string[]; // references to work demonstrating readiness
}
```

### 4.4 CapabilityDecision

```typescript
interface CapabilityDecision {
  readonly requestedCapabilities: readonly AgentCapability[];
  readonly granted: readonly AgentCapability[];
  readonly denied: readonly CapabilityDenial[];
  readonly decidedBy: UserId | 'system';
  readonly decidedAt: string;
}

interface CapabilityDenial {
  readonly capability: AgentCapability;
  readonly reason: string;
}
```

### 4.5 CapabilityHistoryEntry

```typescript
interface CapabilityHistoryEntry {
  readonly capability: AgentCapability;
  readonly action: 'granted' | 'revoked' | 'requested' | 'denied';
  readonly reason: string;
  readonly decidedBy: UserId | 'system';
  readonly timestamp: string;
}
```

## 5. Trust Level & Promotion Data Models

### 5.1 AgentTrustLevel

See `SHARED_TYPES.md` §5 -- 5-level canonical type with clearance mapping.

### 5.2 PromotionRequest

```typescript
interface PromotionRequest {
  readonly targetLevel: AgentTrustLevel;
  readonly justification: string;
  readonly evidence: readonly TrustPromotionEvidence[];
}
```

### 5.3 TrustPromotionEvidence

```typescript
// Named TrustPromotionEvidence to distinguish from Intelligence Bridge's TechniquePromotionEvidence.
interface TrustPromotionEvidence {
  readonly type: TrustPromotionEvidenceType;
  readonly value: number | string;
  readonly description: string;
}

type TrustPromotionEvidenceType =
  | 'session_count'
  | 'mission_success_rate'
  | 'governance_compliance'
  | 'technique_quality'
  | 'human_endorsement';
```

### 5.4 TrustPromotionResult

```typescript
interface TrustPromotionResult {
  readonly agentId: AgentId;
  readonly previousLevel: AgentTrustLevel;
  readonly newLevel: AgentTrustLevel;
  readonly capabilitiesUnlocked: readonly AgentCapability[];
  readonly decidedBy: UserId | 'system';
  readonly decidedAt: string;
}
```

### 5.5 DemotionResult

```typescript
interface DemotionResult {
  readonly agentId: AgentId;
  readonly previousLevel: AgentTrustLevel;
  readonly newLevel: AgentTrustLevel;
  readonly capabilitiesRevoked: readonly AgentCapability[];
  readonly reason: string;
  readonly decidedBy: UserId | 'system';
  readonly decidedAt: string;
}
```

## 6. Consent Governance Data Models

### 6.1 AgentConsentRecord

```typescript
// ConsentPurpose: See SHARED_TYPES §19 (5 values: memory_storage | technique_extraction | knowledge_transfer | analytics | improvement)
// ConsentableOperation: See SHARED_TYPES §19 (6 values)

interface AgentConsentRecord {
  readonly id?: ConsentId;         // assigned on registration
  readonly agentId: AgentId;
  readonly dataSubject: string;    // who the data belongs to
  readonly purpose: ConsentPurpose;
  readonly scope: ConsentScope;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly status: ConsentStatus;
}

type ConsentStatus = 'active' | 'revoked' | 'expired';
```

### 6.2 ConsentScope

```typescript
interface ConsentScope {
  readonly predicateDomains?: readonly string[];    // limit to specific predicate domains
  readonly classificationMax?: ClassificationLevel; // consent only up to this level
  readonly operations?: readonly ConsentableOperation[];
}
```

### 6.3 ConsentDecision

```typescript
interface ConsentDecision {
  readonly allowed: boolean;
  readonly consentId: ConsentId | null;  // which consent record authorizes
  readonly reason: string;
  readonly expiresAt: string | null;
}
```

### 6.4 ConsentRevocationResult

```typescript
interface ConsentRevocationResult {
  readonly consentId: ConsentId;
  readonly revokedAt: string;
  readonly claimsAffected: number;
  readonly transfersBlocked: number;
  readonly cascadeActions: readonly string[];
}
```

## 7. Knowledge Exchange Data Models

### 7.1 KnowledgeExportOptions

```typescript
interface KnowledgeExportOptions {
  readonly domains?: readonly string[];
  readonly minConfidence?: number;
  readonly includeTechniques?: boolean;
  readonly includeRelationships?: boolean;
  readonly format: KnowledgeFormat;
  readonly classification?: ClassificationLevel; // max classification to export
}

type KnowledgeFormat = 'limen_native' | 'json_ld' | 'rdf_turtle';
```

### 7.2 KnowledgePackage

```typescript
interface KnowledgePackage {
  readonly id: KnowledgePackageId;
  readonly sourceAgentId: AgentId;
  readonly exportedAt: string;
  readonly format: KnowledgeFormat;
  readonly claims: readonly ExportedClaim[];
  readonly techniques: readonly ExportedTechnique[];
  readonly relationships: readonly ExportedRelationship[];
  readonly metadata: KnowledgePackageMetadata;
  readonly checksum: string; // SHA-256 of serialized claims+techniques+relationships
}

interface KnowledgePackageMetadata {
  readonly claimCount: number;
  readonly techniqueCount: number;
  readonly relationshipCount: number;
  readonly domains: readonly string[];
  readonly classificationMax: ClassificationLevel;
}
```

### 7.3 ExportedClaim

```typescript
interface ExportedClaim {
  readonly originalId: ClaimId;
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly classification: ClassificationLevel;
  readonly reasoning: string | null;
  readonly createdAt: string;
}
```

### 7.4 ExportedTechnique

```typescript
// TGPTechniqueStatus: See SHARED_TYPES §22 (4-value canonical: 'candidate' | 'active' | 'suspended' | 'retired')

interface ExportedTechnique {
  readonly originalId: ClaimId;
  readonly description: string;
  readonly domain: string;
  readonly status: TGPTechniqueStatus;
  readonly successRate: number;
  readonly evaluationCount: number;
}
```

### 7.5 ExportedRelationship

```typescript
// RelationshipType: See SHARED_TYPES §2 (CCP inherited: 'supports' | 'contradicts' | 'supersedes' | 'derived_from')

interface ExportedRelationship {
  readonly fromClaimOriginalId: ClaimId;
  readonly toClaimOriginalId: ClaimId;
  readonly type: RelationshipType;
}
```

### 7.6 KnowledgeImportOptions

```typescript
interface KnowledgeImportOptions {
  readonly conflictStrategy: ConflictStrategy;
  readonly confidenceCap?: number;        // default 0.5 -- imported knowledge is not authoritative
  readonly classification?: ClassificationLevel; // force classification on imports
  readonly validateIntegrity?: boolean;   // verify checksum, default true
}

type ConflictStrategy = 'skip' | 'override' | 'merge' | 'branch';
// skip: ignore conflicting claims
// override: replace existing with imported
// merge: keep highest-confidence version
// branch: create belief branch for resolution
```

### 7.7 KnowledgeImportResult

```typescript
interface KnowledgeImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly conflicts: number;
  readonly branchCreated: boolean;
  readonly branchId: string | null;
  readonly newClaimIds: readonly ClaimId[];
  readonly duration: number; // milliseconds
}
```

### 7.8 KnowledgeTransferOptions

```typescript
interface KnowledgeTransferOptions {
  readonly domains?: readonly string[];
  readonly includeTechniques?: boolean;
  readonly confidenceCap?: number;    // default 0.5
  readonly consentPurpose?: ConsentPurpose; // default 'knowledge_transfer'
}
```

### 7.9 KnowledgeTransferResult

```typescript
interface KnowledgeTransferResult {
  readonly fromAgentId: AgentId;
  readonly toAgentId: AgentId;
  readonly transferred: number;
  readonly skipped: number;
  readonly conflicts: number;
  readonly newClaimIds: readonly ClaimId[];
  readonly transferredAt: string;
  readonly consentId: ConsentId | null; // consent record that authorized this transfer
}
```

## 8. Lifecycle Events

This contract uses the unified event system defined in `SHARED_TYPES.md` §16. The lifecycle-relevant event types from the canonical `AgentEvent` union are:

- `agent:registered` | `agent:updated` | `agent:suspended` | `agent:reactivated` | `agent:decommissioned`
- `capability:granted` | `capability:revoked`
- `trust:promoted` | `trust:demoted`
- `consent:registered` | `consent:revoked` | `consent:expired`
- `knowledge:exported` | `knowledge:imported` | `knowledge:transferred`

All events use `AgentEventPayload` (§16.2) and flow through the shared `AgentEventBus`.

## 9. Error Types

```typescript
type AgentLifecycleError =
  | { code: 'AGENT_NOT_FOUND'; agentId: AgentId }
  | { code: 'AGENT_ALREADY_EXISTS'; name: string; framework: AgentFramework }
  | { code: 'AGENT_DECOMMISSIONED'; agentId: AgentId }
  | { code: 'AGENT_SUSPENDED'; agentId: AgentId; reason: string }
  | { code: 'CAPABILITY_DENIED'; capability: AgentCapability; reason: string }
  | { code: 'PROMOTION_DENIED'; targetLevel: AgentTrustLevel; reason: string }
  | { code: 'DEMOTION_BELOW_FLOOR'; agentId: AgentId; currentLevel: AgentTrustLevel }
  | { code: 'CONSENT_REQUIRED'; operation: ConsentableOperation; dataSubject: string }
  | { code: 'CONSENT_EXPIRED'; consentId: ConsentId; expiredAt: string }
  | { code: 'CONSENT_NOT_FOUND'; consentId: ConsentId }
  | { code: 'TRANSFER_DENIED'; reason: string; fromAgent: AgentId; toAgent: AgentId }
  | { code: 'IMPORT_INTEGRITY_FAILED'; expectedChecksum: string; actualChecksum: string }
  | { code: 'CLASSIFICATION_EXCEEDED'; agentLevel: ClassificationLevel; dataLevel: ClassificationLevel }
  | { code: 'TRUST_LEVEL_INSUFFICIENT'; required: AgentTrustLevel; actual: AgentTrustLevel }
  | { code: 'GOVERNANCE_REFUSAL'; reason: string; action: string }
  | { code: 'INVALID_STATE_TRANSITION'; from: AgentState; to: AgentState };
```

## 10. Agent Lifecycle State Machine

```
                              register
    +--------------+  ------------------>  +--------+
    | UNREGISTERED |                       | ACTIVE |
    +--------------+                       +---+--+-+
                                               |  ^
                              suspend          |  |  reactivate
                              (governance /    |  |  (review complete,
                               manual /        |  |   issue resolved)
                               security)       |  |
                                               v  |
                                          +----------+
                                          |SUSPENDED |
                                          +----+-----+
                                               |
                                               | decommission
                              decommission     | (from suspended)
                              (from active)    |
                                    |          |
                                    v          v
                              +--------------------+
                              |  DECOMMISSIONED    |  (terminal)
                              +--------------------+
```

**Transition Rules:**

| From | To | Trigger | Requirements |
|---|---|---|---|
| unregistered | active | registerAgent() | valid spec, unique name+framework pair |
| active | suspended | governance violation, manual action, security event | reason required, audit entry |
| suspended | active | reactivate (via updateAgent with state restoration) | review evidence, actor authority |
| active | decommissioned | decommissionAgent() | reason required, cascade cleanup |
| suspended | decommissioned | decommissionAgent() | reason required, cascade cleanup |
| decommissioned | any | FORBIDDEN | terminal state, no recovery |

## 11. Trust Level Capability Mapping

See `SHARED_TYPES.md` §5.1 for the canonical capability-unlocking table and §5.2 for promotion requirements.

This contract does not define independent promotion thresholds. It implements the canonical §5.2 requirements exactly:

| Trust Level | Capabilities Unlocked | Promotion Criteria |
|---|---|---|
| untrusted | See SHARED_TYPES §5.1 | Default on registration |
| low | See SHARED_TYPES §5.1 | Registration complete, adapter connected |
| medium | See SHARED_TYPES §5.1 | 10+ successful operations, 0 governance refusals in last 24h |
| high | See SHARED_TYPES §5.1 | 100+ successful operations, human approval OR senior agent endorsement |
| verified | See SHARED_TYPES §5.1 | Human approval required, Core admin transition record required |

**Confidence Caps by Trust Level:**

| Trust Level | Max Assertable Confidence |
|---|---|
| untrusted | N/A (cannot assert) |
| low | 0.3 |
| medium | 0.7 |
| high | 0.85 |
| verified | 1.0 |

## 12. Rust Trait (v5 Alignment)

```rust
use std::future::Future;

// Branded IDs: See SHARED_TYPES §25 (AgentId, TenantId, UserId, SessionId, EventId, etc.)
// AgentTrustLevel: See SHARED_TYPES §25
// AgentCapability: See SHARED_TYPES §25
// ClassificationLevel: See SHARED_TYPES §25

/// Agent lifecycle states (contract-local)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentState {
    Active,
    Suspended,
    Decommissioned,
}

/// Trust promotion evidence (named to avoid collision with TGP's technique promotion)
pub struct TrustPromotionEvidence {
    pub evidence_type: String,
    pub value: String,
    pub description: String,
}

/// Registration specification
pub struct AgentRegistrationSpec {
    pub name: String,
    pub framework: AgentFramework,
    pub version: String,
    pub tenant_id: Option<TenantId>,
    pub capabilities: Vec<AgentCapability>,
    pub requested_trust_level: Option<AgentTrustLevel>,
    pub metadata: Option<serde_json::Value>,
    pub owner: String, // UserId or AgentId serialized
}

/// Update specification
pub struct AgentUpdate {
    pub name: Option<String>,
    pub version: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Capability request
pub struct CapabilityRequest {
    pub capabilities: Vec<AgentCapability>,
    pub justification: String,
    pub evidence: Vec<String>,
}

/// Trust promotion request
pub struct PromotionRequest {
    pub target_level: AgentTrustLevel,
    pub justification: String,
    pub evidence: Vec<TrustPromotionEvidence>,
}

/// Knowledge export options
pub struct KnowledgeExportOptions {
    pub domains: Option<Vec<String>>,
    pub min_confidence: Option<f64>,
    pub include_techniques: bool,
    pub include_relationships: bool,
    pub format: KnowledgeFormat,
    pub classification: Option<ClassificationLevel>,
}

/// Knowledge import options
pub struct KnowledgeImportOptions {
    pub conflict_strategy: String, // "skip" | "override" | "merge" | "branch"
    pub confidence_cap: Option<f64>,
    pub classification: Option<ClassificationLevel>,
    pub validate_integrity: bool,
}

/// Knowledge formats (contract-local)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KnowledgeFormat {
    LimenNative,
    JsonLd,
    RdfTurtle,
}

/// Consent status (contract-local)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConsentStatus {
    Active,
    Revoked,
    Expired,
}

/// Result types
pub struct RegisteredAgent {
    pub id: AgentId,
    pub name: String,
    pub framework: AgentFramework,
    pub version: String,
    pub tenant_id: Option<TenantId>,
    pub state: AgentState,
    pub trust_level: AgentTrustLevel,
    pub core_trust_level: String,
    pub clearance_level: u8,
    pub owner: String,
    pub registered_at: String,
    pub last_active_at: Option<String>,
    pub decommissioned_at: Option<String>,
    pub decommission_reason: Option<String>,
}

pub struct DecommissionResult {
    pub agent_id: AgentId,
    pub decommissioned_at: String,
    pub claims_preserved: u64,
    pub sessions_terminated: u64,
    pub knowledge_archived: bool,
    pub consents_revoked: u64,
    pub capabilities_revoked: u64,
}

pub struct CapabilityDecision {
    pub requested: Vec<AgentCapability>,
    pub granted: Vec<AgentCapability>,
    pub denied: Vec<(AgentCapability, String)>,
    pub decided_by: String,
    pub decided_at: String,
}

pub struct TrustPromotionResult {
    pub agent_id: AgentId,
    pub previous_level: AgentTrustLevel,
    pub new_level: AgentTrustLevel,
    pub capabilities_unlocked: Vec<AgentCapability>,
    pub decided_by: String,
    pub decided_at: String,
}

pub struct DemotionResult {
    pub agent_id: AgentId,
    pub previous_level: AgentTrustLevel,
    pub new_level: AgentTrustLevel,
    pub capabilities_revoked: Vec<AgentCapability>,
    pub reason: String,
    pub decided_by: String,
    pub decided_at: String,
}

pub struct ConsentDecision {
    pub allowed: bool,
    pub consent_id: Option<String>,
    pub reason: String,
    pub expires_at: Option<String>,
}

pub struct KnowledgePackage {
    pub id: String,
    pub source_agent_id: AgentId,
    pub exported_at: String,
    pub format: KnowledgeFormat,
    pub checksum: String,
    pub claim_count: u64,
    pub technique_count: u64,
    pub relationship_count: u64,
}

pub struct KnowledgeImportResult {
    pub imported: u64,
    pub skipped: u64,
    pub conflicts: u64,
    pub branch_created: bool,
    pub branch_id: Option<String>,
    pub new_claim_ids: Vec<ClaimId>,
    pub duration_ms: u64,
}

/// Lifecycle errors
#[derive(Debug, Clone)]
pub enum LifecycleError {
    AgentNotFound { agent_id: String },
    AgentAlreadyExists { name: String, framework: AgentFramework },
    AgentDecommissioned { agent_id: String },
    AgentSuspended { agent_id: String, reason: String },
    CapabilityDenied { capability: AgentCapability, reason: String },
    PromotionDenied { target_level: AgentTrustLevel, reason: String },
    DemotionBelowFloor { agent_id: String, current_level: AgentTrustLevel },
    ConsentRequired { operation: String, data_subject: String },
    ConsentExpired { consent_id: String, expired_at: String },
    ConsentNotFound { consent_id: String },
    TransferDenied { reason: String, from_agent: String, to_agent: String },
    ImportIntegrityFailed { expected: String, actual: String },
    ClassificationExceeded { agent_level: ClassificationLevel, data_level: ClassificationLevel },
    TrustLevelInsufficient { required: AgentTrustLevel, actual: AgentTrustLevel },
    GovernanceRefusal { reason: String, action: String },
    InvalidStateTransition { from: AgentState, to: AgentState },
}

/// The core trait
pub trait AgentLifecycleManager: Send + Sync {
    fn register_agent(
        &self,
        spec: &AgentRegistrationSpec,
    ) -> impl Future<Output = Result<RegisteredAgent, LifecycleError>> + Send;

    fn get_agent(
        &self,
        agent_id: &str,
    ) -> impl Future<Output = Result<RegisteredAgent, LifecycleError>> + Send;

    fn update_agent(
        &self,
        agent_id: &str,
        update: &AgentUpdate,
    ) -> impl Future<Output = Result<RegisteredAgent, LifecycleError>> + Send;

    fn decommission_agent(
        &self,
        agent_id: &str,
        reason: &str,
    ) -> impl Future<Output = Result<DecommissionResult, LifecycleError>> + Send;

    fn request_capability(
        &self,
        agent_id: &str,
        request: &CapabilityRequest,
    ) -> impl Future<Output = Result<CapabilityDecision, LifecycleError>> + Send;

    fn revoke_capability(
        &self,
        agent_id: &str,
        capability: &AgentCapability,
        reason: &str,
    ) -> impl Future<Output = Result<(), LifecycleError>> + Send;

    fn promote_agent(
        &self,
        agent_id: &str,
        request: &PromotionRequest,
    ) -> impl Future<Output = Result<TrustPromotionResult, LifecycleError>> + Send;

    fn demote_agent(
        &self,
        agent_id: &str,
        reason: &str,
    ) -> impl Future<Output = Result<DemotionResult, LifecycleError>> + Send;

    fn check_consent(
        &self,
        agent_id: &str,
        operation: &str,
    ) -> impl Future<Output = Result<ConsentDecision, LifecycleError>> + Send;

    fn export_knowledge(
        &self,
        agent_id: &str,
        options: &KnowledgeExportOptions,
    ) -> impl Future<Output = Result<KnowledgePackage, LifecycleError>> + Send;

    fn import_knowledge(
        &self,
        agent_id: &str,
        package: &KnowledgePackage,
        options: Option<&KnowledgeImportOptions>,
    ) -> impl Future<Output = Result<KnowledgeImportResult, LifecycleError>> + Send;
}
```

## 13. Invariants

1. **Identity Immutability** -- AgentId never changes after registration. Name+framework pair is unique within a tenant.
2. **Terminal Decommission** -- No recovery path from decommissioned state. Any attempt returns INVALID_STATE_TRANSITION.
3. **Capability-Trust Ceiling** -- Capabilities can only be granted at or below the agent's current trust level mapping (see `SHARED_TYPES.md` §6.1). Granting above requires promotion first.
4. **Evidence-Based Promotion** -- Trust level changes require evidence meeting the canonical criteria in `SHARED_TYPES.md` §5.2. No arbitrary promotion without meeting those requirements.
5. **Consent-Before-Storage** -- Storing personal data without active consent returns CONSENT_REQUIRED. Violated operations are logged as governance refusals.
6. **Import Confidence Cap** -- Knowledge import caps confidence at 0.5 by default. Imported knowledge is never authoritative without local validation.
7. **Classification Boundary** -- Cannot export claims above agent's clearance level. Cannot import at classification above agent's clearance. Returns CLASSIFICATION_EXCEEDED.
8. **Decommission Preservation** -- Decommissioned agent's claims remain in the system with full provenance. They are not deleted, only marked as sourced from a decommissioned agent.
9. **Immediate Revocation** -- Capability revocation takes effect immediately. In-flight operations requiring the revoked capability are terminated with CAPABILITY_DENIED.
10. **Consent Expiry Enforcement** -- Expired consent blocks new operations automatically. A background sweep marks expired consents; runtime checks enforce at operation time.
11. **Derived Statistics** -- AgentStatistics are computed from the audit trail on read. No separate counter storage that could drift from truth.
12. **Universal Audit** -- All lifecycle state changes produce an audit entry containing: actor (who), action (what), target (whom), timestamp (when), reason (why), and outcome (result).

## 14. Behavioral Contracts

### 14.1 Registration

- Agent name must be 1-64 characters, alphanumeric + hyphens + underscores only.
- Framework must be a recognized value from `AgentFramework` (see `SHARED_TYPES.md` §21).
- Initial capabilities are intersected with trust level 'untrusted' mapping -- only memory_read and context_management survive (see `SHARED_TYPES.md` §5.1).
- Registration emits `agent:registered` event via unified `AgentEventBus`.

### 14.2 Suspension

- Suspension preserves all agent data but blocks all operations except getAgent().
- Suspended agents cannot assert claims, execute missions, or participate in transfers.
- Suspension emits `agent:suspended` event with reason.

### 14.3 Decommission Cascade

On decommission, the following cascade executes atomically:
1. State set to 'decommissioned'
2. All active sessions terminated
3. All active consents revoked (emitting `consent:revoked` for each)
4. All capabilities revoked
5. Knowledge archive created (if agent has claims)
6. Agent removed from active agent lists (still queryable with state filter)
7. `agent:decommissioned` event emitted

### 14.4 Knowledge Transfer Protocol

1. Verify source agent is active and has 'knowledge_export' capability
2. Verify target agent is active and has 'knowledge_import' capability
3. Verify active consent exists for 'transfer_knowledge' operation (see `SHARED_TYPES.md` §19). This step is mandatory and cannot be disabled by caller options.
4. Export from source with classification filter (source agent's clearance)
5. Apply target agent's classification filter (cannot exceed target's clearance)
6. Apply confidence cap (default 0.5)
7. Import into target with specified conflict strategy
8. Emit `knowledge:exported` for source, `knowledge:imported` for target, `knowledge:transferred` for both
9. Return transfer result with full accounting

### 14.5 Consent Check Flow

```
checkConsent(agentId, operation)
  -> find all active consents for agentId
  -> filter by operation match (scope.operations includes operation)
  -> filter by non-expired (expiresAt null OR expiresAt > now)
  -> if any match: return { allowed: true, consentId, reason, expiresAt }
  -> if none match: return { allowed: false, consentId: null, reason: "no active consent", expiresAt: null }
```

## 15. Integration Points

| System | Integration | Direction |
|---|---|---|
| Claim Engine | Agent assertions routed through capability + consent checks | Inbound |
| Working Memory | Read/write gated by trust level capabilities | Inbound |
| Mission Manager | Mission creation/delegation requires high+ trust | Inbound |
| Audit System | All lifecycle events written as audit entries | Outbound |
| Consent API | Agent consent records stored in existing consent infrastructure | Bidirectional |
| Export/Import | Knowledge packages use existing LimenExportDocument format internally | Bidirectional |
| Event Bus | Lifecycle events published via unified AgentEventBus (SHARED_TYPES §16) | Outbound |
| Adapter Architecture | Adapter binding requires prior agent registration (this contract) | Outbound |

## 16. Migration Path

For existing agents (registered via the thin registration API):
1. All existing agents receive state: 'active', trustLevel: 'medium' (grandfather -- they have operational history)
2. Capabilities inferred from actual usage patterns in audit trail
3. No consent records exist -- personal-data, restricted, critical, export, and transfer operations are blocked with CONSENT_REQUIRED until explicit consent is registered. Non-consentable operations may continue.
4. Statistics computed retroactively from audit trail on first access
5. Migration is idempotent -- running it twice produces identical results

---

**Contract Hash:** Pending computation on ratification
**Ratified:** Pending
**Signatories:** Pending
