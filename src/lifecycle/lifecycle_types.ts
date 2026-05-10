// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * Agent Lifecycle Management Types
 *
 * All types derived from LM-3 through LM-7 requirements.
 * Implements: LIMEN-LIFECYCLE-MANAGEMENT-REQUIREMENTS.md
 *
 * Design decisions:
 * - Branded types for all IDs (AD-2)
 * - Readonly interfaces throughout (immutability by default)
 * - Result<T> for all fallible operations (AD-11)
 * - AgentTrustLevel uses 5-level model from SHARED_TYPES S5
 * - AgentCapability uses 20-value union from SHARED_TYPES S6
 */

import type {
  AgentId, TenantId, ConsentId, ClaimId, UserId,
  AgentTrustLevel, AgentCapability, AgentFramework,
  ClassificationLevel, ConsentableOperation, ConsentPurpose,
  OperationContext, Result, AgentEventHandler,
  AgentEvent, RelationshipType,
} from '../adapters/shared/types.js';

// BK-18: Import canonical technique status type
import type { TGPTechniqueStatus } from '../techniques/interfaces/tgp_types.js';

// ============================================================================
// Branded ID Types (AD-2)
// ============================================================================

/** LM-7.08: Knowledge package identifier */
export type KnowledgePackageId = string & { readonly __brand: 'KnowledgePackageId' };

/** LM-6.01: Consent record uses ConsentId from shared types */
export type { ConsentId } from '../adapters/shared/types.js';

// ============================================================================
// Section 3: Registration & Identity Data Models (LM-3)
// ============================================================================

/** LM-3.01 through LM-3.08: Agent registration input specification */
export interface AgentRegistrationSpec {
  readonly name: string;                                      // LM-3.01
  readonly framework: AgentFramework;                         // LM-3.02
  readonly version: string;                                   // LM-3.03
  readonly tenantId?: TenantId;                               // LM-3.04
  readonly capabilities: readonly AgentCapability[];          // LM-3.05
  readonly requestedTrustLevel?: AgentTrustLevel;             // LM-3.06: defaults to 'untrusted'
  readonly metadata?: Readonly<Record<string, unknown>>;      // LM-3.07
  readonly owner: UserId | AgentId;                           // LM-3.08: BK-14 fix — proper branded types
}

/** LM-3.42 through LM-3.50: Agent statistics (computed on read, LM-13.22) */
export interface AgentStatistics {
  readonly totalSessions: number;                   // LM-3.42
  readonly totalClaimsAsserted: number;             // LM-3.43
  readonly totalClaimsRetracted: number;            // LM-3.44
  readonly totalMissionsCompleted: number;          // LM-3.45
  readonly totalMissionsFailed: number;             // LM-3.46
  readonly totalGovernanceRefusals: number;         // LM-3.47
  readonly activeTechniques: number;                // LM-3.48
  readonly lastSessionDuration: number | null;      // LM-3.49 (ms)
  readonly averageSessionDuration: number;          // LM-3.50 (ms)
}

/** Core trust level mapping to v4 4-level model (backward compat) */
export type CoreTrustLevel = 'untrusted' | 'probationary' | 'trusted' | 'admin';

/** LM-3.09 through LM-3.25: Registered agent full view */
export interface RegisteredAgent {
  readonly id: AgentId;                                       // LM-3.09
  readonly name: string;                                      // LM-3.10
  readonly framework: AgentFramework;                         // LM-3.11
  readonly version: string;                                   // LM-3.12
  readonly tenantId: TenantId | null;                         // LM-3.13
  readonly state: AgentState;                                 // LM-3.14
  readonly capabilities: AgentCapabilitySet;                  // LM-3.15
  readonly trustLevel: AgentTrustLevel;                       // LM-3.16
  readonly coreTrustLevel: CoreTrustLevel;                    // LM-3.17: derived via S5 mapping
  readonly clearanceLevel: number;                            // LM-3.18: derived via TRUST_TO_CLEARANCE
  readonly owner: UserId | AgentId;                           // LM-3.19: BK-14 fix — proper branded types
  readonly metadata: Readonly<Record<string, unknown>>;       // LM-3.20
  readonly statistics: AgentStatistics;                        // LM-3.21
  readonly registeredAt: string;                              // LM-3.22 (ISO-8601)
  readonly lastActiveAt: string | null;                       // LM-3.23
  readonly decommissionedAt: string | null;                   // LM-3.24
  readonly decommissionReason: string | null;                 // LM-3.25
}

