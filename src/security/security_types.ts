/**
 * Phase 9: Security Hardening — Type Definitions
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 2)
 * Invariants: I-P9-01 through I-P9-51
 * DCs: DC-P9-101 through DC-P9-903
 *
 * All types for PII detection, prompt injection defense, consent tracking,
 * poisoning defense, and security policy configuration.
 *
 * NO implementation logic. Pure type definitions.
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { DatabaseConnection, OperationContext } from '../kernel/interfaces/index.js';

// ── PII Detection ──

/** PII categories detected by the scanner */
export type PiiCategory =
  | 'email'           // RFC 5322 pattern
  | 'phone'           // International phone patterns
  | 'ssn'             // US Social Security Number
  | 'credit_card'     // Luhn-validated card numbers
  | 'ip_address';     // IPv4

/**
 * A single PII detection result.
 * I-P9-02: MUST NOT store matched text. Only category, field, offset, length, confidence.
 */
export interface PiiMatch {
  readonly category: PiiCategory;
  readonly field: 'subject' | 'predicate' | 'objectValue';
  readonly offset: number;         // character offset in the field
  readonly length: number;         // matched length
  readonly confidence: number;     // 0.0-1.0 detection confidence
}

/** Result of scanning claim content for PII */
export interface PiiScanResult {
  readonly hasPii: boolean;
  readonly matches: readonly PiiMatch[];
  readonly categories: readonly PiiCategory[];  // deduplicated
}

/** Action to take when PII is detected */
export type PiiAction = 'tag' | 'warn' | 'reject';

// ── Prompt Injection Defense ──

/** Prompt injection severity level */
export type InjectionSeverity = 'none' | 'low' | 'medium' | 'high';

/** Prompt injection detection result */
export interface InjectionScanResult {
  readonly detected: boolean;
  readonly patterns: readonly string[];    // which patterns matched (names, NOT content)
  readonly severity: InjectionSeverity;
}

// ── Content Scan ──

/** Combined content scan result */
export interface ContentScanResult {
  readonly pii: PiiScanResult;
  readonly injection: InjectionScanResult;
  readonly scannedAt: string;              // ISO 8601
}

// ── Consent ──

/** Consent basis (GDPR Article 6) */
export type ConsentBasis =
  | 'explicit_consent'     // Article 6(1)(a)
  | 'contract_performance' // Article 6(1)(b)
  | 'legal_obligation'     // Article 6(1)(c)
  | 'legitimate_interest'; // Article 6(1)(f)

/** Consent status */
export type ConsentStatus = 'active' | 'revoked' | 'expired';

/** Consent record for a data subject */
export interface ConsentRecord {
  readonly id: string;                     // UUID
  readonly tenantId: string | null;
  readonly dataSubjectId: string;          // Who gave consent
  readonly basis: ConsentBasis;
  readonly scope: string;                  // What was consented to
  readonly grantedAt: string;              // ISO 8601
  readonly expiresAt: string | null;       // ISO 8601 or null (indefinite)
  readonly revokedAt: string | null;       // ISO 8601 or null (active)
  readonly status: ConsentStatus;
  readonly createdAt: string;              // ISO 8601
}

export interface ConsentCreateInput {
  readonly dataSubjectId: string;
  readonly basis: ConsentBasis;
  readonly scope: string;
  readonly expiresAt?: string;             // ISO 8601
}

// ── Poisoning Defense ──

/** Per-agent claim assertion statistics */
export interface AgentClaimStats {
  readonly agentId: string;
  readonly windowStart: string;            // ISO 8601
  readonly claimsInWindow: number;
  readonly uniqueSubjects: number;
}

/** Poisoning defense verdict */
export interface PoisoningVerdict {
  readonly allowed: boolean;
  readonly reason?: string;                // Why blocked
  readonly stats: AgentClaimStats;
}

// ── Security Policy Configuration ──

export interface SecurityPolicy {
  readonly pii: {
    readonly enabled: boolean;
    readonly action: PiiAction;              // default: 'tag'
    readonly categories: readonly PiiCategory[];  // which to detect
  };
  readonly injection: {
    readonly enabled: boolean;
    readonly action: 'tag' | 'warn' | 'reject';  // default: 'warn'
  };
  readonly poisoning: {
    readonly enabled: boolean;
    readonly burstLimit: number;              // max claims per window
    readonly windowSeconds: number;           // sliding window duration
    readonly subjectDiversityMin: number;     // min unique subjects in window
  };
}

/** Default security policy — I-P9-50: non-breaking defaults */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  pii: {
    enabled: true,
    action: 'tag',
    categories: ['email', 'phone', 'ssn', 'credit_card', 'ip_address'],
  },
  injection: {
    enabled: true,
    action: 'warn',
  },
  poisoning: {
    enabled: true,
    burstLimit: 100,          // 100 claims per window
    windowSeconds: 60,        // 60-second sliding window
    subjectDiversityMin: 3,   // must assert about >= 3 different subjects
  },
};

// ── Error Codes ──

export type SecurityErrorCode =
  | 'PII_DETECTED_REJECT'       // PII found, policy = reject
  | 'INJECTION_DETECTED_REJECT' // Prompt injection found, policy = reject
  | 'POISONING_BURST_LIMIT'     // Agent exceeded burst claim rate
  | 'POISONING_LOW_DIVERSITY'   // Agent asserting about too few subjects
  | 'CONSENT_NOT_FOUND'         // Consent record not found
  | 'CONSENT_EXPIRED'           // Consent has expired
  | 'CONSENT_ALREADY_REVOKED'   // Consent already revoked
  | 'CONSENT_INVALID_INPUT';    // Invalid consent input

// ── Consent Registry Interface ──

export interface ConsentRegistry {
  register(conn: DatabaseConnection, ctx: OperationContext, input: ConsentCreateInput): Result<ConsentRecord>;
  revoke(conn: DatabaseConnection, ctx: OperationContext, id: string): Result<ConsentRecord>;
  check(conn: DatabaseConnection, ctx: OperationContext, dataSubjectId: string, scope: string): Result<ConsentRecord | null>;
  list(conn: DatabaseConnection, ctx: OperationContext, dataSubjectId: string): Result<readonly ConsentRecord[]>;
}

// ── Valid Consent Bases (for validation) ──

export const VALID_CONSENT_BASES: readonly ConsentBasis[] = [
  'explicit_consent',
  'contract_performance',
  'legal_obligation',
  'legitimate_interest',
];
