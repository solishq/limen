# Phase X Shared Types Registry v1.2.0

**Status:** RATIFIED --- Canonical Authority for All Phase X Contracts
**Governing:** CDM v2.1 + Contract Compliance v2.1
**Rule:** Types defined here are the SOLE definitions. All 8 Phase X contracts reference this document. No contract may redefine any shared type listed here. Local types are contract-specific and not used by other contracts.
**Phase 8 Gate:** Machine-readable status, HB-37/HB-38 coverage, LCI assertion, and monotonicity proof are recorded in `contracts/phase-x.contracts.json`.

---

## 1. Limen Core Types (Inherited --- Not Modified)

These are Limen Core types that Phase X contracts reference. They are NOT Phase X types and are NOT modifiable by Phase X contracts.

### 1.1 Branded IDs

```typescript
export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type AgentId = string & { readonly __brand: 'AgentId' };
export type MissionId = string & { readonly __brand: 'MissionId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type EventId = string & { readonly __brand: 'EventId' };
export type ArtifactId = string & { readonly __brand: 'ArtifactId' };
export type PolicyId = string & { readonly __brand: 'PolicyId' };
export type RoleId = string & { readonly __brand: 'RoleId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ClaimId = string & { readonly __brand: 'ClaimId' };
export type RelationshipId = string & { readonly __brand: 'RelationshipId' };
export type ReservationId = string & { readonly __brand: 'ReservationId' };
export type WaveId = string & { readonly __brand: 'WaveId' };
export type EvaluationId = string & { readonly __brand: 'EvaluationId' };
export type PromotionDecisionId = string & { readonly __brand: 'PromotionDecisionId' };
```

### 1.2 Permission (31 values)

```typescript
export type Permission =
  | 'create_agent' | 'modify_agent' | 'delete_agent'
  | 'chat' | 'infer'
  | 'create_mission'
  | 'view_telemetry' | 'view_audit'
  | 'manage_providers' | 'manage_budgets' | 'manage_roles'
  | 'purge_data'
  | 'approve_response' | 'edit_response' | 'takeover_session' | 'review_batch'
  | 'classify_claims' | 'manage_classification_rules'
  | 'manage_protected_predicates'
  | 'request_erasure' | 'export_compliance'
  | 'assert_claim' | 'retract_claim' | 'query_claims' | 'relate_claims'
  | 'write_wm' | 'read_wm'
  | 'manage_consent' | 'view_consent'
  | 'manage_cognitive'
  | 'manage_agents';
```

### 1.3 OperationContext

```typescript
export interface OperationContext {
  readonly tenantId: TenantId | null;
  readonly userId: UserId | null;
  readonly agentId: AgentId | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly sessionId?: SessionId;
  readonly clearanceLevel?: number;
  // Mapping: untrusted=0 (unrestricted only), probationary=1 (internal),
  //          trusted=2 (confidential), admin=4 (all levels)
}
```

### 1.4 KernelError

```typescript
export interface KernelError {
  readonly code: string;
  readonly message: string;
  readonly spec: string;
  readonly violations?: readonly LimenViolation[];
}
```

### 1.5 Result

```typescript
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KernelError };
```

---

## 2. CCP Types (Inherited --- Not Modified)

Types from the Claims/CCP module referenced by Phase X contracts.

```typescript
export type ObjectType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export type ClaimStatus = 'active' | 'retracted';
export type GroundingMode = 'evidence_path' | 'runtime_witness';
export type FreshnessLabel = 'fresh' | 'aging' | 'stale';
export type ArchiveMode = 'exclude' | 'include' | 'only';
export type EvidenceType = 'memory' | 'artifact' | 'claim' | 'capability_result';
export type RelationshipType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from';
```

---

## 3. Classification Types (Inherited --- Not Modified)

```typescript
export type ClassificationLevel = 'unrestricted' | 'internal' | 'confidential' | 'restricted' | 'critical';

// Numeric mapping (used in clearanceLevel comparisons):
// unrestricted = 0
// internal     = 1
// confidential = 2
// restricted   = 3
// critical     = 4

export const CLASSIFICATION_NUMERIC: Record<ClassificationLevel, number> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
};
```

---

## 4. Phase X Branded Types (New)

Types introduced by Phase X that do not exist in Limen Core.

```typescript
export type AgentBranchId = string & { readonly __brand: 'AgentBranchId' };
export type AdapterId = string & { readonly __brand: 'AdapterId' };
export type ConsentId = string & { readonly __brand: 'ConsentId' };
export type AuditEntryId = string & { readonly __brand: 'AuditEntryId' };
export type TriggerConfigId = string & { readonly __brand: 'TriggerConfigId' };
export type KnowledgePackageId = string & { readonly __brand: 'KnowledgePackageId' };
```

---

## 5. Trust and Clearance Model (UNIFIED)

Limen Core persists the 4-level agent trust state machine `untrusted -> probationary -> trusted -> admin`.
Phase X exposes the required 5-level agent capability model `untrusted -> low -> medium -> high -> verified`.
The fifth level is a Phase X session-governance overlay: `high` maps to Core persisted trust `trusted` but uses clearance 3 for restricted data; `verified` maps to Core `admin` and requires the existing human-grant path.

```typescript
export type CoreTrustLevel = 'untrusted' | 'probationary' | 'trusted' | 'admin';

export type AgentTrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'verified';

// Mapping to Core clearanceLevel:
// untrusted -> 0 (unrestricted only)
// low       -> 1 (internal and below)
// medium    -> 2 (confidential and below)
// high      -> 3 (restricted and below)
// verified  -> 4 (all levels, equivalent to Core admin)

export const TRUST_TO_CLEARANCE: Record<AgentTrustLevel, number> = {
  untrusted: 0,
  low: 1,
  medium: 2,
  high: 3,
  verified: 4,
};

export const PHASE_X_TO_CORE_TRUST: Record<AgentTrustLevel, CoreTrustLevel> = {
  untrusted: 'untrusted',
  low: 'probationary',
  medium: 'trusted',
  high: 'trusted',
  verified: 'admin',
};
```

### 5.1 Capability Unlocking by Trust Level

| Trust Level | Clearance | Accessible Classifications | Capabilities Unlocked |
|---|---|---|---|
| untrusted | 0 | unrestricted | memory_read, context_management |
| low | 1 | unrestricted, internal | + memory_write, belief_management |
| medium | 2 | unrestricted, internal, confidential | + branching, technique_learning, mission_creation, file_access, api_calls |
| high | 3 | unrestricted, internal, confidential, restricted | + computer_use, browser_use, terminal_use, code_execution, network_access, multi_agent, technique_transfer, mission_delegation, knowledge_export, knowledge_import |
| verified | 4 | all levels | + process spawn/kill (via computer_use), governance_admin |

### 5.2 Promotion Requirements

| From | To | Requirements |
|---|---|---|
| untrusted | low | Registration complete, adapter connected |
| low | medium | 10+ successful operations, 0 governance refusals in last 24h |
| medium | high | 100+ successful operations, human approval OR senior agent endorsement |
| high | verified | Human approval required, Core admin transition record required |

**Validation rules:** Trust promotions are monotonic and single-step. `verified` cannot be self-granted; it MUST use the Core `admin` human transition gate. `high` MUST NOT be written to `core_agents.trust_level`; it is represented by `AgentSession.trustLevel = 'high'`, `PHASE_X_TO_CORE_TRUST.high = 'trusted'`, and `clearanceLevel = 3`.