/** LM-3.26 through LM-3.29: Agent state (3-value) */
export type AgentState = 'active' | 'suspended' | 'decommissioned';

/** LM-3.30 through LM-3.33: Mutable agent fields */
export interface AgentUpdate {
  readonly name?: string;                                     // LM-3.30
  readonly version?: string;                                  // LM-3.31
  readonly metadata?: Readonly<Record<string, unknown>>;      // LM-3.32
  // LM-3.33: Trust/clearance NOT changeable via updateAgent
}

/** LM-3.34 through LM-3.41: Agent listing filter */
export interface AgentFilter {
  readonly state?: AgentState | readonly AgentState[];        // LM-3.34
  readonly framework?: AgentFramework;                        // LM-3.35
  readonly tenantId?: TenantId;                               // LM-3.36
  readonly trustLevel?: AgentTrustLevel;                      // LM-3.37
  readonly capability?: AgentCapability;                      // LM-3.38
  readonly owner?: string;                                    // LM-3.39
  readonly limit?: number;                                    // LM-3.40
  readonly offset?: number;                                   // LM-3.41
}

/** LM-3.51 through LM-3.57: Decommission result */
export interface DecommissionResult {
  readonly agentId: AgentId;                  // LM-3.51
  readonly decommissionedAt: string;          // LM-3.52
  readonly claimsPreserved: number;           // LM-3.53
  readonly sessionsTerminated: number;        // LM-3.54
  readonly knowledgeArchived: boolean;         // LM-3.55
  readonly consentsRevoked: number;           // LM-3.56
  readonly capabilitiesRevoked: number;       // LM-3.57
}

// ============================================================================
// Section 3b: Suspension & Reactivation (BK-04, LM-10.04, LM-10.06)
// ============================================================================

/** LM-10.04: Suspension result */
export interface SuspensionResult {
  readonly agentId: AgentId;
  readonly suspendedAt: string;
  readonly reason: string;
  readonly previousState: AgentState;
}

/** LM-10.06: Reactivation result */
export interface ReactivationResult {
  readonly agentId: AgentId;
  readonly reactivatedAt: string;
  readonly previousState: AgentState;
}

// ============================================================================
// Section 4: Capability Management Data Models (LM-4)
// ============================================================================

/** LM-4.03 through LM-4.05: Capability set view */
export interface AgentCapabilitySet {
  readonly granted: readonly AgentCapability[];   // LM-4.03
  readonly denied: readonly AgentCapability[];    // LM-4.04
  readonly pending: readonly AgentCapability[];   // LM-4.05
}

/** LM-4.06 through LM-4.08: Capability upgrade request */
export interface CapabilityRequest {
  readonly capabilities: readonly AgentCapability[];   // LM-4.06
  readonly justification: string;                      // LM-4.07
  readonly evidence?: readonly string[];               // LM-4.08
}

/** LM-4.14 through LM-4.15: Denial detail */
export interface CapabilityDenial {
  readonly capability: AgentCapability;    // LM-4.14
  readonly reason: string;                // LM-4.15
}

/** LM-4.09 through LM-4.13: Capability decision */
export interface CapabilityDecision {
  readonly requestedCapabilities: readonly AgentCapability[];  // LM-4.09
  readonly granted: readonly AgentCapability[];                // LM-4.10
  readonly denied: readonly CapabilityDenial[];                // LM-4.11
  readonly decidedBy: UserId | AgentId | 'system';              // LM-4.12: BK-15 fix — proper typed union
  readonly decidedAt: string;                                  // LM-4.13 (ISO-8601)
}

/** LM-4.16 through LM-4.20: Capability history entry */
export interface CapabilityHistoryEntry {
  readonly capability: AgentCapability;                        // LM-4.16
  readonly action: 'granted' | 'revoked' | 'requested' | 'denied';  // LM-4.17
  readonly reason: string;                                     // LM-4.18
  readonly decidedBy: UserId | AgentId | 'system';              // LM-4.19: BK-15 fix — proper typed union
  readonly timestamp: string;                                  // LM-4.20 (ISO-8601)
}

