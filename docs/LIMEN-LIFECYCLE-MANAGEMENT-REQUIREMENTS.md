# Limen v5 -- Agent Lifecycle Management Requirements Extraction

**Source:** `contracts/AGENT_LIFECYCLE_MANAGEMENT.md` v1.3.0
**Governing Standard:** SolisForge Protocol v1.4
**Extracted:** 2026-05-09
**Extraction Method:** Line-by-line contract analysis, every implementable detail

---

## Section 1: Purpose & Ordering (Lines 20-25)

| ID | Requirement | Source |
|---|---|---|
| LM-1.01 | The system SHALL define the full lifecycle of AI agents: registration, capability evolution, consent-governed operations, knowledge portability, and decommissioning. | "This contract defines the full lifecycle of AI agents within Limen" (L22) |
| LM-1.02 | Every agent SHALL have a well-defined identity, governed capabilities, and clean lifecycle boundaries. | "ensures every agent has a well-defined identity, governed capabilities, and clean lifecycle boundaries" (L22) |
| LM-1.03 | All state transitions SHALL produce audit entries. | "All state transitions produce audit entries" (L22) |
| LM-1.04 | All capability changes SHALL require evidence. | "all capability changes require evidence" (L22) |
| LM-1.05 | All knowledge exchange SHALL respect classification and consent constraints. | "all knowledge exchange respects classification and consent constraints" (L22) |
| LM-1.06 | Agent registration (this contract) SHALL create the identity BEFORE adapter registration (`AGENT_ADAPTER_ARCHITECTURE`) binds a framework adapter. | "Registration MUST happen first. An adapter cannot be bound to a non-existent agent identity." (L24) |
| LM-1.07 | An adapter SHALL NOT be bound to a non-existent agent identity. | "An adapter cannot be bound to a non-existent agent identity." (L24) |

**Section 1 Total: 7**

---

## Section 2: AgentLifecycleClient Interface (Lines 26-71)

### 2.1 Registration & Identity Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.01 | The interface SHALL expose `registerAgent(ctx: OperationContext, spec: AgentRegistrationSpec): Promise<Result<RegisteredAgent>>`. | Interface definition (L39) |
| LM-2.02 | The interface SHALL expose `getAgent(agentId: AgentId): Promise<Result<RegisteredAgent>>`. | Interface definition (L40) |
| LM-2.03 | The interface SHALL expose `listAgents(filter?: AgentFilter): Promise<Result<RegisteredAgent[]>>`. | Interface definition (L41) |
| LM-2.04 | The interface SHALL expose `updateAgent(ctx: OperationContext, agentId: AgentId, update: AgentUpdate): Promise<Result<RegisteredAgent>>`. | Interface definition (L42) |
| LM-2.05 | The interface SHALL expose `decommissionAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DecommissionResult>>`. | Interface definition (L43) |

### 2.2 Capability Management Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.06 | The interface SHALL expose `requestCapabilityUpgrade(ctx: OperationContext, agentId: AgentId, request: CapabilityRequest): Promise<Result<CapabilityDecision>>`. | Interface definition (L46) |
| LM-2.07 | The interface SHALL expose `revokeCapability(ctx: OperationContext, agentId: AgentId, capability: AgentCapability, reason: string): Promise<Result<void>>`. | Interface definition (L47) |
| LM-2.08 | The interface SHALL expose `getCapabilities(agentId: AgentId): Promise<Result<AgentCapabilitySet>>`. | Interface definition (L48) |
| LM-2.09 | The interface SHALL expose `getCapabilityHistory(agentId: AgentId): Promise<Result<CapabilityHistoryEntry[]>>`. | Interface definition (L49) |

### 2.3 Trust Promotion Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.10 | The interface SHALL expose `promoteAgent(ctx: OperationContext, agentId: AgentId, request: PromotionRequest): Promise<Result<TrustPromotionResult>>`. | Interface definition (L52) |
| LM-2.11 | The interface SHALL expose `demoteAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DemotionResult>>`. | Interface definition (L53) |
| LM-2.12 | The interface SHALL expose `getTrustLevel(agentId: AgentId): Promise<Result<AgentTrustLevel>>`. | Interface definition (L54) |

### 2.4 Consent Governance Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.13 | The interface SHALL expose `registerConsent(ctx: OperationContext, agentId: AgentId, consent: AgentConsentRecord): Promise<Result<ConsentId>>`. | Interface definition (L57) |
| LM-2.14 | The interface SHALL expose `revokeConsent(ctx: OperationContext, consentId: ConsentId, reason: string): Promise<Result<ConsentRevocationResult>>`. | Interface definition (L58) |
| LM-2.15 | The interface SHALL expose `checkConsent(agentId: AgentId, operation: ConsentableOperation): Promise<Result<ConsentDecision>>`. | Interface definition (L59) |
| LM-2.16 | The interface SHALL expose `listConsents(agentId: AgentId): Promise<Result<AgentConsentRecord[]>>`. | Interface definition (L60) |

### 2.5 Knowledge Exchange Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.17 | The interface SHALL expose `exportKnowledge(ctx: OperationContext, agentId: AgentId, options: KnowledgeExportOptions): Promise<Result<KnowledgePackage>>`. | Interface definition (L63) |
| LM-2.18 | The interface SHALL expose `importKnowledge(ctx: OperationContext, agentId: AgentId, pkg: KnowledgePackage, options?: KnowledgeImportOptions): Promise<Result<KnowledgeImportResult>>`. | Interface definition (L64) |
| LM-2.19 | The interface SHALL expose `transferKnowledge(ctx: OperationContext, fromAgentId: AgentId, toAgentId: AgentId, options: KnowledgeTransferOptions): Promise<Result<KnowledgeTransferResult>>`. | Interface definition (L65) |

### 2.6 Event Methods

| ID | Requirement | Source |
|---|---|---|
| LM-2.20 | The interface SHALL expose `on(event: AgentEvent, handler: AgentEventHandler): string` delegating to unified AgentEventBus (SHARED_TYPES S16). | Interface definition (L68) |
| LM-2.21 | The interface SHALL expose `off(subscriptionId: string): void` for event unsubscription. | Interface definition (L69) |
| LM-2.22 | The `on` method SHALL return a subscription ID string. | Interface definition (L68) |

**Section 2 Total: 22**

---

## Section 3: Registration & Identity Data Models (Lines 73-178)

### 3.1 AgentRegistrationSpec

| ID | Requirement | Source |
|---|---|---|
| LM-3.01 | `AgentRegistrationSpec.name` SHALL be a required readonly string. | Interface definition (L81) |
| LM-3.02 | `AgentRegistrationSpec.framework` SHALL be a required readonly `AgentFramework` (10-value union from SHARED_TYPES S21). | Interface definition (L82) |
| LM-3.03 | `AgentRegistrationSpec.version` SHALL be a required readonly string. | Interface definition (L83) |
| LM-3.04 | `AgentRegistrationSpec.tenantId` SHALL be an optional readonly `TenantId`. | Interface definition (L84) |
| LM-3.05 | `AgentRegistrationSpec.capabilities` SHALL be a required readonly array of `AgentCapability`. | Interface definition (L85) |
| LM-3.06 | `AgentRegistrationSpec.requestedTrustLevel` SHALL be an optional readonly `AgentTrustLevel`; registration defaults to 'untrusted'. | Interface definition + comment (L86) |
| LM-3.07 | `AgentRegistrationSpec.metadata` SHALL be an optional readonly `Record<string, unknown>`. | Interface definition (L87) |
| LM-3.08 | `AgentRegistrationSpec.owner` SHALL be a required readonly `UserId | AgentId`. | Interface definition (L88) |

### 3.2 RegisteredAgent