**Example:** A high-trust session stores `trustLevel: 'high'`, passes `clearanceLevel: 3` to `OperationContext`, and leaves the persisted Core trust row at `trusted`.

---

## 6. AgentCapability (UNIFIED --- 20 values)

```typescript
export type AgentCapability =
  | 'memory_read' | 'memory_write' | 'belief_management' | 'branching'
  | 'technique_learning' | 'technique_transfer'
  | 'mission_creation' | 'mission_delegation'
  | 'computer_use' | 'browser_use' | 'terminal_use'
  | 'file_access' | 'code_execution' | 'api_calls' | 'network_access'
  | 'multi_agent' | 'knowledge_export' | 'knowledge_import'
  | 'context_management' | 'governance_admin';
```

### 6.1 Minimum Trust Level per Capability

| Capability | Minimum Trust Level |
|---|---|
| memory_read | untrusted |
| context_management | untrusted |
| memory_write | low |
| belief_management | low |
| branching | medium |
| technique_learning | medium |
| mission_creation | medium |
| file_access | medium |
| api_calls | medium |
| computer_use | high |
| browser_use | high |
| terminal_use | high |
| code_execution | high |
| network_access | high |
| multi_agent | high |
| technique_transfer | high |
| mission_delegation | high |
| knowledge_export | high |
| knowledge_import | high |
| governance_admin | verified |

---

## 7. AgentSession (UNIFIED)

Single canonical definition used by ALL contracts.

```typescript
export interface AgentSession {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly adapterId: AdapterId;
  readonly trustLevel: AgentTrustLevel;
  readonly coreTrustLevel: CoreTrustLevel; // derived from trustLevel via PHASE_X_TO_CORE_TRUST
  readonly clearanceLevel: number; // derived from trustLevel via TRUST_TO_CLEARANCE
  readonly capabilities: ReadonlySet<AgentCapability>;
  readonly startedAt: string; // ISO-8601
  readonly workingMemoryNamespace: string;
  readonly activeMissions: readonly MissionId[];
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

**Validation rules:** `clearanceLevel` MUST equal `TRUST_TO_CLEARANCE[trustLevel]`. `coreTrustLevel` MUST equal `PHASE_X_TO_CORE_TRUST[trustLevel]`. `capabilities` MUST be the intersection of requested capabilities and the trust unlock table in §5.1.

---

## 8. AgentSession to OperationContext Mapping

Defines EXACTLY how AgentSession converts to OperationContext for Limen Core calls.

```typescript
export function sessionToContext(session: AgentSession): OperationContext {
  return {
    tenantId: session.tenantId,
    userId: null, // agents are not users
    agentId: session.agentId,
    permissions: derivePermissions(session.capabilities),
    sessionId: session.sessionId,
    clearanceLevel: session.clearanceLevel,
  };
}
```

### 8.1 Complete derivePermissions Mapping

```typescript
export function derivePermissions(capabilities: ReadonlySet<AgentCapability>): ReadonlySet<Permission> {
  const permissions = new Set<Permission>();

  const CAPABILITY_TO_PERMISSIONS: Record<AgentCapability, readonly Permission[]> = {
    memory_read: ['query_claims', 'read_wm'],
    memory_write: ['assert_claim', 'retract_claim', 'relate_claims', 'write_wm'],
    belief_management: ['query_claims', 'relate_claims'],
    branching: ['assert_claim', 'retract_claim', 'query_claims', 'relate_claims'],
    technique_learning: ['query_claims', 'assert_claim'],
    technique_transfer: ['query_claims', 'assert_claim', 'relate_claims'],
    mission_creation: ['create_mission'],
    mission_delegation: ['create_mission', 'create_agent'],
    computer_use: ['view_telemetry'],
    browser_use: ['view_telemetry'],
    terminal_use: ['view_telemetry'],
    file_access: ['view_telemetry'],
    code_execution: ['view_telemetry'],
    api_calls: ['view_telemetry'],
    network_access: ['view_telemetry'],
    multi_agent: ['create_agent', 'modify_agent'],
    knowledge_export: ['query_claims', 'export_compliance'],
    knowledge_import: ['assert_claim', 'relate_claims'],
    context_management: ['read_wm', 'write_wm'],
    governance_admin: [
      'classify_claims', 'manage_classification_rules',
      'manage_protected_predicates', 'manage_agents',
      'manage_roles', 'manage_consent', 'view_consent',
      'manage_cognitive', 'view_audit', 'purge_data',
    ],
  };

  for (const capability of capabilities) {
    for (const permission of CAPABILITY_TO_PERMISSIONS[capability]) {
      permissions.add(permission);
    }
  }

  return permissions as ReadonlySet<Permission>;
}
```

---

## 9. GovernanceContext (UNIFIED)

```typescript
export interface GovernanceContext {
  readonly operationContext: OperationContext;
  readonly session: AgentSession;
  readonly action: GovernanceAction;
  readonly resource: string | null;
  readonly policyIds: readonly PolicyId[];
  readonly actionHistory: readonly ActionDigest[];
}

export type GovernanceAction =
  | { readonly domain: 'memory'; readonly operation: 'write' | 'read' | 'delete' | 'branch' | 'merge' }
  | { readonly domain: 'computer'; readonly operation: ComputerActionType }
  | { readonly domain: 'execution'; readonly operation: 'create_mission' | 'delegate' | 'cancel' | 'retry' }
  | { readonly domain: 'lifecycle'; readonly operation: 'register' | 'promote' | 'demote' | 'suspend' | 'decommission' }
  | { readonly domain: 'knowledge'; readonly operation: 'export' | 'import' | 'transfer' }
  | { readonly domain: 'consent'; readonly operation: 'register' | 'revoke' | 'check' }
  | { readonly domain: 'context'; readonly operation: 'write_wm' | 'discard_wm' | 'pin' | 'unpin' | 'evict' };

export type ComputerActionType =
  | 'file:read' | 'file:write' | 'file:delete'
  | 'directory:list'
  | 'terminal:execute'
  | 'browser:navigate' | 'browser:click' | 'browser:input' | 'browser:extract'
  | 'api:call'
  | 'code:execute'
  | 'process:spawn' | 'process:kill'
  | 'network:connect'
  | 'clipboard:access'
  | 'screenshot:capture'
  | 'database:query';
```

---

## 10. GovernanceVerdict (UNIFIED)

```typescript
export type GovernanceVerdict =
  | { readonly verdict: 'allow'; readonly auditId: EventId; readonly conditions?: readonly string[] }
  | { readonly verdict: 'refuse'; readonly auditId: EventId; readonly reason: string; readonly rule: string; readonly alternatives?: readonly string[] }
  | { readonly verdict: 'escalate'; readonly auditId: EventId; readonly reason: string; readonly requiredApproval: 'human' | 'senior_agent' }
  | { readonly verdict: 'sandbox'; readonly auditId: EventId; readonly config: SandboxConfig };