// ============================================================================
// Section 5: Trust Level & Promotion Data Models (LM-5)
// ============================================================================

/** LM-5.08: Evidence type for trust promotion */
export type TrustPromotionEvidenceType =
  | 'session_count'
  | 'mission_success_rate'
  | 'governance_compliance'
  | 'technique_quality'
  | 'human_endorsement';

/** LM-5.05 through LM-5.07: Trust promotion evidence */
export interface TrustPromotionEvidence {
  readonly type: TrustPromotionEvidenceType;   // LM-5.05
  readonly value: number | string;             // LM-5.06
  readonly description: string;                // LM-5.07
}

/** LM-5.02 through LM-5.04: Promotion request */
export interface PromotionRequest {
  readonly targetLevel: AgentTrustLevel;                       // LM-5.02
  readonly justification: string;                              // LM-5.03
  readonly evidence: readonly TrustPromotionEvidence[];        // LM-5.04
}

/** LM-5.09 through LM-5.14: Trust promotion result */
export interface TrustPromotionResult {
  readonly agentId: AgentId;                                   // LM-5.09
  readonly previousLevel: AgentTrustLevel;                     // LM-5.10
  readonly newLevel: AgentTrustLevel;                          // LM-5.11
  readonly capabilitiesUnlocked: readonly AgentCapability[];   // LM-5.12
  readonly decidedBy: UserId | AgentId | 'system';              // LM-5.13: BK-15 fix — proper typed union
  readonly decidedAt: string;                                  // LM-5.14 (ISO-8601)
}

/** LM-5.15 through LM-5.21: Demotion result */
export interface DemotionResult {
  readonly agentId: AgentId;                                   // LM-5.15
  readonly previousLevel: AgentTrustLevel;                     // LM-5.16
  readonly newLevel: AgentTrustLevel;                          // LM-5.17
  readonly capabilitiesRevoked: readonly AgentCapability[];    // LM-5.18
  readonly reason: string;                                     // LM-5.19
  readonly decidedBy: UserId | AgentId | 'system';              // LM-5.20: BK-15 fix — proper typed union
  readonly decidedAt: string;                                  // LM-5.21 (ISO-8601)
}

// ============================================================================
// Section 6: Consent Governance Data Models (LM-6)
// ============================================================================

/** LM-6.09: Consent status */
export type ConsentStatus = 'active' | 'revoked' | 'expired';

/** LM-6.10 through LM-6.12: Consent scope definition */
export interface ConsentScope {
  readonly predicateDomains?: readonly string[];               // LM-6.10
  readonly classificationMax?: ClassificationLevel;            // LM-6.11
  readonly operations?: readonly ConsentableOperation[];       // LM-6.12
}

/** LM-6.01 through LM-6.08: Agent consent record */
export interface AgentConsentRecord {
  readonly id?: ConsentId;                     // LM-6.01: assigned on registration
  readonly agentId: AgentId;                   // LM-6.02
  readonly dataSubject: string;                // LM-6.03
  readonly purpose: ConsentPurpose;            // LM-6.04
  readonly scope: ConsentScope;                // LM-6.05
  readonly grantedAt: string;                  // LM-6.06 (ISO-8601)
  readonly expiresAt: string | null;           // LM-6.07
  readonly status: ConsentStatus;              // LM-6.08
}

/** LM-6.13 through LM-6.16: Consent check decision */
export interface ConsentDecision {
  readonly allowed: boolean;                   // LM-6.13
  readonly consentId: ConsentId | null;        // LM-6.14
  readonly reason: string;                     // LM-6.15
  readonly expiresAt: string | null;           // LM-6.16
}

/** LM-6.17 through LM-6.21: Consent revocation result */
export interface ConsentRevocationResult {
  readonly consentId: ConsentId;               // LM-6.17
  readonly revokedAt: string;                  // LM-6.18
  readonly claimsAffected: number;             // LM-6.19
  readonly transfersBlocked: number;           // LM-6.20
  readonly cascadeActions: readonly string[];  // LM-6.21
}

