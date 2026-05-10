// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * ST-19: Operation-Level Consent Gate
 *
 * This module provides the consent interception layer between adapters/APIs
 * and the persistence layer. It determines whether consent is required for
 * an operation and, if so, queries the Phase 9 ConsentRegistry for active consent.
 *
 * Contract requirements: ST-19.01 through ST-19.14
 *
 * Architecture:
 * - Types (ConsentableOperation, ConsentPurpose, etc.) live in shared types (S19)
 * - This module provides the CHECK LOGIC — it uses the Phase 9 ConsentRegistry
 * - The ConsentRegistry is NOT modified — it remains the GDPR CRUD layer
 *
 * Invariants:
 * - ST-19.08: granted=true requires consentId present
 * - ST-19.09: dataSubjectId=null requires non-personal-data operation
 * - ST-19.10: Consent checks run BEFORE persistence or export
 * - T7: Fail-closed when consent required but registry unavailable
 *
 * Defect classes addressed:
 * - DC-LOGIC: predicate pattern matching false negatives → exact prefix match
 * - DC-SECURITY: fail-open bypass → fail-closed when registry unavailable
 * - DC-DATA: consentId/granted invariant violation → enforced in buildContext
 */

import type { DatabaseConnection, OperationContext } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { ClassificationLevel } from '../adapters/shared/types.js';
import type {
  AgentId, TenantId, ConsentId,
  ConsentableOperation, ConsentPurpose,
} from '../adapters/shared/types.js';

/**
 * ST-19.08: Consent gate decision context.
 * Produced by checkConsentGate() and consumed by callers to decide whether
 * to proceed with an operation that requires consent.
 *
 * Invariants:
 * - granted=true requires consentId to be non-null
 * - granted=false requires consentId to be null
 */
export interface ConsentContext {
  readonly agentId: AgentId;
  readonly tenantId: TenantId | null;
  readonly dataSubjectId: string;
  readonly operation: ConsentableOperation;
  readonly purpose: ConsentPurpose;
  readonly consentId: ConsentId | null;
  readonly granted: boolean;
  readonly checkedAt: string;
}
import type { ConsentRegistry } from './security_types.js';

// ============================================================================
// Personal Data Predicate Detection (ST-19.05)
// ============================================================================

/**
 * Predicate prefixes that indicate personal data content.
 * ST-19.05: personal.*, user.*, identity.*
 *
 * Using exact prefix match with dot separator to prevent false positives
 * (e.g., "personality.trait" should NOT match "personal.*" — it starts with
 * "personality", not "personal.").
 */
const PERSONAL_DATA_PREDICATE_PREFIXES: readonly string[] = [
  'personal.',
  'user.',
  'identity.',
];

/**
 * Determine if a predicate indicates personal data content.
 * ST-19.05: Triggers consent check for personal.*, user.*, identity.* predicates.
 *
 * @param predicate - The claim predicate to check
 * @returns true if the predicate matches a personal data pattern
 */
export function isPersonalDataPredicate(predicate: string | undefined): boolean {
  if (!predicate || typeof predicate !== 'string') return false;
  return PERSONAL_DATA_PREDICATE_PREFIXES.some(prefix => predicate.startsWith(prefix));
}

// ============================================================================
// Classification-Based Trigger (ST-19.06)
// ============================================================================

/**
 * Classification levels that trigger consent requirements.
 * ST-19.06: restricted and critical classifications require consent.
 */
const CONSENT_REQUIRED_CLASSIFICATIONS: ReadonlySet<ClassificationLevel> = new Set([
  'restricted',
  'critical',
]);

/**
 * Determine if a classification level requires consent.
 * ST-19.06: restricted and critical trigger consent check.
 *
 * @param classification - The classification level
 * @returns true if consent is required for this classification
 */
export function isConsentRequiredClassification(
  classification: ClassificationLevel | undefined,
): boolean {
  if (!classification) return false;
  return CONSENT_REQUIRED_CLASSIFICATIONS.has(classification);
}

// ============================================================================
// Consent Requirement Detection (ST-19.05, ST-19.06, ST-19.07)
// ============================================================================

/** Content descriptor passed to the consent gate for trigger evaluation. */
export interface ConsentCheckContent {
  readonly subject?: string;
  readonly predicate?: string;
  readonly classification?: ClassificationLevel;
  readonly dataSubjectId?: string;
}

/**
 * Determine whether an operation requires a consent check.
 *
 * ST-19.05: Personal data predicate triggers
 * ST-19.06: Classification triggers (restricted, critical)
 * ST-19.07: Data subject operation triggers
 *
 * @returns The detected operation type, or null if no consent check needed
 */
