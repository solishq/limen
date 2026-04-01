/**
 * Phase 8 Import Implementation.
 *
 * Design Source: PHASE-8-DESIGN-SOURCE.md (Output 1.3, 2.2, 3.2, 4)
 * Truth Model: PHASE-8-TRUTH-MODEL.md (I-P8-20 through I-P8-25)
 *
 * Imports Limen knowledge from JSON format with deduplication and ID remapping.
 *
 * Invariants enforced:
 *   I-P8-20: Roundtrip fidelity (claim data preserved)
 *   I-P8-21: New IDs assigned, idMap maintained
 *   I-P8-22: Dedup by content
 *   I-P8-23: Relationship rebinding via idMap
 *   I-P8-25: Version validation
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { ClaimCreateInput, ClaimId, RelationshipCreateInput, RelationshipType } from '../claims/interfaces/claim_types.js';
import type { MissionId } from '../kernel/interfaces/index.js';
import type {
  LimenExportDocument,
  ImportOptions,
  ImportResult,
  ImportError,
} from './exchange_types.js';
import { EXPORT_VERSION } from './exchange_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'Phase-8' } };
}

// ── Import Dependencies ──

export interface ImportDeps {
  readonly assertClaim: (input: ClaimCreateInput) => Result<{ claim: { id: ClaimId } }>;
  readonly relateClaims: (input: RelationshipCreateInput) => Result<unknown>;
  /**
   * Query existing claims for dedup check.
   * Uses subject+predicate filters to avoid hitting query limits.
   */
  readonly queryClaims: (input: { subject?: string; predicate?: string; status?: string; limit?: number }) => Result<{ claims: readonly { claim: { subject: string; predicate: string; object: { value: string }; status: string } }[] }>;
  readonly missionId: MissionId;
}

// ── Import Function ──

/**
 * Import a LimenExportDocument into the current Limen instance.
 *
 * I-P8-21: All imported claims get new IDs.
 * I-P8-22: Dedup by content skips claims with matching subject+predicate+objectValue+status.
 * I-P8-23: Relationships rebind to new IDs via idMap.
 * I-P8-25: Documents with version !== '1.0.0' are rejected.
 */