// ============================================================================
// Section 7: Knowledge Exchange Data Models (LM-7)
// ============================================================================

/** LM-7.07: Knowledge format */
export type KnowledgeFormat = 'limen_native' | 'json_ld' | 'rdf_turtle';

/** LM-7.43: Conflict resolution strategy */
export type ConflictStrategy = 'skip' | 'override' | 'merge' | 'branch';

/** LM-7.01 through LM-7.06: Export options */
export interface KnowledgeExportOptions {
  readonly domains?: readonly string[];            // LM-7.01
  readonly minConfidence?: number;                 // LM-7.02
  readonly includeTechniques?: boolean;            // LM-7.03
  readonly includeRelationships?: boolean;         // LM-7.04
  readonly format: KnowledgeFormat;                // LM-7.05
  readonly classification?: ClassificationLevel;   // LM-7.06
}

/** LM-7.17 through LM-7.21: Package metadata */
export interface KnowledgePackageMetadata {
  readonly claimCount: number;                     // LM-7.17
  readonly techniqueCount: number;                 // LM-7.18
  readonly relationshipCount: number;              // LM-7.19
  readonly domains: readonly string[];             // LM-7.20
  readonly classificationMax: ClassificationLevel; // LM-7.21
}

/** LM-7.22 through LM-7.29: Exported claim */
export interface ExportedClaim {
  readonly originalId: ClaimId;                    // LM-7.22
  readonly subject: string;                        // LM-7.23
  readonly predicate: string;                      // LM-7.24
  readonly value: unknown;                         // LM-7.25
  readonly confidence: number;                     // LM-7.26
  readonly classification: ClassificationLevel;    // LM-7.27
  readonly reasoning: string | null;               // LM-7.28
  readonly createdAt: string;                      // LM-7.29
}

/** LM-7.30 through LM-7.35: Exported technique */
export interface ExportedTechnique {
  readonly originalId: ClaimId;                    // LM-7.30
  readonly description: string;                    // LM-7.31
  readonly domain: string;                         // LM-7.32
  readonly status: TGPTechniqueStatus;                        // LM-7.33: BK-18 fix — canonical type
  readonly successRate: number;                    // LM-7.34
  readonly evaluationCount: number;                // LM-7.35
}

/** LM-7.36 through LM-7.38: Exported relationship */
export interface ExportedRelationship {
  readonly fromClaimOriginalId: ClaimId;           // LM-7.36
  readonly toClaimOriginalId: ClaimId;             // LM-7.37
  readonly type: RelationshipType;                 // LM-7.38
}

/** LM-7.08 through LM-7.16: Knowledge package */
export interface KnowledgePackage {
  readonly id: KnowledgePackageId;                 // LM-7.08
  readonly sourceAgentId: AgentId;                 // LM-7.09
  readonly exportedAt: string;                     // LM-7.10
  readonly format: KnowledgeFormat;                // LM-7.11
  readonly claims: readonly ExportedClaim[];        // LM-7.12
  readonly techniques: readonly ExportedTechnique[]; // LM-7.13
  readonly relationships: readonly ExportedRelationship[];  // LM-7.14
  readonly metadata: KnowledgePackageMetadata;     // LM-7.15
  readonly checksum: string;                       // LM-7.16 (SHA-256)
}

/** LM-7.39 through LM-7.47: Import options */
export interface KnowledgeImportOptions {
  readonly conflictStrategy: ConflictStrategy;     // LM-7.39
  readonly confidenceCap?: number;                 // LM-7.40: default 0.5
  readonly classification?: ClassificationLevel;   // LM-7.41
  readonly validateIntegrity?: boolean;            // LM-7.42: default true
}

/** LM-7.48 through LM-7.54: Import result */
export interface KnowledgeImportResult {
  readonly imported: number;                       // LM-7.48
  readonly skipped: number;                        // LM-7.49
  readonly conflicts: number;                      // LM-7.50
  readonly branchCreated: boolean;                 // LM-7.51
  readonly branchId: string | null;                // LM-7.52
  readonly newClaimIds: readonly ClaimId[];         // LM-7.53
  readonly duration: number;                       // LM-7.54 (ms)
}

