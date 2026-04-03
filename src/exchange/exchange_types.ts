/**
 * Phase 8 Import/Export Type Definitions.
 *
 * Spec refs: LIMEN_BUILD_PHASES.md (8.3, 8.4)
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 2)
 *
 * Defines the interchange format for Limen knowledge.
 * JSON is the canonical format — CSV is a lossy projection.
 */

// ── Export Types ──

/** Supported export formats */
export type ExportFormat = 'json' | 'csv';

/** Export options */
export interface ExportOptions {
  /** Output format. Default: 'json'. */
  readonly format: ExportFormat;
  /** Filter by subject pattern (prefix match). Default: all. */
  readonly subject?: string;
  /** Filter by predicate pattern (prefix match). Default: all. */
  readonly predicate?: string;
  /** Filter by status. Default: 'active' only. */
  readonly status?: 'active' | 'retracted' | 'all';
  /** Include relationships. Default: true for json, false for csv. */
  readonly includeRelationships?: boolean;
  /** Include evidence references. Default: true for json, false for csv. */
  readonly includeEvidence?: boolean;
  /** Pretty-print JSON. Default: true. */
  readonly pretty?: boolean;
}

/**
 * The canonical JSON export format.
 * This is the interchange standard.
 *
 * I-P8-24: version is always '1.0.0'.
 */
export interface LimenExportDocument {
  /** Format version for forward compatibility */
  readonly version: '1.0.0';
  /** Export metadata */
  readonly metadata: ExportMetadata;
  /** Exported claims */
  readonly claims: readonly ExportedClaim[];
  /** Exported relationships (if includeRelationships) */
  readonly relationships: readonly ExportedRelationship[];
}

export interface ExportMetadata {
  /** ISO 8601 export timestamp */
  readonly exportedAt: string;
  /** Limen version that produced the export */
  readonly limenVersion: string;
  /** Total claim count */
  readonly claimCount: number;
  /** Total relationship count */
  readonly relationshipCount: number;
}

export interface ExportedClaim {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly objectType: string;
  readonly objectValue: string;
  readonly confidence: number;
  readonly validAt: string;
  readonly createdAt: string;
  readonly status: 'active' | 'retracted';
  readonly groundingMode: 'evidence_path' | 'runtime_witness';
  /** Phase 3: Stability value in days */
  readonly stability: number | null;
  /** Phase 5: Reasoning text */
  readonly reasoning: string | null;
  /** Phase 9: PII detected flag (v1.5.0+, optional for backward compat) */
  readonly piiDetected?: number | null;
  /** Phase 9: PII categories JSON (v1.5.0+, optional for backward compat) */
  readonly piiCategories?: string | null;
  /** Phase 10: Classification level (v1.5.0+, optional for backward compat) */
  readonly classification?: string | null;
  /** Evidence references (if includeEvidence) */
  readonly evidenceRefs?: readonly ExportedEvidenceRef[];
}

export interface ExportedEvidenceRef {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly label: string | null;
}

export interface ExportedRelationship {
  readonly fromClaimId: string;
  readonly toClaimId: string;
  readonly type: string;
  readonly createdAt: string;
}

// ── Import Types ──

/** Import options */
export interface ImportOptions {
  /** Deduplication strategy. Default: 'by_content'. */
  readonly dedup?: ImportDedup;
  /** Dry run — report what would be imported without writing. Default: false. */
  readonly dryRun?: boolean;
  /** Conflict resolution for duplicates. Default: 'skip'. */
  readonly onConflict?: 'skip' | 'update' | 'error';
}

/**
 * Deduplication strategy for import.
 *
 * 'by_content': Skip claims with same subject+predicate+objectValue+status.
 *               Semantically correct. DEFAULT.
 *
 * 'none': Import everything. No dedup. Risk of duplicates.
 */
export type ImportDedup = 'by_content' | 'none';

/** Import result */
export interface ImportResult {
  /** Claims successfully imported */
  readonly imported: number;
  /** Claims skipped (dedup match) */
  readonly skipped: number;
  /** Claims that failed to import */
  readonly failed: number;
  /** Relationships imported */
  readonly relationshipsImported: number;
  /** Relationships skipped (missing claim references) */
  readonly relationshipsSkipped: number;
  /** Details of failures */
  readonly errors: readonly ImportError[];
  /** ID mapping: old ID -> new ID (for relationship rebinding) */
  readonly idMap: ReadonlyMap<string, string>;
}

export interface ImportError {
  readonly claimIndex: number;
  readonly claimId: string;
  readonly reason: string;
}

// ── CSV Column Spec ──

/**
 * CSV export columns (ordered).
 * CSV is a lossy projection — no evidence refs, no relationships.
 * DC-P8-105: Documented as lossy.
 */
export const CSV_COLUMNS = [
  'id', 'subject', 'predicate', 'objectType', 'objectValue',
  'confidence', 'validAt', 'createdAt', 'status', 'groundingMode',
  'stability', 'reasoning',
] as const;

// ── Error Codes ──

export type ExchangeErrorCode =
  | 'EXPORT_INVALID_FORMAT'       // Unknown format
  | 'EXPORT_QUERY_FAILED'         // Claim query error
  | 'IMPORT_INVALID_FORMAT'       // Not valid JSON or wrong version
  | 'IMPORT_INVALID_DOCUMENT'     // Missing required fields
  | 'IMPORT_CLAIM_FAILED'         // Individual claim import error
  | 'IMPORT_DEDUP_CONFLICT';      // Dedup conflict with onConflict='error'

/** Current export format version */
export const EXPORT_VERSION = '1.0.0' as const;