| ID | Requirement | Source |
|---|---|---|
| LM-3.09 | `RegisteredAgent.id` SHALL be a readonly `AgentId`. | Interface definition (L96) |
| LM-3.10 | `RegisteredAgent.name` SHALL be a readonly string. | Interface definition (L97) |
| LM-3.11 | `RegisteredAgent.framework` SHALL be a readonly `AgentFramework`. | Interface definition (L98) |
| LM-3.12 | `RegisteredAgent.version` SHALL be a readonly string. | Interface definition (L99) |
| LM-3.13 | `RegisteredAgent.tenantId` SHALL be a readonly `TenantId | null`. | Interface definition (L100) |
| LM-3.14 | `RegisteredAgent.state` SHALL be a readonly `AgentState`. | Interface definition (L101) |
| LM-3.15 | `RegisteredAgent.capabilities` SHALL be a readonly `AgentCapabilitySet`. | Interface definition (L102) |
| LM-3.16 | `RegisteredAgent.trustLevel` SHALL be a readonly `AgentTrustLevel`. | Interface definition (L103) |
| LM-3.17 | `RegisteredAgent.coreTrustLevel` SHALL be a readonly `CoreTrustLevel` derived via SHARED_TYPES S5. | Interface definition (L104) |
| LM-3.18 | `RegisteredAgent.clearanceLevel` SHALL be a readonly number derived via TRUST_TO_CLEARANCE. | Interface definition (L105) |
| LM-3.19 | `RegisteredAgent.owner` SHALL be a readonly `UserId | AgentId`. | Interface definition (L106) |
| LM-3.20 | `RegisteredAgent.metadata` SHALL be a readonly `Record<string, unknown>`. | Interface definition (L107) |
| LM-3.21 | `RegisteredAgent.statistics` SHALL be a readonly `AgentStatistics`. | Interface definition (L108) |
| LM-3.22 | `RegisteredAgent.registeredAt` SHALL be a readonly string (ISO-8601 timestamp). | Interface definition (L109) |
| LM-3.23 | `RegisteredAgent.lastActiveAt` SHALL be a readonly `string | null`. | Interface definition (L110) |
| LM-3.24 | `RegisteredAgent.decommissionedAt` SHALL be a readonly `string | null`. | Interface definition (L111) |
| LM-3.25 | `RegisteredAgent.decommissionReason` SHALL be a readonly `string | null`. | Interface definition (L112) |

### 3.3 AgentState

| ID | Requirement | Source |
|---|---|---|
| LM-3.26 | `AgentState` SHALL be a union type of exactly 3 values: `'active' | 'suspended' | 'decommissioned'`. | Type definition (L119) |
| LM-3.27 | 'active' state means fully operational, processing missions and asserting claims. | Comment (L120) |
| LM-3.28 | 'suspended' state means temporarily disabled via governance action or manual intervention. | Comment (L121) |
| LM-3.29 | 'decommissioned' state means permanently retired, data retained per retention policy. | Comment (L122) |

### 3.4 AgentUpdate

| ID | Requirement | Source |
|---|---|---|
| LM-3.30 | `AgentUpdate.name` SHALL be an optional readonly string. | Interface definition (L129) |
| LM-3.31 | `AgentUpdate.version` SHALL be an optional readonly string. | Interface definition (L130) |
| LM-3.32 | `AgentUpdate.metadata` SHALL be an optional readonly `Record<string, unknown>`. | Interface definition (L131) |
| LM-3.33 | Trust and clearance SHALL NOT be changed through `updateAgent`; they are changed only through `promoteAgent`/`demoteAgent`. | Comment (L132) |

### 3.5 AgentFilter

| ID | Requirement | Source |
|---|---|---|
| LM-3.34 | `AgentFilter.state` SHALL accept optional `AgentState | readonly AgentState[]`. | Interface definition (L140) |
| LM-3.35 | `AgentFilter.framework` SHALL accept optional `AgentFramework`. | Interface definition (L141) |
| LM-3.36 | `AgentFilter.tenantId` SHALL accept optional `TenantId`. | Interface definition (L142) |
| LM-3.37 | `AgentFilter.trustLevel` SHALL accept optional `AgentTrustLevel`. | Interface definition (L143) |
| LM-3.38 | `AgentFilter.capability` SHALL accept optional `AgentCapability`. | Interface definition (L144) |
| LM-3.39 | `AgentFilter.owner` SHALL accept optional `UserId | AgentId`. | Interface definition (L145) |
| LM-3.40 | `AgentFilter.limit` SHALL accept optional number for pagination. | Interface definition (L146) |
| LM-3.41 | `AgentFilter.offset` SHALL accept optional number for pagination. | Interface definition (L147) |

### 3.6 AgentStatistics

| ID | Requirement | Source |
|---|---|---|
| LM-3.42 | `AgentStatistics.totalSessions` SHALL be a readonly number. | Interface definition (L155) |
| LM-3.43 | `AgentStatistics.totalClaimsAsserted` SHALL be a readonly number. | Interface definition (L156) |
| LM-3.44 | `AgentStatistics.totalClaimsRetracted` SHALL be a readonly number. | Interface definition (L157) |
| LM-3.45 | `AgentStatistics.totalMissionsCompleted` SHALL be a readonly number. | Interface definition (L158) |
| LM-3.46 | `AgentStatistics.totalMissionsFailed` SHALL be a readonly number. | Interface definition (L159) |
| LM-3.47 | `AgentStatistics.totalGovernanceRefusals` SHALL be a readonly number. | Interface definition (L160) |
| LM-3.48 | `AgentStatistics.activeTechniques` SHALL be a readonly number. | Interface definition (L161) |
| LM-3.49 | `AgentStatistics.lastSessionDuration` SHALL be a readonly `number | null` in milliseconds. | Interface definition (L162) |
| LM-3.50 | `AgentStatistics.averageSessionDuration` SHALL be a readonly number in milliseconds. | Interface definition (L163) |

### 3.7 DecommissionResult

| ID | Requirement | Source |
|---|---|---|
| LM-3.51 | `DecommissionResult.agentId` SHALL be a readonly `AgentId`. | Interface definition (L171) |
| LM-3.52 | `DecommissionResult.decommissionedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L172) |
| LM-3.53 | `DecommissionResult.claimsPreserved` SHALL be a readonly number. | Interface definition (L173) |
| LM-3.54 | `DecommissionResult.sessionsTerminated` SHALL be a readonly number. | Interface definition (L174) |
| LM-3.55 | `DecommissionResult.knowledgeArchived` SHALL be a readonly boolean. | Interface definition (L175) |
| LM-3.56 | `DecommissionResult.consentsRevoked` SHALL be a readonly number. | Interface definition (L176) |
| LM-3.57 | `DecommissionResult.capabilitiesRevoked` SHALL be a readonly number. | Interface definition (L177) |

**Section 3 Total: 57**

---

## Section 4: Capability Management Data Models (Lines 181-236)

### 4.1 AgentCapability

| ID | Requirement | Source |
|---|---|---|
| LM-4.01 | `AgentCapability` SHALL be the 20-value canonical union type from SHARED_TYPES S6. | "See SHARED_TYPES.md S6 -- 20-value canonical union type" (L185) |
| LM-4.02 | Trust level to capability mapping SHALL follow SHARED_TYPES S6.1 (minimum trust level per capability). | "Trust level to capability mapping: See SHARED_TYPES.md S6.1" (L187) |

### 4.2 AgentCapabilitySet

| ID | Requirement | Source |
|---|---|---|
| LM-4.03 | `AgentCapabilitySet.granted` SHALL be a readonly array of `AgentCapability` (capabilities currently active). | Interface definition (L193) |
| LM-4.04 | `AgentCapabilitySet.denied` SHALL be a readonly array of `AgentCapability` (explicitly revoked). | Interface definition (L194) |
| LM-4.05 | `AgentCapabilitySet.pending` SHALL be a readonly array of `AgentCapability` (requested, awaiting approval). | Interface definition (L195) |

### 4.3 CapabilityRequest

| ID | Requirement | Source |
|---|---|---|
| LM-4.06 | `CapabilityRequest.capabilities` SHALL be a required readonly array of `AgentCapability`. | Interface definition (L203) |
| LM-4.07 | `CapabilityRequest.justification` SHALL be a required readonly string. | Interface definition (L204) |
| LM-4.08 | `CapabilityRequest.evidence` SHALL be an optional readonly array of strings (references to work demonstrating readiness). | Interface definition (L205) |

### 4.4 CapabilityDecision

| ID | Requirement | Source |
|---|---|---|
| LM-4.09 | `CapabilityDecision.requestedCapabilities` SHALL be a readonly array of the originally requested capabilities. | Interface definition (L213) |
| LM-4.10 | `CapabilityDecision.granted` SHALL be a readonly array of capabilities that were approved. | Interface definition (L214) |
| LM-4.11 | `CapabilityDecision.denied` SHALL be a readonly array of `CapabilityDenial`. | Interface definition (L215) |
| LM-4.12 | `CapabilityDecision.decidedBy` SHALL be a readonly `UserId | 'system'`. | Interface definition (L216) |
| LM-4.13 | `CapabilityDecision.decidedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L217) |
| LM-4.14 | `CapabilityDenial.capability` SHALL be a readonly `AgentCapability`. | Interface definition (L220) |
| LM-4.15 | `CapabilityDenial.reason` SHALL be a readonly string. | Interface definition (L221) |