```

### 10.1 GovernanceDecision (UNIFIED)

Canonical governance decision record for memory, computer use, execution, context, and lifecycle gates.

```typescript
export interface GovernanceDecision {
  readonly allowed: boolean;
  readonly verdict: GovernanceVerdict;
  readonly reason: string | null;
  readonly requiredPermissions: readonly Permission[];
  readonly missingPermissions: readonly Permission[];
  readonly clearanceRequired: number | null;
  readonly clearanceActual: number | null;
  readonly evaluatedAt: string; // ISO-8601
}
```

**Validation rules:** `allowed` MUST be true only when `verdict.verdict === 'allow'`. Rejections MUST include at least one of `reason`, `missingPermissions`, or `clearanceRequired`. The `evaluatedAt` value MUST come from the injected time provider.

**Example:** A memory write without `assert_claim` returns `allowed: false`, `missingPermissions: ['assert_claim']`, and a refusal verdict.

---

## 10.2 Canonical Memory and Belief Records

These are cross-contract records used by Memory Bridge, Audit Visualization, Context Governance, and Intelligence Bridge.

```typescript
export interface AgentMemoryEntry {
  readonly id: ClaimId;
  readonly content: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly effectiveConfidence: number;
  readonly freshness: FreshnessLabel;
  readonly classification: ClassificationLevel;
  readonly tags: readonly string[];
  readonly category: string | null;
  readonly sourceAgentId: AgentId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly groundingMode: GroundingMode;
  readonly createdAt: string; // ISO-8601
}

export interface EvidenceRef {
  readonly type: EvidenceType;
  readonly id: string;
  readonly description?: string;
}

export interface RelationshipRef {
  readonly id: RelationshipId;
  readonly type: RelationshipType;
  readonly targetId: ClaimId;
}

export interface BeliefState {
  readonly belief: AgentMemoryEntry;
  readonly evidence: readonly EvidenceRef[];
  readonly relationships: readonly RelationshipRef[];
  readonly status: ClaimStatus;
  readonly retentionPolicy: RetentionPolicy | null;
  readonly governance: GovernanceDecision | null;
}

export type AgentBeliefState = BeliefState;
```

**Validation rules:** `confidence` and `effectiveConfidence` are closed interval [0, 1]. `effectiveConfidence` MUST NOT exceed `confidence`. `classification` MUST be readable by the caller's `OperationContext.clearanceLevel`. `sourceAgentId` is mandatory for all Phase X writes.

**Example:** A recalled claim with expired decay keeps `confidence: 0.8` but may return `effectiveConfidence: 0.42` and `freshness: 'stale'`.

### 10.2.1 Agent Memory Request Types (CANONICAL)

These request DTOs are shared because adapters construct them and Memory Bridge consumes them. They are owned here to preserve LCI type closure.

```typescript
export interface StructuredContent {
  readonly subject: string;
  readonly predicate: string;
  readonly value: unknown;
  readonly objectType?: ObjectType;
}

export interface AgentMemoryOptions {
  readonly confidence?: number;
  readonly reasoning?: string;
  readonly classification?: ClassificationLevel;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly groundingMode?: GroundingMode;
  readonly retentionDays?: number;
}

export interface AgentRecallQuery {
  readonly text?: string;
  readonly subject?: string;
  readonly predicate?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly freshnessFilter?: FreshnessLabel | readonly FreshnessLabel[];
  readonly minConfidence?: number;
  readonly timeRange?: { readonly from: string; readonly to: string };
  readonly classification?: ClassificationLevel;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly sourceAgentId?: AgentId;
  readonly includeSuperseded?: boolean;
  readonly branchId?: AgentBranchId;
}

export interface AgentRecallOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly includeEvidence?: boolean;
  readonly includeRelationships?: boolean;
  readonly searchMode?: 'text' | 'semantic' | 'hybrid';
  readonly archiveMode?: ArchiveMode;
  readonly sortBy?: 'relevance' | 'confidence' | 'recency';
}
```

**Validation rules:** `AgentMemoryOptions.confidence` is a requested confidence only; Memory Bridge still enforces confidence ceilings before persistence. `AgentRecallOptions.limit` and `offset` are non-negative integers when present. `AgentRecallQuery.classification` is a maximum requested classification, not authority; read authority derives only from `OperationContext.clearanceLevel`.

---

## 10.3 AuditLogEntry (UNIFIED)

```typescript
export interface AuditLogEntry {
  readonly id: EventId;
  readonly timestamp: string; // ISO-8601
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly event: AgentEvent;
  readonly action: GovernanceAction | null;
  readonly governanceDecision: GovernanceDecision | null;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previousHash: string;
  readonly currentHash: string;
  readonly classification: ClassificationLevel;
}

export type AgentAuditEntry = AuditLogEntry;
```

**Validation rules:** Audit entries are append-only. `previousHash` MUST match the prior retained entry for the same audit chain. `currentHash` MUST hash the canonical serialized entry excluding `currentHash`. Tombstones may redact `details` but MUST preserve identity, hash chain linkage, event type, timestamp, and classification.

**Example:** A refused terminal action emits `event: 'action:refused'`, a refusal `governanceDecision`, and `classification` inherited from the target resource.

**Escalation terminal mapping:** A non-executed escalation terminal audit entry emits `event: 'governance:escalated'`, an escalation `governanceDecision`, and the same action/risk metadata shape used by refused terminal actions. No `action:escalated` event exists; escalation terminal actions are represented canonically by `governance:escalated`.

---

## 11. ComputerAction (UNIFIED --- 17 variants)

### 11.1 ActionBase

```typescript
export interface ActionBase {
  readonly type: ComputerActionType;
  readonly timestamp: string; // ISO-8601
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly missionId: MissionId | null;
  readonly taskId: TaskId | null;
  readonly requestId: EventId;
}
```

### 11.2 Action Variants

```typescript
export interface FileReadAction extends ActionBase {
  readonly type: 'file:read';
  readonly path: string;
  readonly encoding?: string;
}

export interface FileWriteAction extends ActionBase {
  readonly type: 'file:write';
  readonly path: string;
  readonly content: string;
  readonly encoding?: string;
  readonly createDirectories?: boolean;
}

export interface FileDeleteAction extends ActionBase {
  readonly type: 'file:delete';
  readonly path: string;
  readonly recursive?: boolean;
}

export interface DirectoryListAction extends ActionBase {
  readonly type: 'directory:list';
  readonly path: string;
  readonly recursive?: boolean;
  readonly pattern?: string;
}

