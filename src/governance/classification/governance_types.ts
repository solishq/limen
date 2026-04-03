/**
 * Phase 10: Governance Suite — Type Definitions
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 2)
 * Criticality: Tier 1 (governance, authorization, compliance)
 *
 * Types for:
 *   - Classification levels and rules (10.1, 10.2)
 *   - Protected predicate rules (10.3)
 *   - GDPR erasure request and certificate (10.4)
 *   - SOC 2 audit export (10.5)
 *   - Governance configuration
 *   - Error codes
 *
 * No implementation logic. Pure type definitions.
 */

import type { Permission } from '../../kernel/interfaces/common.js';
import type { AuditEntry, ChainVerification } from '../../kernel/interfaces/audit.js';

// ── Classification ──

/** Information classification levels — ordered by sensitivity */
export type ClassificationLevel =
  | 'unrestricted'          // Public information
  | 'internal'              // Internal use only
  | 'confidential'          // Business confidential
  | 'restricted'            // Legally restricted / PII / PHI
  | 'critical';             // Highest sensitivity — crypto keys, auth tokens

/** Level ordering for most-restrictive comparison. Higher = more restrictive. */
export const CLASSIFICATION_LEVEL_ORDER: Record<ClassificationLevel, number> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
};

/** A classification rule — maps predicate patterns to levels */
export interface ClassificationRule {
  readonly id: string;                // UUID
  readonly predicatePattern: string;  // Glob pattern: "preference.*", "medical.*"
  readonly level: ClassificationLevel;
  readonly reason: string;            // Why this classification
  readonly createdAt: string;         // ISO 8601
}

/**
 * Default classification rules — built into the engine.
 * Applied when no custom rules override for a given predicate.
 * Omit id and createdAt — assigned at runtime when persisted.
 */
export const DEFAULT_CLASSIFICATION_RULES: readonly Omit<ClassificationRule, 'id' | 'createdAt'>[] = [
  { predicatePattern: 'preference.*', level: 'confidential', reason: 'User preferences are personal data' },
  { predicatePattern: 'medical.*', level: 'restricted', reason: 'Medical data is legally restricted' },
  { predicatePattern: 'health.*', level: 'restricted', reason: 'Health data is legally restricted' },
  { predicatePattern: 'financial.*', level: 'restricted', reason: 'Financial data is sensitive' },
  { predicatePattern: 'decision.*', level: 'internal', reason: 'Architectural decisions are internal' },
  { predicatePattern: 'system.*', level: 'internal', reason: 'System-level information is internal' },
  { predicatePattern: 'credential.*', level: 'critical', reason: 'Credentials require highest protection' },
  { predicatePattern: 'auth.*', level: 'critical', reason: 'Authentication data requires highest protection' },
];

/** Result of classifying a claim */
export interface ClassificationResult {
  readonly level: ClassificationLevel;
  readonly matchedRule: string | null;  // Rule ID that matched, null = default
  readonly autoClassified: boolean;     // true = matched a rule, false = default
}

// ── Protected Predicates ──

/** A protected predicate rule — requires specific permission to assert/retract */
export interface ProtectedPredicateRule {
  readonly id: string;
  readonly predicatePattern: string;   // Glob: "system.*", "governance.*"
  readonly requiredPermission: Permission;
  readonly action: 'assert' | 'retract' | 'both';
  readonly createdAt: string;
}

// ── GDPR Erasure ──

/** Input for erasure request */
export interface ErasureRequest {
  readonly dataSubjectId: string;   // Who requested erasure
  readonly reason: string;          // GDPR Article 17 basis
  readonly includeRelated: boolean; // Cascade through derived_from chains
}

/** Erasure certificate — proof of erasure */
export interface ErasureCertificate {
  readonly id: string;                        // UUID
  readonly dataSubjectId: string;
  readonly requestedAt: string;               // ISO 8601
  readonly completedAt: string;               // ISO 8601
  readonly claimsTombstoned: number;
  readonly auditEntriesTombstoned: number;
  readonly relationshipsCascaded: number;
  readonly consentRecordsRevoked: number;
  readonly chainVerification: {
    readonly valid: boolean;
    readonly headHash: string;
  };
  readonly certificateHash: string;           // SHA-256 of certificate content
}

// ── SOC 2 Export ──

/** SOC 2 audit export format */
export interface Soc2AuditPackage {
  readonly version: '1.0.0';
  readonly generatedAt: string;
  readonly period: { readonly from: string; readonly to: string };
  readonly controls: {
    readonly accessControl: Soc2ControlEvidence;
    readonly changeManagement: Soc2ControlEvidence;
    readonly dataIntegrity: Soc2ControlEvidence;
    readonly auditLogging: Soc2ControlEvidence;
  };
  readonly chainVerification: ChainVerification;
  readonly statistics: Soc2Statistics;
}

export interface Soc2ControlEvidence {
  readonly controlId: string;
  readonly description: string;
  readonly evidenceEntries: readonly AuditEntry[];
  readonly compliant: boolean;
  readonly notes: string;
}

export interface Soc2Statistics {
  readonly totalAuditEntries: number;
  readonly uniqueActors: number;
  readonly operationBreakdown: Record<string, number>;
  readonly chainIntegrity: boolean;
}

// ── SOC 2 Export Options ──

export interface ComplianceExportOptions {
  readonly from: string;  // ISO 8601 period start
  readonly to: string;    // ISO 8601 period end
}

// ── Governance Configuration ──

export interface GovernanceConfig {
  readonly classification: {
    readonly enabled: boolean;
    readonly defaultLevel: ClassificationLevel;
    readonly rules: readonly ClassificationRule[];
  };
  readonly protectedPredicates: {
    readonly enabled: boolean;
    readonly rules: readonly ProtectedPredicateRule[];
  };
}

// ── Error Codes ──

export type GovernanceErrorCode =
  | 'CLASSIFICATION_RULE_CONFLICT'      // Overlapping rules
  | 'PROTECTED_PREDICATE_UNAUTHORIZED'  // Missing required permission
  | 'ERASURE_NO_CLAIMS_FOUND'           // No PII claims for data subject
  | 'ERASURE_CHAIN_INTEGRITY_FAILED'    // Hash chain broke during erasure
  | 'EXPORT_PERIOD_INVALID'             // Invalid time range
  | 'EXPORT_NO_ENTRIES';                // No audit entries in period