### 4.5 CapabilityHistoryEntry

| ID | Requirement | Source |
|---|---|---|
| LM-4.16 | `CapabilityHistoryEntry.capability` SHALL be a readonly `AgentCapability`. | Interface definition (L230) |
| LM-4.17 | `CapabilityHistoryEntry.action` SHALL be a readonly union: `'granted' | 'revoked' | 'requested' | 'denied'`. | Interface definition (L231) |
| LM-4.18 | `CapabilityHistoryEntry.reason` SHALL be a readonly string. | Interface definition (L232) |
| LM-4.19 | `CapabilityHistoryEntry.decidedBy` SHALL be a readonly `UserId | 'system'`. | Interface definition (L233) |
| LM-4.20 | `CapabilityHistoryEntry.timestamp` SHALL be a readonly string (ISO-8601). | Interface definition (L234) |

**Section 4 Total: 20**

---

## Section 5: Trust Level & Promotion Data Models (Lines 238-297)

### 5.1 AgentTrustLevel

| ID | Requirement | Source |
|---|---|---|
| LM-5.01 | `AgentTrustLevel` SHALL be the 5-level canonical type from SHARED_TYPES S5 with clearance mapping. | "See SHARED_TYPES.md S5 -- 5-level canonical type with clearance mapping" (L242) |

### 5.2 PromotionRequest

| ID | Requirement | Source |
|---|---|---|
| LM-5.02 | `PromotionRequest.targetLevel` SHALL be a required readonly `AgentTrustLevel`. | Interface definition (L248) |
| LM-5.03 | `PromotionRequest.justification` SHALL be a required readonly string. | Interface definition (L249) |
| LM-5.04 | `PromotionRequest.evidence` SHALL be a required readonly array of `TrustPromotionEvidence`. | Interface definition (L250) |

### 5.3 TrustPromotionEvidence

| ID | Requirement | Source |
|---|---|---|
| LM-5.05 | `TrustPromotionEvidence.type` SHALL be a readonly `TrustPromotionEvidenceType`. | Interface definition (L259) |
| LM-5.06 | `TrustPromotionEvidence.value` SHALL be a readonly `number | string`. | Interface definition (L260) |
| LM-5.07 | `TrustPromotionEvidence.description` SHALL be a readonly string. | Interface definition (L261) |
| LM-5.08 | `TrustPromotionEvidenceType` SHALL be a 5-value union: `'session_count' | 'mission_success_rate' | 'governance_compliance' | 'technique_quality' | 'human_endorsement'`. | Type definition (L264-269) |

### 5.4 TrustPromotionResult

| ID | Requirement | Source |
|---|---|---|
| LM-5.09 | `TrustPromotionResult.agentId` SHALL be a readonly `AgentId`. | Interface definition (L276) |
| LM-5.10 | `TrustPromotionResult.previousLevel` SHALL be a readonly `AgentTrustLevel`. | Interface definition (L277) |
| LM-5.11 | `TrustPromotionResult.newLevel` SHALL be a readonly `AgentTrustLevel`. | Interface definition (L278) |
| LM-5.12 | `TrustPromotionResult.capabilitiesUnlocked` SHALL be a readonly array of `AgentCapability`. | Interface definition (L279) |
| LM-5.13 | `TrustPromotionResult.decidedBy` SHALL be a readonly `UserId | 'system'`. | Interface definition (L280) |
| LM-5.14 | `TrustPromotionResult.decidedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L281) |

### 5.5 DemotionResult

| ID | Requirement | Source |
|---|---|---|
| LM-5.15 | `DemotionResult.agentId` SHALL be a readonly `AgentId`. | Interface definition (L289) |
| LM-5.16 | `DemotionResult.previousLevel` SHALL be a readonly `AgentTrustLevel`. | Interface definition (L290) |
| LM-5.17 | `DemotionResult.newLevel` SHALL be a readonly `AgentTrustLevel`. | Interface definition (L291) |
| LM-5.18 | `DemotionResult.capabilitiesRevoked` SHALL be a readonly array of `AgentCapability`. | Interface definition (L292) |
| LM-5.19 | `DemotionResult.reason` SHALL be a readonly string. | Interface definition (L293) |
| LM-5.20 | `DemotionResult.decidedBy` SHALL be a readonly `UserId | 'system'`. | Interface definition (L294) |
| LM-5.21 | `DemotionResult.decidedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L295) |

**Section 5 Total: 21**

---

## Section 6: Consent Governance Data Models (Lines 299-352)

### 6.1 AgentConsentRecord

| ID | Requirement | Source |
|---|---|---|
| LM-6.01 | `AgentConsentRecord.id` SHALL be an optional readonly `ConsentId` (assigned on registration). | Interface definition (L308) |
| LM-6.02 | `AgentConsentRecord.agentId` SHALL be a required readonly `AgentId`. | Interface definition (L309) |
| LM-6.03 | `AgentConsentRecord.dataSubject` SHALL be a required readonly string identifying who the data belongs to. | Interface definition (L310) |
| LM-6.04 | `AgentConsentRecord.purpose` SHALL be a required readonly `ConsentPurpose` (5-value union from SHARED_TYPES S19). | Interface definition (L311) |
| LM-6.05 | `AgentConsentRecord.scope` SHALL be a required readonly `ConsentScope`. | Interface definition (L312) |
| LM-6.06 | `AgentConsentRecord.grantedAt` SHALL be a required readonly string (ISO-8601). | Interface definition (L313) |
| LM-6.07 | `AgentConsentRecord.expiresAt` SHALL be a readonly `string | null`. | Interface definition (L314) |
| LM-6.08 | `AgentConsentRecord.status` SHALL be a readonly `ConsentStatus`. | Interface definition (L315) |
| LM-6.09 | `ConsentStatus` SHALL be a 3-value union: `'active' | 'revoked' | 'expired'`. | Type definition (L318) |

### 6.2 ConsentScope

| ID | Requirement | Source |
|---|---|---|
| LM-6.10 | `ConsentScope.predicateDomains` SHALL be an optional readonly array of strings limiting consent to specific predicate domains. | Interface definition (L325) |
| LM-6.11 | `ConsentScope.classificationMax` SHALL be an optional readonly `ClassificationLevel` (consent only up to this level). | Interface definition (L326) |
| LM-6.12 | `ConsentScope.operations` SHALL be an optional readonly array of `ConsentableOperation`. | Interface definition (L327) |

### 6.3 ConsentDecision

| ID | Requirement | Source |
|---|---|---|
| LM-6.13 | `ConsentDecision.allowed` SHALL be a readonly boolean. | Interface definition (L335) |
| LM-6.14 | `ConsentDecision.consentId` SHALL be a readonly `ConsentId | null` identifying which consent record authorizes. | Interface definition (L336) |
| LM-6.15 | `ConsentDecision.reason` SHALL be a readonly string. | Interface definition (L337) |
| LM-6.16 | `ConsentDecision.expiresAt` SHALL be a readonly `string | null`. | Interface definition (L338) |

### 6.4 ConsentRevocationResult