export interface TerminalExecuteAction extends ActionBase {
  readonly type: 'terminal:execute';
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface BrowserNavigateAction extends ActionBase {
  readonly type: 'browser:navigate';
  readonly url: string;
  readonly waitFor?: string;
  readonly timeoutMs?: number;
}

export interface BrowserClickAction extends ActionBase {
  readonly type: 'browser:click';
  readonly selector: string;
  readonly button?: 'left' | 'right' | 'middle';
  readonly doubleClick?: boolean;
}

export interface BrowserInputAction extends ActionBase {
  readonly type: 'browser:input';
  readonly selector: string;
  readonly value: string;
  readonly clearFirst?: boolean;
}

export interface BrowserExtractAction extends ActionBase {
  readonly type: 'browser:extract';
  readonly selector: string;
  readonly attribute?: string;
  readonly multiple?: boolean;
}

export interface ApiCallAction extends ActionBase {
  readonly type: 'api:call';
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface CodeExecuteAction extends ActionBase {
  readonly type: 'code:execute';
  readonly language: string;
  readonly code: string;
  readonly timeoutMs?: number;
  readonly sandboxed: boolean;
}

export interface ProcessSpawnAction extends ActionBase {
  readonly type: 'process:spawn';
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly detached?: boolean;
}

export interface ProcessKillAction extends ActionBase {
  readonly type: 'process:kill';
  readonly pid: number;
  readonly signal?: string;
}

export interface NetworkConnectAction extends ActionBase {
  readonly type: 'network:connect';
  readonly host: string;
  readonly port: number;
  readonly protocol: 'tcp' | 'udp' | 'tls';
  readonly timeoutMs?: number;
}

export interface ClipboardAccessAction extends ActionBase {
  readonly type: 'clipboard:access';
  readonly operation: 'read' | 'write';
  readonly content?: string; // required for write
}

export interface ScreenshotCaptureAction extends ActionBase {
  readonly type: 'screenshot:capture';
  readonly region?: { x: number; y: number; width: number; height: number };
  readonly format?: 'png' | 'jpeg';
}

export interface DatabaseQueryAction extends ActionBase {
  readonly type: 'database:query';
  readonly connectionId: string;
  readonly query: string;
  readonly params?: readonly unknown[];
  readonly readOnly: boolean;
}
```

### 11.3 ComputerAction Union

```typescript
export type ComputerAction =
  | FileReadAction | FileWriteAction | FileDeleteAction
  | DirectoryListAction
  | TerminalExecuteAction
  | BrowserNavigateAction | BrowserClickAction | BrowserInputAction | BrowserExtractAction
  | ApiCallAction
  | CodeExecuteAction
  | ProcessSpawnAction | ProcessKillAction
  | NetworkConnectAction
  | ClipboardAccessAction
  | ScreenshotCaptureAction
  | DatabaseQueryAction;
```

### 11.4 NativeAgentAction (Adapter-Facing)

What the adapter receives BEFORE translation to ComputerAction. Adapters translate their native format into ComputerAction for governance evaluation.

```typescript
export interface NativeAgentAction {
  readonly adapterId: AdapterId;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly nativeType: string; // adapter-specific action type
  readonly nativePayload: Readonly<Record<string, unknown>>; // adapter-specific payload
  readonly timestamp: string;
}
```

---

## 12. SandboxConfig (UNIFIED --- Rich Version)

```typescript
export interface SandboxConfig {
  readonly filesystem: FilesystemSandbox;
  readonly network: NetworkSandbox;
  readonly process: ProcessSandbox;
  readonly resources: ResourceSandbox;
  readonly duration: DurationSandbox;
}

export interface FilesystemSandbox {
  readonly allowedPaths: readonly string[]; // glob patterns
  readonly deniedPaths: readonly string[]; // glob patterns (takes precedence)
  readonly readOnly: boolean;
  readonly maxFileSize: number; // bytes
  readonly maxTotalSize: number; // bytes
}

export interface NetworkSandbox {
  readonly allowedHosts: readonly string[]; // host:port patterns
  readonly deniedHosts: readonly string[]; // takes precedence
  readonly allowedProtocols: readonly ('http' | 'https' | 'tcp' | 'udp' | 'tls')[];
  readonly maxConnections: number;
  readonly maxBandwidth: number; // bytes/sec
}

export interface ProcessSandbox {
  readonly allowedCommands: readonly string[]; // command patterns
  readonly deniedCommands: readonly string[]; // takes precedence
  readonly maxProcesses: number;
  readonly inheritEnv: boolean;
  readonly allowedEnvVars: readonly string[];
}

export interface ResourceSandbox {
  readonly maxMemory: number; // bytes
  readonly maxCpu: number; // percentage (0-100)
  readonly maxDiskIO: number; // bytes/sec
}

export interface DurationSandbox {
  readonly maxDuration: number; // ms
  readonly hardKillAfter: number; // ms after maxDuration before SIGKILL
  readonly warningAt: number; // ms, emit warning event
}
```

### 12.1 AdapterSandboxDefaults (Lightweight)

Lightweight config that adapters provide; expanded to full SandboxConfig by the governance layer.

```typescript
export interface AdapterSandboxDefaults {
  readonly allowedPathPatterns?: readonly string[];
  readonly deniedPathPatterns?: readonly string[];
  readonly allowedHostPatterns?: readonly string[];
  readonly deniedHostPatterns?: readonly string[];
  readonly allowedCommands?: readonly string[];
  readonly deniedCommands?: readonly string[];
  readonly maxDurationMs?: number;
  readonly readOnlyFilesystem?: boolean;
}
```

---

## 13. RefusalRule (UNIFIED --- Rich Version)

```typescript
export interface RefusalRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priority: number; // lower = higher priority, evaluated first
  readonly condition: RefusalCondition;
  readonly verdict: 'refuse' | 'escalate' | 'sandbox';
  readonly message: string; // human-readable reason
  readonly enabled: boolean;
  readonly builtin: boolean; // true = cannot be disabled by tenant
}

export type RefusalCondition =
  | { readonly type: 'path_match'; readonly pattern: string; readonly deny: boolean }
  | { readonly type: 'command_match'; readonly pattern: string }
  | { readonly type: 'host_match'; readonly pattern: string }
  | { readonly type: 'action_type'; readonly actionTypes: readonly ComputerActionType[] }
  | { readonly type: 'trust_below'; readonly minimumTrust: AgentTrustLevel }
  | { readonly type: 'rate_exceeded'; readonly policy: RateLimitPolicy }
  | { readonly type: 'classification_above'; readonly maxLevel: ClassificationLevel }
  | { readonly type: 'time_window'; readonly denyDuring: { start: string; end: string } }
  | { readonly type: 'composite'; readonly operator: 'and' | 'or' | 'not'; readonly conditions: readonly RefusalCondition[] };
```

### 13.1 AdapterRefusalHint (Lightweight)

Lightweight rule that the adapter provides; the registry expands to a full RefusalRule.

```typescript
export interface AdapterRefusalHint {
  readonly name: string;
  readonly condition: RefusalCondition;
  readonly verdict: 'refuse' | 'escalate' | 'sandbox';
  readonly message: string;
}
```

---

## 14. MergeStrategy (UNIFIED --- with Manual Semantics)

```typescript
export type MergeStrategy = 'highest_confidence' | 'evidence_weighted' | 'temporal_latest' | 'manual';
```

### 14.1 Strategy Semantics

| Strategy | Resolution Rule |
|---|---|
| highest_confidence | Claim with higher confidence wins. Tie: temporal_latest, then final tie-breaker. |
| evidence_weighted | Claim with more evidence references wins. Tie: highest_confidence, then final tie-breaker. |
| temporal_latest | Most recently asserted claim wins. Tie: final tie-breaker. |
| manual | Returns conflicts for human/agent resolution. |

**Final tie-breaker:** trunk claim wins over branch claim; otherwise earlier `branchIds` position wins; otherwise lexicographically smaller `ClaimId` wins. This applies to every non-manual strategy and makes equal-confidence/evidence/timestamp cases deterministic.

### 14.2 Manual Strategy Complete Semantics

1. When `mergeBranches` is called with `strategy: 'manual'`:
   - System identifies all conflicts (same subject+predicate, different values)
   - For each conflict, returns `MergeConflict` in `unresolvedConflicts`
   - Merge does NOT complete --- result has `status: 'pending_resolution'`
2. Caller must then call `resolveConflict(conflictId, resolution)` for each conflict
3. Resolution options: `'keep_branch' | 'keep_trunk' | 'keep_both' | 'discard_both' | 'merge_new_value'`
4. Once all conflicts are resolved, merge auto-completes
5. Timeout: if conflicts are not resolved within `session.timeout`, branch is auto-discarded
6. Fallback: if session ends with pending conflicts, `autoCleanup` behavior applies

```typescript
export type ManualMergeResolution = 'keep_branch' | 'keep_trunk' | 'keep_both' | 'discard_both' | 'merge_new_value';

export interface MergeConflict {
  readonly conflictId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly branchValue: string;
  readonly branchConfidence: number;
  readonly trunkValue: string;
  readonly trunkConfidence: number;
}

export interface MergeConflictResolution {
  readonly conflictId: string;
  readonly resolution: ManualMergeResolution;
  readonly newValue?: string; // required when resolution is 'merge_new_value'
  readonly newConfidence?: number; // required when resolution is 'merge_new_value'
  readonly resolvedBy: AgentId;
  readonly resolvedAt: string; // ISO-8601
}

export interface ManualMergeState {
  readonly mergeId: string;
  readonly status: 'pending_resolution' | 'resolved' | 'timed_out' | 'discarded';
  readonly conflicts: readonly MergeConflict[];
  readonly resolved: readonly MergeConflictResolution[];
  readonly deadline: string; // ISO-8601
}
```

---

## 15. SessionSummary (UNIFIED)

```typescript
export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly adapterId: AdapterId;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly duration: number; // ms
  readonly operations: SessionOperationCounts;
  readonly governance: SessionGovernanceCounts;
  readonly branches: SessionBranchCounts;
  readonly missions: SessionMissionCounts;
}