/** LM-7.55 through LM-7.58: Transfer options */
export interface KnowledgeTransferOptions {
  readonly domains?: readonly string[];            // LM-7.55
  readonly includeTechniques?: boolean;            // LM-7.56
  readonly confidenceCap?: number;                 // LM-7.57: default 0.5
  readonly consentPurpose?: ConsentPurpose;        // LM-7.58: default 'knowledge_transfer'
}

/** LM-7.59 through LM-7.66: Transfer result */
export interface KnowledgeTransferResult {
  readonly fromAgentId: AgentId;                   // LM-7.59
  readonly toAgentId: AgentId;                     // LM-7.60
  readonly transferred: number;                    // LM-7.61
  readonly skipped: number;                        // LM-7.62
  readonly conflicts: number;                      // LM-7.63
  readonly newClaimIds: readonly ClaimId[];         // LM-7.64
  readonly transferredAt: string;                  // LM-7.65
  readonly consentId: ConsentId | null;            // LM-7.66
}

// ============================================================================
// AgentLifecycleClient Interface (LM-2)
// ============================================================================

/** LM-2.01 through LM-2.22: Full lifecycle client interface */
export interface AgentLifecycleClient {
  // Registration & Identity (LM-2.01 through LM-2.05)
  registerAgent(ctx: OperationContext, spec: AgentRegistrationSpec): Promise<Result<RegisteredAgent>>;
  getAgent(agentId: AgentId): Promise<Result<RegisteredAgent>>;
  listAgents(filter?: AgentFilter): Promise<Result<readonly RegisteredAgent[]>>;
  updateAgent(ctx: OperationContext, agentId: AgentId, update: AgentUpdate): Promise<Result<RegisteredAgent>>;
  decommissionAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DecommissionResult>>;

  // Suspension & Reactivation (BK-04: LM-10.04, LM-10.06, LM-8.04, LM-8.05)
  suspendAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<SuspensionResult>>;
  reactivateAgent(ctx: OperationContext, agentId: AgentId): Promise<Result<ReactivationResult>>;

  // Capability Management (LM-2.06 through LM-2.09)
  requestCapabilityUpgrade(ctx: OperationContext, agentId: AgentId, request: CapabilityRequest): Promise<Result<CapabilityDecision>>;
  revokeCapability(ctx: OperationContext, agentId: AgentId, capability: AgentCapability, reason: string): Promise<Result<void>>;
  getCapabilities(agentId: AgentId): Promise<Result<AgentCapabilitySet>>;
  getCapabilityHistory(agentId: AgentId): Promise<Result<readonly CapabilityHistoryEntry[]>>;

  // Trust Promotion (LM-2.10 through LM-2.12)
  promoteAgent(ctx: OperationContext, agentId: AgentId, request: PromotionRequest): Promise<Result<TrustPromotionResult>>;
  demoteAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DemotionResult>>;
  getTrustLevel(agentId: AgentId): Promise<Result<AgentTrustLevel>>;

  // Consent Governance (LM-2.13 through LM-2.16)
  registerConsent(ctx: OperationContext, agentId: AgentId, consent: AgentConsentRecord): Promise<Result<ConsentId>>;
  revokeConsent(ctx: OperationContext, consentId: ConsentId, reason: string): Promise<Result<ConsentRevocationResult>>;
  checkConsent(agentId: AgentId, operation: ConsentableOperation): Promise<Result<ConsentDecision>>;
  listConsents(agentId: AgentId): Promise<Result<readonly AgentConsentRecord[]>>;

  // Knowledge Exchange (LM-2.17 through LM-2.19)
  exportKnowledge(ctx: OperationContext, agentId: AgentId, options: KnowledgeExportOptions): Promise<Result<KnowledgePackage>>;
  importKnowledge(ctx: OperationContext, agentId: AgentId, pkg: KnowledgePackage, options?: KnowledgeImportOptions): Promise<Result<KnowledgeImportResult>>;
  transferKnowledge(ctx: OperationContext, fromAgentId: AgentId, toAgentId: AgentId, options: KnowledgeTransferOptions): Promise<Result<KnowledgeTransferResult>>;

  // Events (LM-2.20 through LM-2.22)
  on(event: AgentEvent, handler: AgentEventHandler): string;
  off(subscriptionId: string): void;
}