| ID | Requirement | Source |
|---|---|---|
| LM-6.17 | `ConsentRevocationResult.consentId` SHALL be a readonly `ConsentId`. | Interface definition (L346) |
| LM-6.18 | `ConsentRevocationResult.revokedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L347) |
| LM-6.19 | `ConsentRevocationResult.claimsAffected` SHALL be a readonly number. | Interface definition (L348) |
| LM-6.20 | `ConsentRevocationResult.transfersBlocked` SHALL be a readonly number. | Interface definition (L349) |
| LM-6.21 | `ConsentRevocationResult.cascadeActions` SHALL be a readonly array of strings. | Interface definition (L350) |

**Section 6 Total: 21**

---

## Section 7: Knowledge Exchange Data Models (Lines 354-492)

### 7.1 KnowledgeExportOptions

| ID | Requirement | Source |
|---|---|---|
| LM-7.01 | `KnowledgeExportOptions.domains` SHALL be an optional readonly array of strings. | Interface definition (L360) |
| LM-7.02 | `KnowledgeExportOptions.minConfidence` SHALL be an optional readonly number. | Interface definition (L361) |
| LM-7.03 | `KnowledgeExportOptions.includeTechniques` SHALL be an optional readonly boolean. | Interface definition (L362) |
| LM-7.04 | `KnowledgeExportOptions.includeRelationships` SHALL be an optional readonly boolean. | Interface definition (L363) |
| LM-7.05 | `KnowledgeExportOptions.format` SHALL be a required readonly `KnowledgeFormat`. | Interface definition (L364) |
| LM-7.06 | `KnowledgeExportOptions.classification` SHALL be an optional readonly `ClassificationLevel` (max classification to export). | Interface definition (L365) |
| LM-7.07 | `KnowledgeFormat` SHALL be a 3-value union: `'limen_native' | 'json_ld' | 'rdf_turtle'`. | Type definition (L368) |

### 7.2 KnowledgePackage

| ID | Requirement | Source |
|---|---|---|
| LM-7.08 | `KnowledgePackage.id` SHALL be a readonly `KnowledgePackageId`. | Interface definition (L375) |
| LM-7.09 | `KnowledgePackage.sourceAgentId` SHALL be a readonly `AgentId`. | Interface definition (L376) |
| LM-7.10 | `KnowledgePackage.exportedAt` SHALL be a readonly string (ISO-8601). | Interface definition (L377) |
| LM-7.11 | `KnowledgePackage.format` SHALL be a readonly `KnowledgeFormat`. | Interface definition (L378) |
| LM-7.12 | `KnowledgePackage.claims` SHALL be a readonly array of `ExportedClaim`. | Interface definition (L379) |
| LM-7.13 | `KnowledgePackage.techniques` SHALL be a readonly array of `ExportedTechnique`. | Interface definition (L380) |
| LM-7.14 | `KnowledgePackage.relationships` SHALL be a readonly array of `ExportedRelationship`. | Interface definition (L381) |
| LM-7.15 | `KnowledgePackage.metadata` SHALL be a readonly `KnowledgePackageMetadata`. | Interface definition (L382) |
| LM-7.16 | `KnowledgePackage.checksum` SHALL be a readonly string containing the SHA-256 of serialized claims+techniques+relationships. | Interface definition (L383) |

### 7.2.1 KnowledgePackageMetadata

| ID | Requirement | Source |
|---|---|---|
| LM-7.17 | `KnowledgePackageMetadata.claimCount` SHALL be a readonly number. | Interface definition (L387) |
| LM-7.18 | `KnowledgePackageMetadata.techniqueCount` SHALL be a readonly number. | Interface definition (L388) |
| LM-7.19 | `KnowledgePackageMetadata.relationshipCount` SHALL be a readonly number. | Interface definition (L389) |
| LM-7.20 | `KnowledgePackageMetadata.domains` SHALL be a readonly array of strings. | Interface definition (L390) |
| LM-7.21 | `KnowledgePackageMetadata.classificationMax` SHALL be a readonly `ClassificationLevel`. | Interface definition (L391) |

### 7.3 ExportedClaim

| ID | Requirement | Source |
|---|---|---|
| LM-7.22 | `ExportedClaim.originalId` SHALL be a readonly `ClaimId`. | Interface definition (L399) |
| LM-7.23 | `ExportedClaim.subject` SHALL be a readonly string. | Interface definition (L400) |
| LM-7.24 | `ExportedClaim.predicate` SHALL be a readonly string. | Interface definition (L401) |
| LM-7.25 | `ExportedClaim.value` SHALL be a readonly `unknown`. | Interface definition (L402) |
| LM-7.26 | `ExportedClaim.confidence` SHALL be a readonly number. | Interface definition (L403) |
| LM-7.27 | `ExportedClaim.classification` SHALL be a readonly `ClassificationLevel`. | Interface definition (L404) |
| LM-7.28 | `ExportedClaim.reasoning` SHALL be a readonly `string | null`. | Interface definition (L405) |
| LM-7.29 | `ExportedClaim.createdAt` SHALL be a readonly string (ISO-8601). | Interface definition (L406) |

### 7.4 ExportedTechnique

| ID | Requirement | Source |
|---|---|---|
| LM-7.30 | `ExportedTechnique.originalId` SHALL be a readonly `ClaimId`. | Interface definition (L416) |
| LM-7.31 | `ExportedTechnique.description` SHALL be a readonly string. | Interface definition (L417) |
| LM-7.32 | `ExportedTechnique.domain` SHALL be a readonly string. | Interface definition (L418) |
| LM-7.33 | `ExportedTechnique.status` SHALL be a readonly `TGPTechniqueStatus` (4-value: 'candidate' | 'active' | 'suspended' | 'retired'). | Interface definition (L419) |
| LM-7.34 | `ExportedTechnique.successRate` SHALL be a readonly number. | Interface definition (L420) |
| LM-7.35 | `ExportedTechnique.evaluationCount` SHALL be a readonly number. | Interface definition (L421) |

### 7.5 ExportedRelationship

| ID | Requirement | Source |
|---|---|---|
| LM-7.36 | `ExportedRelationship.fromClaimOriginalId` SHALL be a readonly `ClaimId`. | Interface definition (L431) |
| LM-7.37 | `ExportedRelationship.toClaimOriginalId` SHALL be a readonly `ClaimId`. | Interface definition (L432) |
| LM-7.38 | `ExportedRelationship.type` SHALL be a readonly `RelationshipType` (4-value: 'supports' | 'contradicts' | 'supersedes' | 'derived_from'). | Interface definition (L433) |

### 7.6 KnowledgeImportOptions

| ID | Requirement | Source |
|---|---|---|
| LM-7.39 | `KnowledgeImportOptions.conflictStrategy` SHALL be a required readonly `ConflictStrategy`. | Interface definition (L441) |
| LM-7.40 | `KnowledgeImportOptions.confidenceCap` SHALL be an optional readonly number defaulting to 0.5 (imported knowledge is not authoritative). | Interface definition (L442) |
| LM-7.41 | `KnowledgeImportOptions.classification` SHALL be an optional readonly `ClassificationLevel` to force classification on imports. | Interface definition (L443) |
| LM-7.42 | `KnowledgeImportOptions.validateIntegrity` SHALL be an optional readonly boolean defaulting to true. | Interface definition (L444) |
| LM-7.43 | `ConflictStrategy` SHALL be a 4-value union: `'skip' | 'override' | 'merge' | 'branch'`. | Type definition (L447) |
| LM-7.44 | 'skip' strategy SHALL ignore conflicting claims. | Comment (L448) |
| LM-7.45 | 'override' strategy SHALL replace existing with imported. | Comment (L449) |
| LM-7.46 | 'merge' strategy SHALL keep highest-confidence version. | Comment (L450) |
| LM-7.47 | 'branch' strategy SHALL create belief branch for resolution. | Comment (L451) |

### 7.7 KnowledgeImportResult

| ID | Requirement | Source |
|---|---|---|
| LM-7.48 | `KnowledgeImportResult.imported` SHALL be a readonly number. | Interface definition (L458) |
| LM-7.49 | `KnowledgeImportResult.skipped` SHALL be a readonly number. | Interface definition (L459) |
| LM-7.50 | `KnowledgeImportResult.conflicts` SHALL be a readonly number. | Interface definition (L460) |
| LM-7.51 | `KnowledgeImportResult.branchCreated` SHALL be a readonly boolean. | Interface definition (L461) |
| LM-7.52 | `KnowledgeImportResult.branchId` SHALL be a readonly `string | null`. | Interface definition (L462) |
| LM-7.53 | `KnowledgeImportResult.newClaimIds` SHALL be a readonly array of `ClaimId`. | Interface definition (L463) |
| LM-7.54 | `KnowledgeImportResult.duration` SHALL be a readonly number in milliseconds. | Interface definition (L464) |

### 7.8 KnowledgeTransferOptions

| ID | Requirement | Source |
|---|---|---|
| LM-7.55 | `KnowledgeTransferOptions.domains` SHALL be an optional readonly array of strings. | Interface definition (L472) |
| LM-7.56 | `KnowledgeTransferOptions.includeTechniques` SHALL be an optional readonly boolean. | Interface definition (L473) |
| LM-7.57 | `KnowledgeTransferOptions.confidenceCap` SHALL be an optional readonly number defaulting to 0.5. | Interface definition (L474) |
| LM-7.58 | `KnowledgeTransferOptions.consentPurpose` SHALL be an optional readonly `ConsentPurpose` defaulting to 'knowledge_transfer'. | Interface definition (L475) |

### 7.9 KnowledgeTransferResult

| ID | Requirement | Source |
|---|---|---|
| LM-7.59 | `KnowledgeTransferResult.fromAgentId` SHALL be a readonly `AgentId`. | Interface definition (L483) |
| LM-7.60 | `KnowledgeTransferResult.toAgentId` SHALL be a readonly `AgentId`. | Interface definition (L484) |
| LM-7.61 | `KnowledgeTransferResult.transferred` SHALL be a readonly number. | Interface definition (L485) |
| LM-7.62 | `KnowledgeTransferResult.skipped` SHALL be a readonly number. | Interface definition (L486) |
| LM-7.63 | `KnowledgeTransferResult.conflicts` SHALL be a readonly number. | Interface definition (L487) |
| LM-7.64 | `KnowledgeTransferResult.newClaimIds` SHALL be a readonly array of `ClaimId`. | Interface definition (L488) |
| LM-7.65 | `KnowledgeTransferResult.transferredAt` SHALL be a readonly string (ISO-8601). | Interface definition (L489) |
| LM-7.66 | `KnowledgeTransferResult.consentId` SHALL be a readonly `ConsentId | null` (consent record that authorized this transfer). | Interface definition (L490) |

**Section 7 Total: 66**

---

## Section 8: Lifecycle Events (Lines 494-504)

| ID | Requirement | Source |
|---|---|---|
| LM-8.01 | The system SHALL use the unified event system defined in SHARED_TYPES S16. | "This contract uses the unified event system defined in SHARED_TYPES.md S16" (L496) |
| LM-8.02 | The system SHALL emit `agent:registered` event on agent registration. | Event list (L498) |
| LM-8.03 | The system SHALL emit `agent:updated` event on agent update. | Event list (L498) |
| LM-8.04 | The system SHALL emit `agent:suspended` event on agent suspension. | Event list (L498) |
| LM-8.05 | The system SHALL emit `agent:reactivated` event on agent reactivation. | Event list (L498) |
| LM-8.06 | The system SHALL emit `agent:decommissioned` event on agent decommission. | Event list (L498) |
| LM-8.07 | The system SHALL emit `capability:granted` event when a capability is granted. | Event list (L499) |
| LM-8.08 | The system SHALL emit `capability:revoked` event when a capability is revoked. | Event list (L499) |
| LM-8.09 | The system SHALL emit `trust:promoted` event on trust promotion. | Event list (L500) |
| LM-8.10 | The system SHALL emit `trust:demoted` event on trust demotion. | Event list (L500) |
| LM-8.11 | The system SHALL emit `consent:registered` event when consent is registered. | Event list (L501) |
| LM-8.12 | The system SHALL emit `consent:revoked` event when consent is revoked. | Event list (L501) |
| LM-8.13 | The system SHALL emit `consent:expired` event when consent expires. | Event list (L501) |
| LM-8.14 | The system SHALL emit `knowledge:exported` event on knowledge export. | Event list (L502) |
| LM-8.15 | The system SHALL emit `knowledge:imported` event on knowledge import. | Event list (L502) |
| LM-8.16 | The system SHALL emit `knowledge:transferred` event on knowledge transfer. | Event list (L502) |
| LM-8.17 | All events SHALL use `AgentEventPayload` (S16.2) structure. | "All events use AgentEventPayload (S16.2)" (L504) |
| LM-8.18 | All events SHALL flow through the shared `AgentEventBus`. | "flow through the shared AgentEventBus" (L504) |

**Section 8 Total: 18**

---

## Section 9: Error Types (Lines 506-526)

| ID | Requirement | Source |
|---|---|---|
| LM-9.01 | The system SHALL return error `AGENT_NOT_FOUND` with `agentId` when an agent does not exist. | Error type (L510) |
| LM-9.02 | The system SHALL return error `AGENT_ALREADY_EXISTS` with `name` and `framework` when registering a duplicate. | Error type (L511) |
| LM-9.03 | The system SHALL return error `AGENT_DECOMMISSIONED` with `agentId` when operating on a decommissioned agent. | Error type (L512) |
| LM-9.04 | The system SHALL return error `AGENT_SUSPENDED` with `agentId` and `reason` when operating on a suspended agent. | Error type (L513) |
| LM-9.05 | The system SHALL return error `CAPABILITY_DENIED` with `capability` and `reason` when a capability request is denied. | Error type (L514) |
| LM-9.06 | The system SHALL return error `PROMOTION_DENIED` with `targetLevel` and `reason` when promotion is denied. | Error type (L515) |
| LM-9.07 | The system SHALL return error `DEMOTION_BELOW_FLOOR` with `agentId` and `currentLevel` when demotion would go below floor. | Error type (L516) |
| LM-9.08 | The system SHALL return error `CONSENT_REQUIRED` with `operation` and `dataSubject` when consent is missing. | Error type (L517) |
| LM-9.09 | The system SHALL return error `CONSENT_EXPIRED` with `consentId` and `expiredAt` when consent has expired. | Error type (L518) |
| LM-9.10 | The system SHALL return error `CONSENT_NOT_FOUND` with `consentId` when consent record does not exist. | Error type (L519) |
| LM-9.11 | The system SHALL return error `TRANSFER_DENIED` with `reason`, `fromAgent`, and `toAgent` when transfer is denied. | Error type (L520) |
| LM-9.12 | The system SHALL return error `IMPORT_INTEGRITY_FAILED` with `expectedChecksum` and `actualChecksum` when integrity check fails. | Error type (L521) |
| LM-9.13 | The system SHALL return error `CLASSIFICATION_EXCEEDED` with `agentLevel` and `dataLevel` when classification is exceeded. | Error type (L522) |
| LM-9.14 | The system SHALL return error `TRUST_LEVEL_INSUFFICIENT` with `required` and `actual` when trust level is too low. | Error type (L523) |
| LM-9.15 | The system SHALL return error `GOVERNANCE_REFUSAL` with `reason` and `action` when governance blocks an action. | Error type (L524) |
| LM-9.16 | The system SHALL return error `INVALID_STATE_TRANSITION` with `from` and `to` states when an invalid transition is attempted. | Error type (L525) |

**Section 9 Total: 16**

---

## Section 10: Agent Lifecycle State Machine (Lines 528-564)

| ID | Requirement | Source |
|---|---|---|
| LM-10.01 | The state machine SHALL have exactly 3 states: `active`, `suspended`, `decommissioned` (plus implicit `unregistered` pre-registration). | State machine diagram (L530-553) |
| LM-10.02 | Transition from `unregistered` to `active` SHALL occur via `registerAgent()`. | Transition table (L559) |
| LM-10.03 | Transition from `unregistered` to `active` SHALL require a valid spec and unique name+framework pair. | Transition table (L559) |
| LM-10.04 | Transition from `active` to `suspended` SHALL occur on governance violation, manual action, or security event. | Transition table (L560) |
| LM-10.05 | Transition from `active` to `suspended` SHALL require a reason and produce an audit entry. | Transition table (L560) |
| LM-10.06 | Transition from `suspended` to `active` SHALL occur via reactivation (updateAgent with state restoration). | Transition table (L561) |
| LM-10.07 | Transition from `suspended` to `active` SHALL require review evidence and actor authority. | Transition table (L561) |
| LM-10.08 | Transition from `active` to `decommissioned` SHALL occur via `decommissionAgent()`. | Transition table (L562) |
| LM-10.09 | Transition from `active` to `decommissioned` SHALL require a reason and cascade cleanup. | Transition table (L562) |
| LM-10.10 | Transition from `suspended` to `decommissioned` SHALL occur via `decommissionAgent()`. | Transition table (L563) |
| LM-10.11 | Transition from `suspended` to `decommissioned` SHALL require a reason and cascade cleanup. | Transition table (L563) |
| LM-10.12 | Transition from `decommissioned` to ANY state SHALL be FORBIDDEN (terminal state, no recovery). | Transition table (L564) |

**Section 10 Total: 12**

---

## Section 11: Trust Level Capability Mapping (Lines 566-588)

| ID | Requirement | Source |
|---|---|---|
| LM-11.01 | This contract SHALL implement the canonical SHARED_TYPES S5.2 promotion requirements exactly (no independent thresholds). | "This contract does not define independent promotion thresholds. It implements the canonical S5.2 requirements exactly" (L570) |
| LM-11.02 | Trust level 'untrusted' SHALL be the default on registration. | Mapping table (L574) |
| LM-11.03 | Trust level 'low' promotion SHALL require registration complete and adapter connected. | Mapping table (L575) |
| LM-11.04 | Trust level 'medium' promotion SHALL require 10+ successful operations and 0 governance refusals in last 24h. | Mapping table (L576) |
| LM-11.05 | Trust level 'high' promotion SHALL require 100+ successful operations and human approval OR senior agent endorsement. | Mapping table (L577) |
| LM-11.06 | Trust level 'verified' promotion SHALL require human approval and Core admin transition record. | Mapping table (L578) |
| LM-11.07 | Trust level 'untrusted' SHALL have N/A max assertable confidence (cannot assert). | Confidence table (L584) |
| LM-11.08 | Trust level 'low' SHALL have max assertable confidence of 0.3. | Confidence table (L585) |
| LM-11.09 | Trust level 'medium' SHALL have max assertable confidence of 0.7. | Confidence table (L586) |
| LM-11.10 | Trust level 'high' SHALL have max assertable confidence of 0.85. | Confidence table (L587) |
| LM-11.11 | Trust level 'verified' SHALL have max assertable confidence of 1.0. | Confidence table (L588) |

**Section 11 Total: 11**

---

## Section 12: Rust Trait (Lines 590-863)

### 12.1 Rust Enums & Structs

| ID | Requirement | Source |
|---|---|---|
| LM-12.01 | Rust `AgentState` enum SHALL have exactly 3 variants: `Active`, `Suspended`, `Decommissioned`. | Rust enum (L601-606) |
| LM-12.02 | Rust `TrustPromotionEvidence` struct SHALL have fields: `evidence_type: String`, `value: String`, `description: String`. | Rust struct (L609-613) |
| LM-12.03 | Rust `AgentRegistrationSpec` struct SHALL have fields: `name`, `framework`, `version`, `tenant_id`, `capabilities`, `requested_trust_level`, `metadata`, `owner`. | Rust struct (L616-625) |
| LM-12.04 | Rust `AgentUpdate` struct SHALL have fields: `name: Option<String>`, `version: Option<String>`, `metadata: Option<serde_json::Value>`. | Rust struct (L628-632) |
| LM-12.05 | Rust `CapabilityRequest` struct SHALL have fields: `capabilities: Vec<AgentCapability>`, `justification: String`, `evidence: Vec<String>`. | Rust struct (L635-639) |
| LM-12.06 | Rust `PromotionRequest` struct SHALL have fields: `target_level`, `justification`, `evidence: Vec<TrustPromotionEvidence>`. | Rust struct (L642-646) |
| LM-12.07 | Rust `KnowledgeExportOptions` struct SHALL have fields: `domains`, `min_confidence`, `include_techniques`, `include_relationships`, `format`, `classification`. | Rust struct (L649-656) |
| LM-12.08 | Rust `KnowledgeImportOptions` struct SHALL have fields: `conflict_strategy`, `confidence_cap`, `classification`, `validate_integrity`. | Rust struct (L659-664) |
| LM-12.09 | Rust `KnowledgeFormat` enum SHALL have exactly 3 variants: `LimenNative`, `JsonLd`, `RdfTurtle`. | Rust enum (L668-672) |
| LM-12.10 | Rust `ConsentStatus` enum SHALL have exactly 3 variants: `Active`, `Revoked`, `Expired`. | Rust enum (L675-680) |
| LM-12.11 | Rust `RegisteredAgent` struct SHALL have fields: `id`, `name`, `framework`, `version`, `tenant_id`, `state`, `trust_level`, `core_trust_level`, `clearance_level`, `owner`, `registered_at`, `last_active_at`, `decommissioned_at`, `decommission_reason`. | Rust struct (L683-698) |
| LM-12.12 | Rust `DecommissionResult` struct SHALL have fields: `agent_id`, `decommissioned_at`, `claims_preserved`, `sessions_terminated`, `knowledge_archived`, `consents_revoked`, `capabilities_revoked`. | Rust struct (L700-708) |
| LM-12.13 | Rust `CapabilityDecision` struct SHALL have fields: `requested`, `granted`, `denied: Vec<(AgentCapability, String)>`, `decided_by`, `decided_at`. | Rust struct (L710-716) |
| LM-12.14 | Rust `TrustPromotionResult` struct SHALL have fields: `agent_id`, `previous_level`, `new_level`, `capabilities_unlocked`, `decided_by`, `decided_at`. | Rust struct (L718-725) |
| LM-12.15 | Rust `DemotionResult` struct SHALL have fields: `agent_id`, `previous_level`, `new_level`, `capabilities_revoked`, `reason`, `decided_by`, `decided_at`. | Rust struct (L727-735) |
| LM-12.16 | Rust `ConsentDecision` struct SHALL have fields: `allowed`, `consent_id`, `reason`, `expires_at`. | Rust struct (L737-742) |
| LM-12.17 | Rust `KnowledgePackage` struct SHALL have fields: `id`, `source_agent_id`, `exported_at`, `format`, `checksum`, `claim_count`, `technique_count`, `relationship_count`. | Rust struct (L744-753) |
| LM-12.18 | Rust `KnowledgeImportResult` struct SHALL have fields: `imported`, `skipped`, `conflicts`, `branch_created`, `branch_id`, `new_claim_ids`, `duration_ms`. | Rust struct (L755-763) |

### 12.2 Rust Error Enum

| ID | Requirement | Source |
|---|---|---|
| LM-12.19 | Rust `LifecycleError` enum SHALL have exactly 16 variants matching the TypeScript error types. | Rust enum (L767-784) |
| LM-12.20 | `LifecycleError::AgentNotFound` SHALL contain `agent_id: String`. | Rust enum (L768) |
| LM-12.21 | `LifecycleError::AgentAlreadyExists` SHALL contain `name: String, framework: AgentFramework`. | Rust enum (L769) |
| LM-12.22 | `LifecycleError::AgentDecommissioned` SHALL contain `agent_id: String`. | Rust enum (L770) |
| LM-12.23 | `LifecycleError::AgentSuspended` SHALL contain `agent_id: String, reason: String`. | Rust enum (L771) |
| LM-12.24 | `LifecycleError::CapabilityDenied` SHALL contain `capability: AgentCapability, reason: String`. | Rust enum (L772) |
| LM-12.25 | `LifecycleError::PromotionDenied` SHALL contain `target_level: AgentTrustLevel, reason: String`. | Rust enum (L773) |
| LM-12.26 | `LifecycleError::DemotionBelowFloor` SHALL contain `agent_id: String, current_level: AgentTrustLevel`. | Rust enum (L774) |
| LM-12.27 | `LifecycleError::ConsentRequired` SHALL contain `operation: String, data_subject: String`. | Rust enum (L775) |
| LM-12.28 | `LifecycleError::ConsentExpired` SHALL contain `consent_id: String, expired_at: String`. | Rust enum (L776) |
| LM-12.29 | `LifecycleError::ConsentNotFound` SHALL contain `consent_id: String`. | Rust enum (L777) |
| LM-12.30 | `LifecycleError::TransferDenied` SHALL contain `reason: String, from_agent: String, to_agent: String`. | Rust enum (L778) |
| LM-12.31 | `LifecycleError::ImportIntegrityFailed` SHALL contain `expected: String, actual: String`. | Rust enum (L779) |
| LM-12.32 | `LifecycleError::ClassificationExceeded` SHALL contain `agent_level: ClassificationLevel, data_level: ClassificationLevel`. | Rust enum (L780) |
| LM-12.33 | `LifecycleError::TrustLevelInsufficient` SHALL contain `required: AgentTrustLevel, actual: AgentTrustLevel`. | Rust enum (L781) |
| LM-12.34 | `LifecycleError::GovernanceRefusal` SHALL contain `reason: String, action: String`. | Rust enum (L782) |
| LM-12.35 | `LifecycleError::InvalidStateTransition` SHALL contain `from: AgentState, to: AgentState`. | Rust enum (L783) |

### 12.3 Rust Trait Methods

| ID | Requirement | Source |
|---|---|---|
| LM-12.36 | Rust `AgentLifecycleManager` trait SHALL require `Send + Sync`. | Trait definition (L787) |
| LM-12.37 | Rust trait SHALL expose `register_agent(&self, ctx, spec) -> Result<RegisteredAgent, LifecycleError>`. | Trait method (L788-792) |
| LM-12.38 | Rust trait SHALL expose `get_agent(&self, agent_id) -> Result<RegisteredAgent, LifecycleError>`. | Trait method (L794-797) |
| LM-12.39 | Rust trait SHALL expose `update_agent(&self, ctx, agent_id, update) -> Result<RegisteredAgent, LifecycleError>`. | Trait method (L799-804) |
| LM-12.40 | Rust trait SHALL expose `decommission_agent(&self, ctx, agent_id, reason) -> Result<DecommissionResult, LifecycleError>`. | Trait method (L806-811) |
| LM-12.41 | Rust trait SHALL expose `request_capability(&self, ctx, agent_id, request) -> Result<CapabilityDecision, LifecycleError>`. | Trait method (L813-818) |
| LM-12.42 | Rust trait SHALL expose `revoke_capability(&self, ctx, agent_id, capability, reason) -> Result<(), LifecycleError>`. | Trait method (L820-826) |
| LM-12.43 | Rust trait SHALL expose `promote_agent(&self, ctx, agent_id, request) -> Result<TrustPromotionResult, LifecycleError>`. | Trait method (L828-833) |
| LM-12.44 | Rust trait SHALL expose `demote_agent(&self, ctx, agent_id, reason) -> Result<DemotionResult, LifecycleError>`. | Trait method (L835-840) |
| LM-12.45 | Rust trait SHALL expose `check_consent(&self, agent_id, operation) -> Result<ConsentDecision, LifecycleError>`. | Trait method (L842-846) |
| LM-12.46 | Rust trait SHALL expose `export_knowledge(&self, ctx, agent_id, options) -> Result<KnowledgePackage, LifecycleError>`. | Trait method (L848-853) |
| LM-12.47 | Rust trait SHALL expose `import_knowledge(&self, ctx, agent_id, package, options) -> Result<KnowledgeImportResult, LifecycleError>`. | Trait method (L855-861) |
| LM-12.48 | All Rust trait methods SHALL return `impl Future<Output = Result<T, LifecycleError>> + Send`. | Trait methods (L788-861) |

**Section 12 Total: 48**

---

## Section 13: Invariants (Lines 865-879)

| ID | Requirement | Source |
|---|---|---|
| LM-13.01 | **Identity Immutability:** `AgentId` SHALL never change after registration. | Invariant 1 (L867) |
| LM-13.02 | **Identity Uniqueness:** Name+framework pair SHALL be unique within a tenant. | Invariant 1 (L867) |
| LM-13.03 | **Terminal Decommission:** No recovery path SHALL exist from decommissioned state. Any attempt SHALL return `INVALID_STATE_TRANSITION`. | Invariant 2 (L868) |
| LM-13.04 | **Capability-Trust Ceiling:** Capabilities SHALL only be granted at or below the agent's current trust level mapping (SHARED_TYPES S6.1). | Invariant 3 (L869) |
| LM-13.05 | **Capability-Trust Ceiling Enforcement:** Granting above current trust level mapping SHALL require promotion first. | Invariant 3 (L869) |
| LM-13.06 | **Evidence-Based Promotion:** Trust level changes SHALL require evidence meeting the canonical criteria in SHARED_TYPES S5.2. | Invariant 4 (L870) |
| LM-13.07 | **Evidence-Based Promotion Enforcement:** No arbitrary promotion SHALL occur without meeting canonical requirements. | Invariant 4 (L870) |
| LM-13.08 | **Consent-Before-Storage:** Storing personal data without active consent SHALL return `CONSENT_REQUIRED`. | Invariant 5 (L871) |
| LM-13.09 | **Consent-Before-Storage Audit:** Violated consent operations SHALL be logged as governance refusals. | Invariant 5 (L871) |
| LM-13.10 | **Import Confidence Cap:** Knowledge import SHALL cap confidence at 0.5 by default. | Invariant 6 (L872) |
| LM-13.11 | **Import Confidence Cap Semantics:** Imported knowledge SHALL never be authoritative without local validation. | Invariant 6 (L872) |
| LM-13.12 | **Classification Boundary Export:** The system SHALL NOT export claims above agent's clearance level. | Invariant 7 (L873) |
| LM-13.13 | **Classification Boundary Import:** The system SHALL NOT import at classification above agent's clearance. | Invariant 7 (L873) |
| LM-13.14 | **Classification Boundary Error:** Violations of classification boundaries SHALL return `CLASSIFICATION_EXCEEDED`. | Invariant 7 (L873) |
| LM-13.15 | **Decommission Preservation:** Decommissioned agent's claims SHALL remain in the system with full provenance. | Invariant 8 (L874) |
| LM-13.16 | **Decommission Preservation Marking:** Preserved claims SHALL be marked as sourced from a decommissioned agent, not deleted. | Invariant 8 (L874) |
| LM-13.17 | **Immediate Revocation:** Capability revocation SHALL take effect immediately. | Invariant 9 (L875) |
| LM-13.18 | **Immediate Revocation In-Flight:** In-flight operations requiring revoked capability SHALL be terminated with `CAPABILITY_DENIED`. | Invariant 9 (L875) |
| LM-13.19 | **Consent Expiry Enforcement:** Expired consent SHALL block new operations automatically. | Invariant 10 (L876) |
| LM-13.20 | **Consent Expiry Sweep:** A background sweep SHALL mark expired consents. | Invariant 10 (L876) |
| LM-13.21 | **Consent Expiry Runtime:** Runtime checks SHALL enforce consent expiry at operation time. | Invariant 10 (L876) |
| LM-13.22 | **Derived Statistics:** `AgentStatistics` SHALL be computed from the audit trail on read (no separate counter storage). | Invariant 11 (L877) |
| LM-13.23 | **Derived Statistics No Drift:** No separate counter storage SHALL exist that could drift from truth. | Invariant 11 (L877) |
| LM-13.24 | **Universal Audit:** All lifecycle state changes SHALL produce an audit entry. | Invariant 12 (L878) |
| LM-13.25 | **Universal Audit Fields:** Each audit entry SHALL contain: actor (who), action (what), target (whom), timestamp (when), reason (why), and outcome (result). | Invariant 12 (L878) |
| LM-13.26 | **Explicit Mutation Context:** Every public lifecycle mutation SHALL take `OperationContext` before state changes. | Invariant 13 (L879) |
| LM-13.27 | **Explicit Mutation Context Enforcement:** Actor, tenant, permissions, session, and clearance SHALL never be derived from ambient adapter state. | Invariant 13 (L879) |

**Section 13 Total: 27**

---

## Section 14: Behavioral Contracts (Lines 881-928)

### 14.1 Registration Behavior

| ID | Requirement | Source |
|---|---|---|
| LM-14.01 | Agent name SHALL be 1-64 characters. | "Agent name must be 1-64 characters" (L885) |
| LM-14.02 | Agent name SHALL contain only alphanumeric characters, hyphens, and underscores. | "alphanumeric + hyphens + underscores only" (L885) |
| LM-14.03 | Framework SHALL be a recognized value from `AgentFramework` (SHARED_TYPES S21). | "Framework must be a recognized value" (L886) |
| LM-14.04 | Initial capabilities SHALL be intersected with trust level 'untrusted' mapping. | "Initial capabilities are intersected with trust level 'untrusted' mapping" (L887) |
| LM-14.05 | After intersection with 'untrusted' mapping, only `memory_read` and `context_management` SHALL survive (per SHARED_TYPES S5.1). | "only memory_read and context_management survive" (L887) |
| LM-14.06 | Registration SHALL emit `agent:registered` event via unified `AgentEventBus`. | "Registration emits agent:registered event" (L888) |

### 14.2 Suspension Behavior

| ID | Requirement | Source |
|---|---|---|
| LM-14.07 | Suspension SHALL preserve all agent data. | "Suspension preserves all agent data" (L892) |
| LM-14.08 | Suspension SHALL block all operations except `getAgent()`. | "blocks all operations except getAgent()" (L892) |
| LM-14.09 | Suspended agents SHALL NOT assert claims. | "Suspended agents cannot assert claims" (L893) |
| LM-14.10 | Suspended agents SHALL NOT execute missions. | "execute missions" (L893) |
| LM-14.11 | Suspended agents SHALL NOT participate in transfers. | "participate in transfers" (L893) |
| LM-14.12 | Suspension SHALL emit `agent:suspended` event with reason. | "Suspension emits agent:suspended event with reason" (L894) |

### 14.3 Decommission Cascade

| ID | Requirement | Source |
|---|---|---|
| LM-14.13 | Decommission cascade SHALL execute atomically. | "the following cascade executes atomically" (L898) |
| LM-14.14 | Decommission step 1: State SHALL be set to 'decommissioned'. | Cascade step 1 (L899) |
| LM-14.15 | Decommission step 2: All active sessions SHALL be terminated. | Cascade step 2 (L900) |
| LM-14.16 | Decommission step 3: All active consents SHALL be revoked, emitting `consent:revoked` for each. | Cascade step 3 (L901) |
| LM-14.17 | Decommission step 4: All capabilities SHALL be revoked. | Cascade step 4 (L902) |
| LM-14.18 | Decommission step 5: Knowledge archive SHALL be created if agent has claims. | Cascade step 5 (L903) |
| LM-14.19 | Decommission step 6: Agent SHALL be removed from active agent lists but remain queryable with state filter. | Cascade step 6 (L904) |
| LM-14.20 | Decommission step 7: `agent:decommissioned` event SHALL be emitted. | Cascade step 7 (L905) |

### 14.4 Knowledge Transfer Protocol

| ID | Requirement | Source |
|---|---|---|
| LM-14.21 | Transfer step 1: Source agent SHALL be verified as active with 'knowledge_export' capability. | Protocol step 1 (L909) |
| LM-14.22 | Transfer step 2: Target agent SHALL be verified as active with 'knowledge_import' capability. | Protocol step 2 (L910) |
| LM-14.23 | Transfer step 3: Active consent SHALL be verified for 'transfer_knowledge' operation (SHARED_TYPES S19). This step is mandatory and SHALL NOT be disabled by caller options. | Protocol step 3 (L911) |
| LM-14.24 | Transfer step 4: Export from source SHALL apply classification filter (source agent's clearance). | Protocol step 4 (L912) |
| LM-14.25 | Transfer step 5: Target agent's classification filter SHALL be applied (cannot exceed target's clearance). | Protocol step 5 (L913) |
| LM-14.26 | Transfer step 6: Confidence cap SHALL be applied (default 0.5). | Protocol step 6 (L914) |
| LM-14.27 | Transfer step 7: Import into target SHALL use specified conflict strategy. | Protocol step 7 (L915) |
| LM-14.28 | Transfer step 8: `knowledge:exported` SHALL be emitted for source, `knowledge:imported` for target, `knowledge:transferred` for both. | Protocol step 8 (L916) |
| LM-14.29 | Transfer step 9: Transfer result SHALL include full accounting. | Protocol step 9 (L917) |

### 14.5 Consent Check Flow

| ID | Requirement | Source |
|---|---|---|
| LM-14.30 | `checkConsent` SHALL find all active consents for the given `agentId`. | Flow step 1 (L923) |
| LM-14.31 | `checkConsent` SHALL filter by operation match (`scope.operations` includes the operation). | Flow step 2 (L924) |
| LM-14.32 | `checkConsent` SHALL filter by non-expired (`expiresAt` null OR `expiresAt` > now). | Flow step 3 (L925) |
| LM-14.33 | If any consent matches, `checkConsent` SHALL return `{ allowed: true, consentId, reason, expiresAt }`. | Flow step 4 (L926) |
| LM-14.34 | If no consent matches, `checkConsent` SHALL return `{ allowed: false, consentId: null, reason: "no active consent", expiresAt: null }`. | Flow step 5 (L927) |

**Section 14 Total: 34**

---

## Section 15: Integration Points (Lines 930-941)

| ID | Requirement | Source |
|---|---|---|
| LM-15.01 | Claim Engine integration: Agent assertions SHALL be routed through capability + consent checks (inbound). | Integration table (L934) |
| LM-15.02 | Working Memory integration: Read/write SHALL be gated by trust level capabilities (inbound). | Integration table (L935) |
| LM-15.03 | Mission Manager integration: Mission creation/delegation SHALL require high+ trust (inbound). | Integration table (L936) |
| LM-15.04 | Audit System integration: All lifecycle events SHALL be written as audit entries (outbound). | Integration table (L937) |
| LM-15.05 | Consent API integration: Agent consent records SHALL be stored in existing consent infrastructure (bidirectional). | Integration table (L938) |
| LM-15.06 | Export/Import integration: Knowledge packages SHALL use existing `LimenExportDocument` format internally (bidirectional). | Integration table (L939) |
| LM-15.07 | Event Bus integration: Lifecycle events SHALL be published via unified `AgentEventBus` (SHARED_TYPES S16) (outbound). | Integration table (L940) |
| LM-15.08 | Adapter Architecture integration: Adapter binding SHALL require prior agent registration from this contract (outbound). | Integration table (L941) |

**Section 15 Total: 8**

---

## Section 16: Migration Path (Lines 943-951)

| ID | Requirement | Source |
|---|---|---|
| LM-16.01 | Existing agents (registered via thin registration API) SHALL receive state: 'active'. | Migration rule 1 (L946) |
| LM-16.02 | Existing agents SHALL receive trustLevel: 'medium' (grandfather -- they have operational history). | Migration rule 1 (L946) |
| LM-16.03 | Capabilities for existing agents SHALL be inferred from actual usage patterns in audit trail. | Migration rule 2 (L947) |
| LM-16.04 | No consent records SHALL exist for migrated agents -- personal-data, restricted, critical, export, and transfer operations SHALL be blocked with `CONSENT_REQUIRED` until explicit consent is registered. | Migration rule 3 (L948) |
| LM-16.05 | Non-consentable operations for migrated agents SHALL continue without blocking. | Migration rule 3 (L948) |
| LM-16.06 | Statistics for existing agents SHALL be computed retroactively from audit trail on first access. | Migration rule 4 (L949) |
| LM-16.07 | Migration SHALL be idempotent -- running it twice SHALL produce identical results. | Migration rule 5 (L950) |

**Section 16 Total: 7**

---

## Summary

| Section | Description | Count |
|---|---|---|
| 1 | Purpose & Ordering | 7 |
| 2 | AgentLifecycleClient Interface | 22 |
| 3 | Registration & Identity Data Models | 57 |
| 4 | Capability Management Data Models | 20 |
| 5 | Trust Level & Promotion Data Models | 21 |
| 6 | Consent Governance Data Models | 21 |
| 7 | Knowledge Exchange Data Models | 66 |
| 8 | Lifecycle Events | 18 |
| 9 | Error Types | 16 |
| 10 | Agent Lifecycle State Machine | 12 |
| 11 | Trust Level Capability Mapping | 11 |
| 12 | Rust Trait (v5 Alignment) | 48 |
| 13 | Invariants | 27 |
| 14 | Behavioral Contracts | 34 |
| 15 | Integration Points | 8 |
| 16 | Migration Path | 7 |
| 17 | Cross-Language Parity Gaps (TC-21) | 11 |
| **GRAND TOTAL** | | **406** |

---

## Section 17: Cross-Language Parity Gaps (TC-21)

The Rust trait (Section 12) defines 12 methods. The TypeScript interface (Section 2) defines 21 methods. 9 TypeScript methods have NO Rust equivalent. Each gap is a requirement that MUST be resolved before v5 Rust integration: either implement the Rust method or document why it is excluded.

| ID | Requirement | Source |
|---|---|---|
| LM-17.01 | Known TC-21 gap: TypeScript `listAgents(filter?)` has no Rust trait equivalent `list_agents`. MUST be added to Rust trait or exclusion documented. | SS2 L41 vs SS12 L787-862 |
| LM-17.02 | Known TC-21 gap: TypeScript `getCapabilities(agentId)` has no Rust trait equivalent `get_capabilities`. MUST be added or exclusion documented. | SS2 L48 vs SS12 |
| LM-17.03 | Known TC-21 gap: TypeScript `getCapabilityHistory(agentId)` has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L49 vs SS12 |
| LM-17.04 | Known TC-21 gap: TypeScript `getTrustLevel(agentId)` has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L54 vs SS12 |
| LM-17.05 | Known TC-21 gap: TypeScript `registerConsent(agentId, consent)` has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L57 vs SS12 |
| LM-17.06 | Known TC-21 gap: TypeScript `revokeConsent(consentId)` has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L58 vs SS12 |
| LM-17.07 | Known TC-21 gap: TypeScript `listConsents(agentId)` has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L60 vs SS12 |
| LM-17.08 | Known TC-21 gap: TypeScript `transferKnowledge(fromAgentId, toAgentId, opts)` has no Rust trait equivalent. Rust has `export_knowledge`+`import_knowledge` but no combined transfer. MUST reconcile. | SS2 L65 vs SS12 |
| LM-17.09 | Known TC-21 gap: TypeScript `on(event, handler)` event subscription has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L68 vs SS12 |
| LM-17.10 | Known TC-21 gap: TypeScript `off(subscriptionId)` event unsubscription has no Rust trait equivalent. MUST be added or exclusion documented. | SS2 L69 vs SS12 |
| LM-17.11 | Known TC-21 gap: Rust `RegisteredAgent` struct omits `capabilities`, `metadata`, `statistics` fields present in TypeScript `RegisteredAgent`. MUST reconcile field sets. | SS3 L95-113 (TS) vs SS12 L683-698 (Rust) |

**Section 17 Total: 11**