export interface SessionOperationCounts {
  readonly memoryWrites: number;
  readonly memoryReads: number;
  readonly memoryDeletes: number;
  readonly computerActions: number;
  readonly totalOperations: number;
}

export interface SessionGovernanceCounts {
  readonly allowed: number;
  readonly refused: number;
  readonly escalated: number;
  readonly sandboxed: number;
}

export interface SessionBranchCounts {
  readonly created: number;
  readonly merged: number;
  readonly discarded: number;
}

export interface SessionMissionCounts {
  readonly created: number;
  readonly completed: number;
  readonly failed: number;
}
```

---

## 16. Unified Event System

### 16.1 Event Types

```typescript
export type AgentEvent =
  // Memory events
  | 'memory:created' | 'memory:recalled' | 'memory:forgotten'
  | 'memory:branch_created' | 'memory:branch_merged' | 'memory:branch_discarded'
  // Governance events
  | 'governance:allowed' | 'governance:refused' | 'governance:escalated' | 'governance:sandboxed'
  // Computer action events
  | 'action:before' | 'action:after' | 'action:refused'
  // Session events
  | 'session:started' | 'session:ended'
  // Intelligence events
  | 'technique:extracted' | 'technique:evaluated' | 'technique:promoted'
  | 'technique:suspended' | 'technique:retired' | 'technique:transferred'
  | 'cognitive:health_degraded' | 'cognitive:consolidation_complete' | 'cognitive:gap_detected'
  | 'selfheal:triggered' | 'selfheal:cascade' | 'selfheal:complete' | 'selfheal:conflict_resolved'
  // Execution events
  | 'mission:created' | 'mission:state_changed' | 'mission:delegated'
  | 'mission:completed' | 'mission:failed' | 'mission:cancelled'
  | 'task:created' | 'task:state_changed' | 'task:completed' | 'task:failed' | 'task:retried'
  | 'budget:reserved' | 'budget:consumed' | 'budget:released' | 'budget:exhausted'
  | 'wave:started' | 'wave:completed' | 'wave:failed'
  // Context events
  | 'context:pressure_changed' | 'context:eviction_triggered' | 'context:eviction_complete'
  | 'context:pin_added' | 'context:pin_removed'
  | 'working_memory:written' | 'working_memory:discarded' | 'working_memory:flushed'
  // Lifecycle events
  | 'agent:registered' | 'agent:updated' | 'agent:suspended'
  | 'agent:reactivated' | 'agent:decommissioned'
  | 'capability:granted' | 'capability:revoked'
  | 'trust:promoted' | 'trust:demoted'
  | 'consent:registered' | 'consent:revoked' | 'consent:expired'
  | 'knowledge:exported' | 'knowledge:imported' | 'knowledge:transferred'
  // Wildcard
  | '*';
```

### 16.2 Event Payload and Bus

```typescript
export interface AgentEventPayload {
  readonly type: AgentEvent;
  readonly timestamp: string; // ISO-8601
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly auditId: EventId; // links to audit trail
  readonly data: Readonly<Record<string, unknown>>;
}

export type AgentEventHandler = (payload: AgentEventPayload) => void | Promise<void>;

export interface AgentEventBus {
  on(event: AgentEvent, handler: AgentEventHandler): string; // returns subscription ID
  off(subscriptionId: string): void;
  emit(payload: AgentEventPayload): void; // internal use only
}

export type EventBus = AgentEventBus;
```

**Validation rules:** `emit` is internal-only; adapters subscribe and translate but do not suppress audit-bound events. Wildcard `'*'` receives every event after the specific-event handler queue. Event ordering is guaranteed within a single `sessionId`; cross-session ordering is by audit-chain timestamp only.

**Example:** `eventBus.on('memory:created', handler)` receives only memory creation events; `eventBus.on('*', handler)` receives all Phase X events.

---

## 17. Retention Policy (UNIFIED)

| Classification | Retention | Auto-Archive After | Justification |
|---|---|---|---|
| unrestricted | 90 days | 30 days | Low value, minimal compliance |
| internal | 1 year | 90 days | Business operations |
| confidential | 3 years | 1 year | Regulatory compliance |
| restricted | 5 years | 2 years | Legal/financial records |
| critical | 7 years | Never | Security/governance audit trail |

```typescript
export interface RetentionPolicy {
  readonly classification: ClassificationLevel;
  readonly retentionDays: number;
  readonly autoArchiveDays: number | null; // null = never auto-archive
  readonly tombstoneOnExpiry: boolean; // true = tombstone, false = hard delete (only unrestricted)
  readonly gdprOverride: boolean; // true = GDPR erasure can override retention
}

export const DEFAULT_RETENTION: Record<ClassificationLevel, RetentionPolicy> = {
  unrestricted: { classification: 'unrestricted', retentionDays: 90, autoArchiveDays: 30, tombstoneOnExpiry: false, gdprOverride: true },
  internal: { classification: 'internal', retentionDays: 365, autoArchiveDays: 90, tombstoneOnExpiry: true, gdprOverride: true },
  confidential: { classification: 'confidential', retentionDays: 1095, autoArchiveDays: 365, tombstoneOnExpiry: true, gdprOverride: true },
  restricted: { classification: 'restricted', retentionDays: 1825, autoArchiveDays: 730, tombstoneOnExpiry: true, gdprOverride: false },
  critical: { classification: 'critical', retentionDays: 2555, autoArchiveDays: null, tombstoneOnExpiry: true, gdprOverride: false },
};
```

---

## 18. Rate Limit Policy (UNIFIED)

```typescript
export interface RateLimitPolicy {
  readonly scope: 'per_agent' | 'per_session' | 'per_adapter' | 'global';
  readonly dimension: 'actions' | 'memory_writes' | 'computer_actions' | 'all_operations';
  readonly limit: number;
  readonly windowSeconds: number;
  readonly enforcement: 'hard_refuse' | 'soft_throttle' | 'queue';
}

