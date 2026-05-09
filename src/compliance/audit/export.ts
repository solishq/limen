/**
 * AuditExporter
 *
 * Contract: SHARED_TYPES.md S10.3 (AuditLogEntry), S3 (Classification)
 * Purpose: Export audit entries in SOC2, ISO27001, and FedRAMP compliance formats.
 *
 * Design decisions:
 * - Each export format includes: entry count, date range, classification distribution,
 *   governance decision summary, chain integrity status
 * - Exports are read-only snapshots -- no mutation
 * - All exports use Result<T> pattern
 */

import type { ClassificationLevel, Result, KernelError } from '../../adapters/shared/types.js';
import type { EnterpriseAuditEntry, ChainVerificationResult, TimeProvider } from './enterprise-logger.js';
import { EnterpriseAuditLogger } from './enterprise-logger.js';


function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S10.3' };
}

/**
 * Compliance framework identifier.
 */
export type ComplianceFramework = 'SOC2' | 'ISO27001' | 'FedRAMP';

/**
 * Date range filter for exports.
 */
export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

/**
 * Classification distribution in the export.
 */
export type ClassificationDistribution = Readonly<Record<ClassificationLevel, number>>;

/**
 * Governance decision summary in the export.
 */
/**
 * F-15: Added 'unknown' category for when sum of known verdicts does not equal total.
 */
export interface GovernanceDecisionSummary {
  readonly totalDecisions: number;
  readonly allowed: number;
  readonly refused: number;
  readonly escalated: number;
  readonly sandboxed: number;
  readonly noDecision: number;
  readonly unknown: number;
}

/**
 * Base compliance export structure -- shared across all frameworks.
 */
export interface ComplianceExport {
  readonly framework: ComplianceFramework;
  readonly exportedAt: string;
  readonly dateRange: { readonly from: string; readonly to: string };
  readonly entryCount: number;
  readonly classificationDistribution: ClassificationDistribution;
  readonly governanceSummary: GovernanceDecisionSummary;
  readonly chainIntegrity: ChainVerificationResult;
  readonly entries: readonly EnterpriseAuditEntry[];
}

/**
 * SOC 2 Type II specific export -- includes control activity evidence.
 */
export interface SOC2Export extends ComplianceExport {
  readonly framework: 'SOC2';
  readonly controlActivities: {
    readonly accessControlEvents: number;
    readonly changeManagementEvents: number;
    readonly securityIncidents: number;
    readonly dataClassificationEvents: number;
  };
}

/**
 * ISO 27001 specific export -- includes ISMS evidence.
 */
export interface ISO27001Export extends ComplianceExport {
  readonly framework: 'ISO27001';
  readonly ismsEvidence: {
    readonly informationSecurityEvents: number;
    readonly accessManagementEvents: number;
    readonly incidentManagementEvents: number;
    readonly assetManagementEvents: number;
  };
}

/**
 * FedRAMP Moderate specific export -- includes NIST 800-53 evidence primitives.
 */
export interface FedRAMPExport extends ComplianceExport {
  readonly framework: 'FedRAMP';
  readonly nist80053Evidence: {
    readonly accessControlEvents: number;
    readonly auditAccountabilityEvents: number;
    readonly configurationManagementEvents: number;
    readonly identificationAuthenticationEvents: number;
    readonly systemCommunicationsProtection: number;
  };
}

/**
 * AuditExporter -- generates compliance-framework-specific export snapshots.
 *
 * Each format includes: entry count, date range, classification distribution,
 * governance decision summary, and chain integrity status.
 */
const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

export class AuditExporter {
  readonly #logger: EnterpriseAuditLogger;
  readonly #timeProvider: TimeProvider;

  constructor(logger: EnterpriseAuditLogger, timeProvider?: TimeProvider) {
    this.#logger = logger;
    this.#timeProvider = timeProvider ?? DEFAULT_TIME_PROVIDER;
  }

  /**
   * Export entries in SOC 2 Type II format.
   *
   * SOC 2 evidence focuses on:
   * - Access control (governance decisions)
   * - Change management (memory writes, branch operations)
   * - Security incidents (governance refusals, integrity violations)
   * - Data classification (classification-level distribution)
   */
  exportSOC2(dateRange: DateRange): Result<SOC2Export> {
    const baseResult = this.#buildBaseExport('SOC2', dateRange);
    if (!baseResult.ok) return baseResult;
    const base = baseResult.value;

    const entries = base.entries;
    const controlActivities = {
      accessControlEvents: this.#countEvents(entries, ['governance:refused', 'governance:allowed', 'governance:escalated']),
      changeManagementEvents: this.#countEvents(entries, ['memory:write', 'memory:branch', 'memory:merge']),
      securityIncidents: this.#countEvents(entries, ['governance:refused', 'audit:integrity_violation']),
      dataClassificationEvents: entries.filter(e => e.classification !== 'unrestricted').length,
    };

    return {
      ok: true,
      value: { ...base, framework: 'SOC2' as const, controlActivities },
    };
  }

