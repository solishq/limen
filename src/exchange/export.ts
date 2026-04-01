/**
 * Phase 8 Export Implementation.
 *
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 1.3, 2.2, 4)
 * Truth Model: PHASE-8-TRUTH-MODEL.md (I-P8-20, I-P8-24)
 *
 * Exports Limen knowledge to JSON or CSV format.
 * JSON is the canonical format — CSV is a lossy projection (DC-P8-105).
 *
 * Dependencies: DatabaseConnection (for direct SQL queries).
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type {
  ExportOptions,
  LimenExportDocument,
  ExportedClaim,
  ExportedRelationship,
  ExportedEvidenceRef,
} from './exchange_types.js';
import { EXPORT_VERSION, CSV_COLUMNS } from './exchange_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-8' } };
}

// ── Export Dependencies ──

export interface ExportDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly time: TimeProvider;
  readonly limenVersion: string;
}

// ── Export Function ──

/**
 * Export Limen knowledge to a string in the specified format.
 *
 * I-P8-20: JSON export preserves claim data fidelity.
 * I-P8-24: Export version field is always '1.0.0'.
 * DC-P8-105: CSV is lossy (no relationships, no evidence).
 */
export function exportKnowledge(deps: ExportDeps, options: ExportOptions): Result<string> {
  const { getConnection, time, limenVersion } = deps;
  const format = options.format ?? 'json';

  // DC-P8-903: Validate format
  if (format !== 'json' && format !== 'csv') {
    return err('EXPORT_INVALID_FORMAT', `Unknown export format: '${format}'. Supported: json, csv.`);
  }

  try {
    const conn = getConnection();

    // Build WHERE clause based on options
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.status && options.status !== 'all') {
      conditions.push('ca.status = ?');
      params.push(options.status);
    } else if (!options.status) {
      // Default: active only
      conditions.push("ca.status = 'active'");
    }

    if (options.subject) {
      conditions.push('ca.subject LIKE ?');
      params.push(`${options.subject}%`);
    }

    if (options.predicate) {
      conditions.push('ca.predicate LIKE ?');
      params.push(`${options.predicate}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query claims using DatabaseConnection.query<T>()
    interface ClaimRow {
      id: string;
      subject: string;
      predicate: string;
      object_type: string;
      object_value: string;
      confidence: number;
      valid_at: string;
      created_at: string;
      status: string;
      grounding_mode: string;
      stability: number | null;
      reasoning: string | null;
    }

    const claimRows = conn.query<ClaimRow>(
      `SELECT ca.id, ca.subject, ca.predicate, ca.object_type, ca.object_value,
              ca.confidence, ca.valid_at, ca.created_at, ca.status, ca.grounding_mode,
              ca.stability, ca.reasoning
       FROM claim_assertions ca
       ${whereClause}
       ORDER BY ca.created_at ASC`,
      params,
    );

    const claims: ExportedClaim[] = claimRows.map(row => {
      // object_value is stored as JSON.stringify(value) in the DB.
      // Deserialize for export to match consumer expectations.
      let objectValue: string;
      try {
        const parsed = JSON.parse(row.object_value);
        objectValue = String(parsed);
      } catch {
        objectValue = row.object_value;
      }

      return {
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        objectType: row.object_type,
        objectValue,
        confidence: row.confidence,
        validAt: row.valid_at,
        createdAt: row.created_at,
        status: row.status as 'active' | 'retracted',
        groundingMode: row.grounding_mode as 'evidence_path' | 'runtime_witness',
        stability: row.stability,
        reasoning: row.reasoning,
      };
    });

    // Optionally include evidence refs
    const includeEvidence = options.includeEvidence ?? (format === 'json');
    if (includeEvidence && claims.length > 0) {
      const claimIds = claims.map(c => c.id);
      const placeholders = claimIds.map(() => '?').join(',');

      interface EvidenceRow {
        claim_id: string;
        evidence_type: string;
        evidence_id: string;
        source_state: string;
      }

      const evidenceRows = conn.query<EvidenceRow>(
        `SELECT ce.claim_id, ce.evidence_type, ce.evidence_id, ce.source_state
         FROM claim_evidence ce
         WHERE ce.claim_id IN (${placeholders})
         ORDER BY ce.claim_id, ce.created_at ASC`,
        claimIds,
      );

      // Group evidence by claim ID
      const evidenceMap = new Map<string, ExportedEvidenceRef[]>();
      for (const row of evidenceRows) {
        if (!evidenceMap.has(row.claim_id)) {
          evidenceMap.set(row.claim_id, []);
        }
        evidenceMap.get(row.claim_id)!.push({
          sourceType: row.evidence_type,
          sourceId: row.evidence_id,
          label: row.source_state,
        });
      }

      // Attach evidence to claims
      for (let i = 0; i < claims.length; i++) {
        const refs = evidenceMap.get(claims[i]!.id);
        if (refs) {
          (claims as ExportedClaim[])[i] = { ...claims[i]!, evidenceRefs: refs };
        }
      }
    }

    // Query relationships
    let relationships: ExportedRelationship[] = [];
    const includeRelationships = options.includeRelationships ?? (format === 'json');
    if (includeRelationships && claims.length > 0) {
      const claimIds = claims.map(c => c.id);
      const placeholders = claimIds.map(() => '?').join(',');

      interface RelRow {
        from_claim_id: string;
        to_claim_id: string;
        type: string;
        created_at: string;
      }

      const relRows = conn.query<RelRow>(
        `SELECT cr.from_claim_id, cr.to_claim_id, cr.type, cr.created_at
         FROM claim_relationships cr
         WHERE cr.from_claim_id IN (${placeholders}) OR cr.to_claim_id IN (${placeholders})
         ORDER BY cr.created_at ASC`,
        [...claimIds, ...claimIds],
      );

      relationships = relRows.map(row => ({
        fromClaimId: row.from_claim_id,
        toClaimId: row.to_claim_id,
        type: row.type,
        createdAt: row.created_at,
      }));
    }

    // Serialize
    if (format === 'json') {
      const document: LimenExportDocument = {
        version: EXPORT_VERSION,
        metadata: {
          exportedAt: time.nowISO(),
          limenVersion,
          claimCount: claims.length,
          relationshipCount: relationships.length,
        },
        claims,
        relationships,
      };

      const pretty = options.pretty !== false;
      return ok(JSON.stringify(document, null, pretty ? 2 : undefined));
    }

    // CSV format (DC-P8-105: lossy — no relationships, no evidence)
    if (format === 'csv') {
      const header = CSV_COLUMNS.join(',');
      const rows = claims.map(claim => {
        return CSV_COLUMNS.map(col => {
          const value = claim[col as keyof ExportedClaim];
          if (value === null || value === undefined) return '';
          const str = String(value);
          // CSV escape: quote if contains comma, newline, or quote
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',');
      });

      return ok([header, ...rows].join('\n'));
    }

    // Should not reach here due to format validation above
    return err('EXPORT_INVALID_FORMAT', `Unknown format: ${format}`);
  } catch (queryError) {
    return err('EXPORT_QUERY_FAILED', `Export query failed: ${queryError instanceof Error ? queryError.message : String(queryError)}`);
  }
}