export function importKnowledge(deps: ImportDeps, document: LimenExportDocument, options?: ImportOptions): Result<ImportResult> {
  // Validate document structure
  if (!document || typeof document !== 'object') {
    return err('IMPORT_INVALID_FORMAT', 'Import document must be a non-null object.');
  }

  // I-P8-25, DC-P8-603: Validate version
  if (document.version !== EXPORT_VERSION) {
    return err('IMPORT_INVALID_DOCUMENT', `Unsupported document version: '${document.version}'. Expected: '${EXPORT_VERSION}'.`);
  }

  if (!Array.isArray(document.claims)) {
    return err('IMPORT_INVALID_DOCUMENT', 'Import document must have a claims array.');
  }

  const dedup = options?.dedup ?? 'by_content';
  const dryRun = options?.dryRun ?? false;
  const onConflict = options?.onConflict ?? 'skip';

  // For dedup, we track content keys of claims we've already seen/imported
  // to detect duplicates within the batch
  const seenContentKeys = new Set<string>();

  /**
   * Check if a claim already exists in the database (I-P8-22).
   * Uses subject+predicate targeted query to avoid hitting the 200-claim limit.
   */
  function existsInDatabase(subject: string, predicate: string, objectValue: string, status: string): boolean {
    const result = deps.queryClaims({ subject, predicate, status, limit: 200 });
    if (!result.ok) return false;
    return result.value.claims.some(
      item => String(item.claim.object.value) === objectValue,
    );
  }

  // Process claims
  const idMap = new Map<string, string>();
  const errors: ImportError[] = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < document.claims.length; i++) {
    const claim = document.claims[i]!;

    // Dedup check (I-P8-22)
    if (dedup === 'by_content') {
      const key = contentKey(claim.subject, claim.predicate, claim.objectValue, claim.status);

      // Check within-batch dedup
      if (seenContentKeys.has(key)) {
        if (onConflict === 'error') {
          return err('IMPORT_DEDUP_CONFLICT', `Duplicate claim at index ${i}: subject='${claim.subject}', predicate='${claim.predicate}'.`);
        }
        skipped++;
        continue;
      }

      // Check existing database
      if (existsInDatabase(claim.subject, claim.predicate, claim.objectValue, claim.status)) {
        if (onConflict === 'error') {
          return err('IMPORT_DEDUP_CONFLICT', `Duplicate claim at index ${i}: subject='${claim.subject}', predicate='${claim.predicate}'.`);
        }
        skipped++;
        continue;
      }
    }

    if (dryRun) {
      imported++;
      idMap.set(claim.id, `dry-run-${i}`);
      if (dedup === 'by_content') {
        seenContentKeys.add(contentKey(claim.subject, claim.predicate, claim.objectValue, claim.status));
      }
      continue;
    }

    // Import via ClaimApi (I-P8-21: new ID assigned by the system)
    const input: ClaimCreateInput = {
      subject: claim.subject,
      predicate: claim.predicate,
      object: { type: claim.objectType as 'string' | 'number' | 'boolean' | 'date' | 'json', value: claim.objectValue },
      confidence: claim.confidence,
      validAt: claim.validAt,
      missionId: deps.missionId,
      taskId: null,
      evidenceRefs: [],
      groundingMode: claim.groundingMode,
      ...(claim.groundingMode === 'runtime_witness' ? {
        runtimeWitness: {
          witnessType: 'convenience' as const,
          witnessedValues: { source: 'import' },
          witnessTimestamp: claim.validAt,
        },
      } : {}),
      ...(claim.reasoning !== null && claim.reasoning !== undefined ? { reasoning: claim.reasoning } : {}),
    };

    const result = deps.assertClaim(input);
    if (result.ok) {
      idMap.set(claim.id, result.value.claim.id);
      imported++;

      // Track for within-batch dedup
      if (dedup === 'by_content') {
        seenContentKeys.add(contentKey(claim.subject, claim.predicate, claim.objectValue, claim.status));
      }
    } else {
      errors.push({ claimIndex: i, claimId: claim.id, reason: result.error.message });
      failed++;
    }
  }

  // Process relationships (I-P8-23: rebind via idMap)
  let relationshipsImported = 0;
  let relationshipsSkipped = 0;

  if (!dryRun && document.relationships && document.relationships.length > 0) {
    for (const rel of document.relationships) {
      const newFromId = idMap.get(rel.fromClaimId);
      const newToId = idMap.get(rel.toClaimId);

      if (!newFromId || !newToId) {
        // I-P8-23: Missing reference — skip
        relationshipsSkipped++;
        continue;
      }

      const relInput: RelationshipCreateInput = {
        fromClaimId: newFromId as ClaimId,
        toClaimId: newToId as ClaimId,
        type: rel.type as RelationshipType,
        missionId: deps.missionId,
      };

      const relResult = deps.relateClaims(relInput);
      if (relResult.ok) {
        relationshipsImported++;
      } else {
        relationshipsSkipped++;
      }
    }
  }

  return ok({
    imported,
    skipped,
    failed,
    relationshipsImported,
    relationshipsSkipped,
    errors,
    idMap,
  });
}

/**
 * Parse a JSON string into a LimenExportDocument.
 */
export function parseExportDocument(json: string): Result<LimenExportDocument> {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') {
      return err('IMPORT_INVALID_FORMAT', 'Import document must be a JSON object.');
    }
    if (parsed.version !== EXPORT_VERSION) {
      return err('IMPORT_INVALID_DOCUMENT', `Unsupported document version: '${parsed.version}'. Expected: '${EXPORT_VERSION}'.`);
    }
    if (!Array.isArray(parsed.claims)) {
      return err('IMPORT_INVALID_DOCUMENT', 'Import document must have a claims array.');
    }
    return ok(parsed as LimenExportDocument);
  } catch (parseError) {
    return err('IMPORT_INVALID_FORMAT', `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
}

// ── Internal Helpers ──

function contentKey(subject: string, predicate: string, objectValue: string, status: string): string {
  return `${subject}\0${predicate}\0${objectValue}\0${status}`;
}
