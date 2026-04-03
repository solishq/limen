/**
 * Phase 10: SOC 2 Compliance Export
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 1, Compliance Export)
 * Invariants: I-P10-30 (period accuracy), I-P10-31 (chain verification),
 *             I-P10-32 (tombstone safety)
 * DCs: DC-P10-503, DC-P10-702, DC-P10-805, DC-P10-902
 *
 * Generates SOC 2 audit package:
 *   1. Query audit entries in period [from, to]
 *   2. Verify chain integrity
 *   3. Compute statistics
 *   4. Group entries by SOC 2 control categories
 *   5. Return Soc2AuditPackage
 *
 * I-P10-32: Tombstoned entries appear with sanitized content, NOT original PII.
 */

import type { OperationContext, Result } from '../../kernel/interfaces/common.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type { AuditTrail, AuditEntry } from '../../kernel/interfaces/audit.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  Soc2AuditPackage,
  Soc2ControlEvidence,
  Soc2Statistics,
  ComplianceExportOptions,
} from '../classification/governance_types.js';

// ============================================================================
// Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

/**
 * Categorize an audit entry by SOC 2 control.
 * An entry can belong to multiple categories.
 */
function categorizeEntry(entry: AuditEntry): {
  accessControl: boolean;
  changeManagement: boolean;
  dataIntegrity: boolean;
} {
  const op = entry.operation.toLowerCase();
  const resType = entry.resourceType.toLowerCase();

  return {
    accessControl:
      op.includes('agent') || op.includes('role') || op.includes('permission') ||
      resType.includes('agent') || resType.includes('role'),
    changeManagement:
      op.includes('claim') || op.includes('mission') ||
      resType.includes('claim') || resType.includes('mission'),
    dataIntegrity:
      op.includes('tombstone') || op.includes('erasure') || op.includes('import') ||
      op.includes('purge') || op.includes('retract'),
  };
}

// ============================================================================
// Compliance Export Dependencies
// ============================================================================

export interface ComplianceExportDeps {
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
}

// ============================================================================
// SOC 2 Export
// ============================================================================

/**
 * Generate a SOC 2 audit package for a given period.
 *
 * @param deps - Dependencies (audit trail, time provider)
 * @param conn - Database connection
 * @param ctx - Operation context
 * @param options - Period boundaries
 * @returns Soc2AuditPackage or error
 */
export function generateComplianceExport(
  deps: ComplianceExportDeps,
  conn: DatabaseConnection,
  ctx: OperationContext,
  options: ComplianceExportOptions,
): Result<Soc2AuditPackage> {
  // Validate period
  const fromMs = new Date(options.from).getTime();
  const toMs = new Date(options.to).getTime();

  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return err('EXPORT_PERIOD_INVALID', 'from and to must be valid ISO 8601 dates', 'I-P10-30');
  }

  if (fromMs >= toMs) {
    return err('EXPORT_PERIOD_INVALID', 'from must be before to', 'I-P10-30');
  }

  // 1. Query audit entries in period (I-P10-30)
  const queryResult = deps.audit.query(conn, ctx, {
    fromTimestamp: options.from,
    toTimestamp: options.to,
    limit: 100_000, // Large limit to get all entries
  });

  if (!queryResult.ok) {
    return err('EXPORT_NO_ENTRIES', `Failed to query audit entries: ${queryResult.error.message}`, 'I-P10-30');
  }

  const entries = queryResult.value;

  if (entries.length === 0) {
    return err('EXPORT_NO_ENTRIES', 'No audit entries found in the requested period', 'I-P10-30');
  }

  // 2. Verify chain integrity (I-P10-31)
  const chainResult = deps.audit.verifyChain(conn, ctx.tenantId ?? undefined);
  if (!chainResult.ok) {
    return err('EXPORT_NO_ENTRIES', `Chain verification failed: ${chainResult.error.message}`, 'I-P10-31');
  }
  const chainVerification = chainResult.value;

  // 3. Compute statistics
  const uniqueActors = new Set<string>();
  const operationBreakdown: Record<string, number> = {};

  for (const entry of entries) {
    uniqueActors.add(entry.actorId);
    operationBreakdown[entry.operation] = (operationBreakdown[entry.operation] ?? 0) + 1;
  }

  const statistics: Soc2Statistics = {
    totalAuditEntries: entries.length,
    uniqueActors: uniqueActors.size,
    operationBreakdown,
    chainIntegrity: chainVerification.valid,
  };

  // 4. Group entries by SOC 2 control categories
  const accessControlEntries: AuditEntry[] = [];
  const changeManagementEntries: AuditEntry[] = [];
  const dataIntegrityEntries: AuditEntry[] = [];

  for (const entry of entries) {
    const categories = categorizeEntry(entry);
    if (categories.accessControl) accessControlEntries.push(entry);
    if (categories.changeManagement) changeManagementEntries.push(entry);
    if (categories.dataIntegrity) dataIntegrityEntries.push(entry);
  }

  const controls = {
    accessControl: {
      controlId: 'CC6.1',
      description: 'Logical and Physical Access Controls',
      evidenceEntries: accessControlEntries,
      compliant: chainVerification.valid,
      notes: `${accessControlEntries.length} access control events in period`,
    } satisfies Soc2ControlEvidence,
    changeManagement: {
      controlId: 'CC8.1',
      description: 'Change Management',
      evidenceEntries: changeManagementEntries,
      compliant: chainVerification.valid,
      notes: `${changeManagementEntries.length} change management events in period`,
    } satisfies Soc2ControlEvidence,
    dataIntegrity: {
      controlId: 'PI1.1',
      description: 'Processing Integrity',
      evidenceEntries: dataIntegrityEntries,
      compliant: chainVerification.valid,
      notes: `${dataIntegrityEntries.length} data integrity events in period`,
    } satisfies Soc2ControlEvidence,
    auditLogging: {
      controlId: 'CC7.2',
      description: 'System Operations — Audit Logging',
      evidenceEntries: entries,
      compliant: chainVerification.valid,
      notes: `${entries.length} total audit entries. Chain integrity: ${chainVerification.valid}`,
    } satisfies Soc2ControlEvidence,
  };

  // 5. Return package
  const pkg: Soc2AuditPackage = {
    version: '1.0.0',
    generatedAt: deps.time.nowISO(),
    period: { from: options.from, to: options.to },
    controls,
    chainVerification,
    statistics,
  };

  return ok(pkg);
}