export const DEFAULT_RATE_LIMITS: readonly RateLimitPolicy[] = [
  { scope: 'per_agent', dimension: 'all_operations', limit: 1000, windowSeconds: 60, enforcement: 'hard_refuse' },
  { scope: 'per_agent', dimension: 'computer_actions', limit: 100, windowSeconds: 60, enforcement: 'hard_refuse' },
  { scope: 'per_agent', dimension: 'memory_writes', limit: 500, windowSeconds: 60, enforcement: 'soft_throttle' },
  { scope: 'per_session', dimension: 'all_operations', limit: 5000, windowSeconds: 300, enforcement: 'hard_refuse' },
  { scope: 'global', dimension: 'all_operations', limit: 10000, windowSeconds: 60, enforcement: 'queue' },
];
```

**Precedence:** Most specific wins. per_agent > per_session > per_adapter > global.
**Enforcement:** If an action would violate ANY applicable limit, the most restrictive enforcement applies.

---

## 19. Consent Integration

```typescript
export type ConsentableOperation =
  | 'assert_claim' | 'transfer_knowledge' | 'export_data'
  | 'share_with_agent' | 'store_personal_data' | 'process_sensitive';

export type ConsentPurpose =
  | 'memory_storage' | 'technique_extraction' | 'knowledge_transfer'
  | 'analytics' | 'improvement';

export interface ConsentRequirement {
  readonly operation: ConsentableOperation;
  readonly dataSubjectId: string;
  readonly purpose: ConsentPurpose;
  readonly checkBefore: 'memory_write' | 'knowledge_transfer' | 'data_export';
}

export interface ConsentContext {
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly dataSubjectId: string | null;
  readonly operation: ConsentableOperation;
  readonly purpose: ConsentPurpose;
  readonly consentId: ConsentId | null;
  readonly granted: boolean;
  readonly checkedAt: string; // ISO-8601
}
```

**Consent Check Triggers** --- Memory Bridge `remember()` MUST check consent when:
- Content contains personal data identifiers (detected via predicate pattern: `personal.*`, `user.*`, `identity.*`)
- Classification is 'restricted' or 'critical'
- Agent is operating on behalf of a data subject

**Validation rules:** If `granted` is true, `consentId` MUST be present. If `dataSubjectId` is null, the operation MUST be one that does not process personal data. Consent checks run before persistence or export.

**Example:** A `store_personal_data` operation for `user.123` returns `granted: false` and blocks `remember()` when no active consent exists.

---

## 20. Performance Budget (Reconciled)

The <10ms target applies to the GOVERNANCE CHECK ONLY (rule evaluation + verdict). It does NOT include audit append, provenance hashing, or full chain verification.

```typescript
export interface PerformanceBudget {
  readonly governanceCheck: { readonly maxMs: 10; readonly includes: 'rule_evaluation, verdict_production' };
  readonly auditAppend: { readonly maxMs: 50; readonly mode: 'durable_before_success'; readonly guarantees: 'no_success_without_audit' };
  readonly provenanceHash: { readonly maxMs: 100; readonly mode: 'batched_background'; readonly batchSize: 100 };
  readonly fullChainVerification: { readonly mode: 'on_demand'; readonly notPerOperation: true };
}
```

This resolves the physical impossibility: governance is fast (in-memory rule matching), the minimal audit record is durably appended before success is returned, and expensive provenance hashing/projection work is batched.

### 20.1 TokenEstimator Contract (UNIFIED)

```typescript
export type TokenEncoding = 'cl100k_base' | 'o200k_base' | 'provider_native';

export interface TokenEstimate {
  readonly tokens: number;
  readonly encoding: TokenEncoding;
  readonly exact: boolean;
  readonly varianceUpperBoundPct: number;
  readonly overflow: boolean;
}

export interface TokenEstimator {
  estimate(input: string | Readonly<Record<string, unknown>>, encoding: TokenEncoding): TokenEstimate;
}
```

**Validation rules:** `tokens` MUST be a finite non-negative integer. `varianceUpperBoundPct` MUST be <= 10 for approximate estimates and 0 for exact estimates. If tokenization fails or the estimate exceeds the caller budget by more than the variance bound, `overflow` MUST be true and the caller MUST exclude the item rather than truncate silently.

---

## 21. AgentFramework (UNIFIED)

```typescript
export type AgentFramework = 'claude' | 'codex' | 'openclaw' | 'hermes' | 'gemma' | 'custom';
```

---

## 22. TGP Types (Canonical)

Used by Intelligence Bridge and Lifecycle Management contracts.

```typescript
export type TGPTechniqueStatus = 'candidate' | 'active' | 'suspended' | 'retired';
export type TechniqueProvenanceKind = 'local_extraction' | 'cross_agent_transfer' | 'template_seed';
export type EvaluationSource = 'runtime' | 'template' | 'transfer_history' | 'manual';
export type EvaluationMethod = 'shadow_execution' | 'dedicated_task' | 'retrospective' | 'human_review' | 'template_provided';
export type PromotionResult = 'promoted' | 'rejected';
export type TGPRetiredReason = 'low_success_rate' | 'low_confidence' | 'stale' | 'human_flagged' | 'candidate_expiry' | 'quarantine_permanent';
```

---

## 23. Multi-Branch Merge Ordering (Deterministic)

When `mergeBranches` receives multiple branchIds:

1. Branches are processed in ORDER of the `branchIds` array (first = highest priority)
2. For each branch, claims are merged in chronological order (`createdAt` ascending)
3. If branch N's claim conflicts with an already-merged claim from branch M (where M < N), branch M's claim wins (earlier position = higher priority)
4. If a branch's claim conflicts with a TRUNK claim, the merge strategy applies; if strategy comparison ties, the trunk claim wins
5. All conflict resolutions are recorded in `MergeResult.conflictsResolved`

This is deterministic: same inputs always produce same outputs regardless of execution timing.

---

## 24. ActionDigest (for Rate Limiting and History)

```typescript
export interface ActionDigest {
  readonly actionId: EventId;
  readonly type: string; // ComputerAction.type
  readonly timestamp: string; // ISO-8601
  readonly verdict: 'allow' | 'refuse' | 'escalate' | 'sandbox';
  readonly duration: number; // ms
}
```

---

## 25. Rust Equivalents

For every canonical type that requires a Rust representation in the governance hot path.

```rust
// --- Branded IDs (all newtypes over String) ---

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TenantId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct UserId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EventId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PolicyId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MissionId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TaskId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AdapterId(pub String);

// --- AgentTrustLevel ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTrustLevel {
    Untrusted = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Verified = 4,
}

impl AgentTrustLevel {
    pub fn clearance_level(&self) -> u8 {
        match self {
            Self::Untrusted => 0,
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Verified => 4,
        }
    }