export function detectConsentRequirement(
  content: ConsentCheckContent,
): { operation: ConsentableOperation; dataSubjectId: string } | null {
  // ST-19.07: Agent operating on behalf of a data subject
  // If dataSubjectId is explicitly provided, consent is always required
  if (content.dataSubjectId && content.dataSubjectId.trim().length > 0) {
    const operation = resolveOperation(content);
    return { operation, dataSubjectId: content.dataSubjectId };
  }

  // ST-19.05: Personal data predicate detection
  if (isPersonalDataPredicate(content.predicate)) {
    // Extract data subject from the subject URN (entity:type:id → type:id)
    const entityId = extractEntityIdFromSubject(content.subject);
    if (entityId !== null) {
      return { operation: 'store_personal_data', dataSubjectId: entityId };
    }
    // Personal predicate without entity subject — still requires consent
    // but we cannot determine the data subject. Fail-closed: require consent
    // but the caller must provide dataSubjectId or the check will deny.
    return { operation: 'store_personal_data', dataSubjectId: '__unknown__' };
  }

  // ST-19.06: Classification-based trigger
  if (isConsentRequiredClassification(content.classification)) {
    const entityId = extractEntityIdFromSubject(content.subject);
    if (entityId !== null) {
      return { operation: 'collect_analytics', dataSubjectId: entityId };
    }
    // Restricted/critical without entity subject — no data subject to check against
    // This is a non-personal classified operation; no consent gate needed
    return null;
  }

  return null;
}

/**
 * Resolve the ConsentableOperation from content characteristics.
 * When a dataSubjectId is present, we look at the predicate and classification
 * to determine the most specific operation type.
 */
function resolveOperation(content: ConsentCheckContent): ConsentableOperation {
  if (isPersonalDataPredicate(content.predicate)) return 'store_personal_data';
  if (isConsentRequiredClassification(content.classification)) return 'collect_analytics';
  return 'store_personal_data';
}

/**
 * Extract entity ID from a subject URN.
 * Format: entity:<type>:<id> → returns <type>:<id>
 * Returns null for non-entity subjects.
 */
function extractEntityIdFromSubject(subject: string | undefined): string | null {
  if (!subject || typeof subject !== 'string') return null;
  const parts = subject.split(':');
  if (parts.length < 3 || parts[0] !== 'entity') return null;
  return parts.slice(1).join(':');
}

// ============================================================================
// Consent Gate (ST-19.10, ST-19.11)
// ============================================================================

/** Dependencies for the consent gate. */
export interface ConsentGateDeps {
  readonly consentRegistry: ConsentRegistry | null;
  readonly time: TimeProvider;
  /** Consent scope to check against in the registry. Default: 'claim_assertion'. */
  readonly consentScope?: string;
}

/**
 * Check consent for an operation.
 *
 * ST-19.10: Runs BEFORE persistence or export.
 * ST-19.11: Returns granted=false and blocks when no active consent exists.
 * T7: Fail-closed when registry unavailable.
 *
 * @param conn - Database connection for consent registry lookup
 * @param ctx - Operation context (agent, tenant)
 * @param content - Content descriptor for trigger evaluation
 * @param deps - Consent gate dependencies
 * @returns ConsentContext with the gate decision, or null if no consent check needed
 */
export function checkConsentGate(
  conn: DatabaseConnection,
  ctx: OperationContext,
  content: ConsentCheckContent,
  deps: ConsentGateDeps,
): ConsentContext | null {
  // Detect whether this operation requires consent
  const requirement = detectConsentRequirement(content);
  if (requirement === null) {
    // No consent trigger — operation may proceed without consent check
    return null;
  }

  const now = deps.time.nowISO();
  const agentId = ctx.agentId ?? ('__system__' as AgentId);
  const tenantId = ctx.tenantId ?? null;

  // T7: Fail-closed when consent required but registry unavailable
  if (!deps.consentRegistry) {
    return buildDeniedContext(
      agentId, tenantId, requirement.dataSubjectId,
      requirement.operation, 'memory_storage', now,
    );
  }

  // Query the Phase 9 ConsentRegistry for active consent
  const scope = deps.consentScope ?? 'claim_assertion';
  const consentResult = deps.consentRegistry.check(
    conn, ctx, requirement.dataSubjectId, scope,
  );

  // Registry error → fail-closed
  if (!consentResult.ok) {
    return buildDeniedContext(
      agentId, tenantId, requirement.dataSubjectId,
      requirement.operation, 'memory_storage', now,
    );
  }

  // No active consent found → denied
  if (consentResult.value === null) {
    return buildDeniedContext(
      agentId, tenantId, requirement.dataSubjectId,
      requirement.operation, 'memory_storage', now,
    );
  }

  // Active consent found → granted
  // ST-19.08: granted=true requires consentId present
  return {
    agentId,
    tenantId,
    dataSubjectId: requirement.dataSubjectId,
    operation: requirement.operation,
    purpose: 'memory_storage',
    consentId: consentResult.value.id as ConsentId,
    granted: true,
    checkedAt: now,
  };
}

/**
 * Build a denied ConsentContext.
 * ST-19.08: granted=false → consentId is null.
 */
function buildDeniedContext(
  agentId: AgentId,
  tenantId: TenantId | null,
  dataSubjectId: string,
  operation: ConsentableOperation,
  purpose: ConsentPurpose,
  checkedAt: string,
): ConsentContext {
  return {
    agentId,
    tenantId,
    dataSubjectId,
    operation,
    purpose,
    consentId: null,
    granted: false,
    checkedAt,
  };
}