  /**
   * Export entries in ISO 27001 format.
   *
   * ISO 27001 evidence focuses on ISMS controls:
   * - Information security events
   * - Access management
   * - Incident management
   * - Asset management (belief/claim lifecycle)
   */
  exportISO27001(dateRange: DateRange): Result<ISO27001Export> {
    const baseResult = this.#buildBaseExport('ISO27001', dateRange);
    if (!baseResult.ok) return baseResult;
    const base = baseResult.value;

    const entries = base.entries;
    const ismsEvidence = {
      informationSecurityEvents: entries.filter(e =>
        e.classification === 'confidential' || e.classification === 'restricted' || e.classification === 'critical'
      ).length,
      accessManagementEvents: this.#countEvents(entries, ['governance:refused', 'governance:allowed', 'session:started', 'session:ended']),
      incidentManagementEvents: this.#countEvents(entries, ['governance:refused', 'audit:integrity_violation', 'hook:failed']),
      assetManagementEvents: this.#countEvents(entries, ['memory:write', 'memory:delete', 'memory:branch', 'memory:merge']),
    };

    return {
      ok: true,
      value: { ...base, framework: 'ISO27001' as const, ismsEvidence },
    };
  }

  /**
   * Export entries in FedRAMP Moderate format.
   *
   * FedRAMP evidence maps to NIST 800-53 control families:
   * - AC (Access Control)
   * - AU (Audit and Accountability)
   * - CM (Configuration Management)
   * - IA (Identification and Authentication)
   * - SC (System and Communications Protection)
   */
  exportFedRAMP(dateRange: DateRange): Result<FedRAMPExport> {
    const baseResult = this.#buildBaseExport('FedRAMP', dateRange);
    if (!baseResult.ok) return baseResult;
    const base = baseResult.value;

    const entries = base.entries;
    const nist80053Evidence = {
      accessControlEvents: this.#countEvents(entries, ['governance:refused', 'governance:allowed', 'governance:escalated']),
      auditAccountabilityEvents: entries.length, // Every entry is audit evidence
      configurationManagementEvents: this.#countEvents(entries, ['memory:write', 'memory:branch', 'memory:merge', 'memory:delete']),
      identificationAuthenticationEvents: this.#countEvents(entries, ['session:started', 'session:ended', 'session:rejected']),
      systemCommunicationsProtection: entries.filter(e =>
        e.classification === 'restricted' || e.classification === 'critical'
      ).length,
    };

    return {
      ok: true,
      value: { ...base, framework: 'FedRAMP' as const, nist80053Evidence },
    };
  }

  /**
   * Build the base compliance export (shared structure).
   */
  #buildBaseExport(
    framework: ComplianceFramework,
    dateRange: DateRange,
  ): Result<ComplianceExport> {
    if (dateRange.from > dateRange.to) {
      return { ok: false, error: makeError('INVALID_DATE_RANGE', 'from date must be before to date') };
    }

    const allEntries = this.#logger.getEntries();
    const fromMs = dateRange.from.getTime();
    const toMs = dateRange.to.getTime();

    // F-09: Filter entries within date range using proper Date comparison (not string comparison)
    const entries = allEntries.filter(e => {
      const entryMs = new Date(e.timestamp).getTime();
      return entryMs >= fromMs && entryMs <= toMs;
    });

    // Classification distribution
    const classificationDistribution: Record<ClassificationLevel, number> = {
      unrestricted: 0,
      internal: 0,
      confidential: 0,
      restricted: 0,
      critical: 0,
    };
    for (const entry of entries) {
      classificationDistribution[entry.classification]++;
    }

    // Governance decision summary
    // F-15: Compute 'unknown' bucket when sum of known verdicts does not equal total
    const totalDecisions = entries.filter(e => e.governanceDecision !== null).length;
    const allowed = entries.filter(e => e.governanceDecision?.verdict?.verdict === 'allow').length;
    const refused = entries.filter(e => e.governanceDecision?.verdict?.verdict === 'refuse').length;
    const escalated = entries.filter(e => e.governanceDecision?.verdict?.verdict === 'escalate').length;
    const sandboxed = entries.filter(e => e.governanceDecision?.verdict?.verdict === 'sandbox').length;
    const noDecision = entries.filter(e => e.governanceDecision === null).length;
    const knownSum = allowed + refused + escalated + sandboxed;
    const unknown = totalDecisions - knownSum;
    const governanceSummary: GovernanceDecisionSummary = {
      totalDecisions,
      allowed,
      refused,
      escalated,
      sandboxed,
      noDecision,
      unknown: unknown > 0 ? unknown : 0,
    };

    // Finding-42: Chain verification is intentionally global — hash chain integrity
    // is a whole-chain property. Verifying a subset would require sub-chain hash anchors.
    // If chain outside export range is corrupted, the export correctly reports this
    // as the chain's integrity is indivisible.
    const chainResult = this.#logger.verifyChain();
    const chainIntegrity: ChainVerificationResult = chainResult.ok
      ? chainResult.value
      : { valid: false, entriesChecked: 0, firstInvalidIndex: null, firstInvalidReason: 'Verification failed' };

    return {
      ok: true,
      value: {
        framework,
        exportedAt: this.#timeProvider.now(),
        dateRange: { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() },
        entryCount: entries.length,
        classificationDistribution: classificationDistribution as ClassificationDistribution,
        governanceSummary,
        chainIntegrity,
        entries,
      },
    };
  }

  /**
   * Count entries matching any of the given event types.
   */
  #countEvents(entries: readonly EnterpriseAuditEntry[], eventTypes: readonly string[]): number {
    return entries.filter(e => eventTypes.includes(e.event)).length;
  }
}