    pub fn core_trust_level(&self) -> &'static str {
        match self {
            Self::Untrusted => "untrusted",
            Self::Low => "probationary",
            Self::Medium => "trusted",
            Self::High => "trusted",
            Self::Verified => "admin",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationContext {
    pub tenant_id: Option<TenantId>,
    pub user_id: Option<UserId>,
    pub agent_id: Option<AgentId>,
    pub permissions: Vec<String>,
    pub session_id: Option<SessionId>,
    pub clearance_level: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: SessionId,
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub adapter_id: AdapterId,
    pub trust_level: AgentTrustLevel,
    pub core_trust_level: String,
    pub clearance_level: u8,
    pub capabilities: Vec<AgentCapability>,
    pub started_at: String,
    pub working_memory_namespace: String,
    pub active_missions: Vec<MissionId>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceContext {
    pub operation_context: OperationContext,
    pub session: AgentSession,
    pub action: serde_json::Value,
    pub resource: Option<String>,
    pub policy_ids: Vec<PolicyId>,
    pub action_history: Vec<ActionDigest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceDecision {
    pub allowed: bool,
    pub verdict: GovernanceVerdict,
    pub reason: Option<String>,
    pub required_permissions: Vec<String>,
    pub missing_permissions: Vec<String>,
    pub clearance_required: Option<u8>,
    pub clearance_actual: Option<u8>,
    pub evaluated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemoryEntry {
    pub id: String,
    pub content: String,
    pub subject: String,
    pub predicate: String,
    pub value: serde_json::Value,
    pub confidence: f64,
    pub effective_confidence: f64,
    pub freshness: String,
    pub classification: ClassificationLevel,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub source_agent_id: AgentId,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub grounding_mode: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub evidence_type: String,
    pub id: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipRef {
    pub id: String,
    pub relationship_type: String,
    pub target_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefState {
    pub belief: AgentMemoryEntry,
    pub evidence: Vec<EvidenceRef>,
    pub relationships: Vec<RelationshipRef>,
    pub status: String,
    pub retention_policy: Option<RetentionPolicy>,
    pub governance: Option<GovernanceDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredContent {
    pub subject: String,
    pub predicate: String,
    pub value: serde_json::Value,
    pub object_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemoryOptions {
    pub confidence: Option<f64>,
    pub reasoning: Option<String>,
    pub classification: Option<ClassificationLevel>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub grounding_mode: Option<String>,
    pub retention_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecallQuery {
    pub text: Option<String>,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub freshness_filter: Option<Vec<String>>,
    pub min_confidence: Option<f64>,
    pub time_range: Option<serde_json::Value>,
    pub classification: Option<ClassificationLevel>,
    pub mission_id: Option<MissionId>,
    pub task_id: Option<TaskId>,
    pub source_agent_id: Option<AgentId>,
    pub include_superseded: Option<bool>,
    pub branch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecallOptions {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub include_evidence: Option<bool>,
    pub include_relationships: Option<bool>,
    pub search_mode: Option<String>,
    pub archive_mode: Option<String>,
    pub sort_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: EventId,
    pub timestamp: String,
    pub tenant_id: Option<TenantId>,
    pub agent_id: AgentId,
    pub session_id: SessionId,
    pub event: AgentEvent,
    pub governance_decision: Option<GovernanceDecision>,
    pub details: serde_json::Value,
    pub previous_hash: String,
    pub current_hash: String,
    pub classification: ClassificationLevel,
}

pub type AgentAuditEntry = AuditLogEntry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentContext {
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub data_subject_id: Option<String>,
    pub operation: String,
    pub purpose: String,
    pub consent_id: Option<String>,
    pub granted: bool,
    pub checked_at: String,
}

// --- AgentCapability ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCapability {
    MemoryRead,
    MemoryWrite,
    BeliefManagement,
    Branching,
    TechniqueLearning,
    TechniqueTransfer,
    MissionCreation,
    MissionDelegation,
    ComputerUse,
    BrowserUse,
    TerminalUse,
    FileAccess,
    CodeExecution,
    ApiCalls,
    NetworkAccess,
    MultiAgent,
    KnowledgeExport,
    KnowledgeImport,
    ContextManagement,
    GovernanceAdmin,
}

// --- ComputerActionType ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ComputerActionType {
    #[serde(rename = "file:read")]
    FileRead,
    #[serde(rename = "file:write")]
    FileWrite,
    #[serde(rename = "file:delete")]
    FileDelete,
    #[serde(rename = "directory:list")]
    DirectoryList,
    #[serde(rename = "terminal:execute")]
    TerminalExecute,
    #[serde(rename = "browser:navigate")]
    BrowserNavigate,
    #[serde(rename = "browser:click")]
    BrowserClick,
    #[serde(rename = "browser:input")]
    BrowserInput,
    #[serde(rename = "browser:extract")]
    BrowserExtract,
    #[serde(rename = "api:call")]
    ApiCall,
    #[serde(rename = "code:execute")]
    CodeExecute,
    #[serde(rename = "process:spawn")]
    ProcessSpawn,
    #[serde(rename = "process:kill")]
    ProcessKill,
    #[serde(rename = "network:connect")]
    NetworkConnect,
    #[serde(rename = "clipboard:access")]
    ClipboardAccess,
    #[serde(rename = "screenshot:capture")]
    ScreenshotCapture,
    #[serde(rename = "database:query")]
    DatabaseQuery,
}

// --- GovernanceVerdict ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum GovernanceVerdict {
    Allow {
        audit_id: EventId,
        conditions: Option<Vec<String>>,
    },
    Refuse {
        audit_id: EventId,
        reason: String,
        rule: String,
        alternatives: Option<Vec<String>>,
    },
    Escalate {
        audit_id: EventId,
        reason: String,
        required_approval: ApprovalType,
    },
    Sandbox {
        audit_id: EventId,
        config: SandboxConfig,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalType {
    Human,
    SeniorAgent,
}

// --- AgentEvent ---

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentEvent(pub String); // Validated at construction: must match `domain:action` or `*`

// --- MergeStrategy ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    HighestConfidence,
    EvidenceWeighted,
    TemporalLatest,
    Manual,
}

// --- RetentionPolicy ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetentionPolicy {
    pub classification: ClassificationLevel,
    pub retention_days: u32,
    pub auto_archive_days: Option<u32>,
    pub tombstone_on_expiry: bool,
    pub gdpr_override: bool,
}

// --- ClassificationLevel ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClassificationLevel {
    Unrestricted = 0,
    Internal = 1,
    Confidential = 2,
    Restricted = 3,
    Critical = 4,
}

// --- RateLimitPolicy ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitPolicy {
    pub scope: RateLimitScope,
    pub dimension: RateLimitDimension,
    pub limit: u32,
    pub window_seconds: u32,
    pub enforcement: RateLimitEnforcement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitScope {
    PerAgent,
    PerSession,
    PerAdapter,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitDimension {
    Actions,
    MemoryWrites,
    ComputerActions,
    AllOperations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitEnforcement {
    HardRefuse,
    SoftThrottle,
    Queue,
}

// --- SandboxConfig ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub filesystem: FilesystemSandbox,
    pub network: NetworkSandbox,
    pub process: ProcessSandbox,
    pub resources: ResourceSandbox,
    pub duration: DurationSandbox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilesystemSandbox {
    pub allowed_paths: Vec<String>,
    pub denied_paths: Vec<String>,
    pub read_only: bool,
    pub max_file_size: u64,
    pub max_total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkSandbox {
    pub allowed_hosts: Vec<String>,
    pub denied_hosts: Vec<String>,
    pub allowed_protocols: Vec<String>,
    pub max_connections: u32,
    pub max_bandwidth: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessSandbox {
    pub allowed_commands: Vec<String>,
    pub denied_commands: Vec<String>,
    pub max_processes: u32,
    pub inherit_env: bool,
    pub allowed_env_vars: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSandbox {
    pub max_memory: u64,
    pub max_cpu: u8,
    pub max_disk_io: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DurationSandbox {
    pub max_duration: u64,
    pub hard_kill_after: u64,
    pub warning_at: u64,
}

// --- TGP Types ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TGPTechniqueStatus {
    Candidate,
    Active,
    Suspended,
    Retired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TechniqueProvenanceKind {
    LocalExtraction,
    CrossAgentTransfer,
    TemplateSeed,
}

// --- AgentFramework ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentFramework {
    Claude,
    Codex,
    Openclaw,
    Hermes,
    Gemma,
    Custom,
}
```

---

## 26. Type Ownership Index

| Type | Owner | Referenced By |
|---|---|---|
| AgentSession | SHARED_TYPES | All 8 contracts |
| GovernanceContext | SHARED_TYPES | Memory Bridge, Computer Use Gov, Adapter Arch, Execution Gov |
| GovernanceAction | SHARED_TYPES | Memory Bridge, Computer Use Gov, Adapter Arch, Execution Gov |
| GovernanceVerdict | SHARED_TYPES | Computer Use Gov, Memory Bridge, Adapter Arch, Audit Viz |
| GovernanceDecision | SHARED_TYPES | Memory Bridge, Audit Viz, Context Gov, Execution Gov |
| StructuredContent | SHARED_TYPES | Memory Bridge, Adapter Arch |
| AgentMemoryOptions | SHARED_TYPES | Memory Bridge, Adapter Arch |
| AgentRecallQuery | SHARED_TYPES | Memory Bridge, Adapter Arch |
| AgentRecallOptions | SHARED_TYPES | Memory Bridge, Adapter Arch |
| AgentMemoryEntry | SHARED_TYPES | Memory Bridge, Audit Viz, Context Gov, Intelligence Bridge |
| BeliefState / AgentBeliefState | SHARED_TYPES | Memory Bridge, Intelligence Bridge |
| EvidenceRef | SHARED_TYPES | Memory Bridge, Audit Viz, Intelligence Bridge |
| RelationshipRef | SHARED_TYPES | Memory Bridge, Audit Viz |
| AuditLogEntry / AgentAuditEntry | SHARED_TYPES | Audit Viz, Computer Use Gov, Lifecycle Mgmt |
| ComputerAction | SHARED_TYPES | Computer Use Gov, Adapter Arch, Audit Viz |
| ComputerActionType | SHARED_TYPES | Computer Use Gov, Adapter Arch, Audit Viz, Execution Gov |
| ActionBase | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| NativeAgentAction | SHARED_TYPES | Adapter Arch |
| AgentCapability | SHARED_TYPES | Adapter Arch, Lifecycle Mgmt, Execution Gov, Intelligence Bridge |
| AgentTrustLevel | SHARED_TYPES | Lifecycle Mgmt, Computer Use Gov, Adapter Arch, Execution Gov |
| TRUST_TO_CLEARANCE | SHARED_TYPES | Lifecycle Mgmt, Memory Bridge, Computer Use Gov |
| MergeStrategy | SHARED_TYPES | Memory Bridge, Adapter Arch |
| MergeConflict | SHARED_TYPES | Memory Bridge |
| ManualMergeState | SHARED_TYPES | Memory Bridge |
| SessionSummary | SHARED_TYPES | Memory Bridge, Adapter Arch |
| SessionOperationCounts | SHARED_TYPES | Memory Bridge, Adapter Arch |
| SessionGovernanceCounts | SHARED_TYPES | Memory Bridge, Adapter Arch, Audit Viz |
| SessionBranchCounts | SHARED_TYPES | Memory Bridge |
| SessionMissionCounts | SHARED_TYPES | Execution Gov |
| AgentEvent | SHARED_TYPES | All 8 contracts |
| AgentEventPayload | SHARED_TYPES | All 8 contracts |
| AgentEventHandler | SHARED_TYPES | All 8 contracts |
| AgentEventBus / EventBus | SHARED_TYPES | All 8 contracts |
| RetentionPolicy | SHARED_TYPES | Audit Viz, Computer Use Gov, Memory Bridge |
| RateLimitPolicy | SHARED_TYPES | Computer Use Gov, Adapter Arch, Execution Gov |
| ConsentContext | SHARED_TYPES | Memory Bridge, Lifecycle Mgmt, Intelligence Bridge |
| SandboxConfig | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| FilesystemSandbox | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| NetworkSandbox | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| ProcessSandbox | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| ResourceSandbox | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| DurationSandbox | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| AdapterSandboxDefaults | SHARED_TYPES | Adapter Arch |
| RefusalRule | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| RefusalCondition | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| AdapterRefusalHint | SHARED_TYPES | Adapter Arch |
| ConsentRequirement | SHARED_TYPES | Memory Bridge, Lifecycle Mgmt |
| ConsentableOperation | SHARED_TYPES | Memory Bridge, Lifecycle Mgmt |
| ConsentPurpose | SHARED_TYPES | Memory Bridge, Lifecycle Mgmt |
| PerformanceBudget | SHARED_TYPES | Computer Use Gov, Audit Viz |
| AgentFramework | SHARED_TYPES | Adapter Arch, Lifecycle Mgmt |
| TGPTechniqueStatus | SHARED_TYPES | Intelligence Bridge, Lifecycle Mgmt |
| TechniqueProvenanceKind | SHARED_TYPES | Intelligence Bridge |
| EvaluationSource | SHARED_TYPES | Intelligence Bridge |
| EvaluationMethod | SHARED_TYPES | Intelligence Bridge |
| PromotionResult | SHARED_TYPES | Intelligence Bridge |
| TGPRetiredReason | SHARED_TYPES | Intelligence Bridge, Lifecycle Mgmt |
| ActionDigest | SHARED_TYPES | Computer Use Gov, Adapter Arch |
| AgentBranchId | SHARED_TYPES | Memory Bridge, Intelligence Bridge |
| AdapterId | SHARED_TYPES | Adapter Arch, Lifecycle Mgmt, Memory Bridge |
| ConsentId | SHARED_TYPES | Lifecycle Mgmt, Memory Bridge |
| AuditEntryId | SHARED_TYPES | Audit Viz |
| TriggerConfigId | SHARED_TYPES | Intelligence Bridge |
| KnowledgePackageId | SHARED_TYPES | Intelligence Bridge, Lifecycle Mgmt |

---

## 27. Import Directive

Every Phase X contract MUST begin with:

> **Shared Types:** All cross-contract types referenced in this document are defined in `contracts/SHARED_TYPES.md`. This contract does NOT redefine any shared type. Local types are contract-specific and not used by other contracts.

Any contract that references a type from this registry MUST use it verbatim. No narrowing, no widening, no aliasing that changes semantics. A contract MAY define a local type alias for readability but MUST note it resolves to the shared type.

---

## Appendix A: Version History

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-05-05 | Initial ratification. All 27 sections canonical. |
| 1.1.0 | 2026-05-05 | Added CDM v2.1 Phase 8 manifest binding and canonical TokenEstimator contract. |
| 1.2.0 | 2026-05-05 | Promoted agent memory request DTOs to shared ownership and canonically mapped terminal escalation audit events. |
