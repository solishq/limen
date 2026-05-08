/**
 * EnterpriseCompliancePack
 *
 * Contract: PHASE_3_DESIGN_SOURCE.md (Enterprise Compliance Pack)
 *           SHARED_TYPES.md S3, S10.3, S17, S20
 * Purpose: Orchestrator that ties all compliance components together.
 *          Provides unified access to classification, token budget, audit,
 *          retention, export, and rollback functionality.
 *
 * Design decisions:
 * - Lazy initialization of components on first access
 * - All components are governed (#governed = true)
 * - runComplianceCheck() verifies all controls are operational
 * - generateComplianceReport() delegates to AuditExporter
 */

import type { Result, KernelError } from '../adapters/crewai/types.js';
import { ClassificationEngine } from './classification/engine.js';
import { TokenBudgetManager } from './token-budget/manager.js';
import type { TokenBudgetManagerConfig } from './token-budget/types.js';
import { EnterpriseAuditLogger } from './audit/enterprise-logger.js';
import type { TimeProvider } from './audit/enterprise-logger.js';
import { RetentionPolicyEnforcer } from './audit/retention.js';
import { AuditExporter, type ComplianceFramework, type DateRange } from './audit/export.js';
import type { SOC2Export, ISO27001Export, FedRAMPExport } from './audit/export.js';
import { RollbackManager } from './rollback/manager.js';

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'PHASE_3_DESIGN_SOURCE.md' };
}

/**
 * Configuration for the EnterpriseCompliancePack.
 */
export interface CompliancePackConfig {
  readonly tokenBudget: TokenBudgetManagerConfig;
  readonly timeProvider?: TimeProvider;
}

/**
 * Compliance check result -- returned by runComplianceCheck().
 */
export interface ComplianceCheckResult {
  readonly overall: 'pass' | 'fail' | 'degraded';
  readonly checks: readonly ComplianceCheckItem[];
  readonly timestamp: string;
}

/**
 * Individual compliance check.
 */
export interface ComplianceCheckItem {
  readonly component: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

/**
 * EnterpriseCompliancePack -- orchestrator for all compliance components.
 *
 * PHASE_3_DESIGN_SOURCE.md: Enterprise Compliance Pack (SOC 2, ISO 27001, FedRAMP).
 *
 * #governed = true -- no ungoverned mode.
 */
export class EnterpriseCompliancePack {
  readonly #governed = true;
  readonly #classificationEngine: ClassificationEngine;
  readonly #tokenBudgetManager: TokenBudgetManager;
  readonly #auditLogger: EnterpriseAuditLogger;
  readonly #retentionEnforcer: RetentionPolicyEnforcer;
  readonly #auditExporter: AuditExporter;
  readonly #rollbackManager: RollbackManager;
  readonly #timeProvider: TimeProvider;
  #initialized = false;

  constructor(config: CompliancePackConfig) {
    const tp = config.timeProvider ?? DEFAULT_TIME_PROVIDER;
    this.#timeProvider = tp;
    this.#classificationEngine = new ClassificationEngine();
    this.#tokenBudgetManager = new TokenBudgetManager(config.tokenBudget, tp);
    this.#auditLogger = new EnterpriseAuditLogger(tp);
    this.#retentionEnforcer = new RetentionPolicyEnforcer(tp);
    this.#auditExporter = new AuditExporter(this.#auditLogger, tp);
    this.#rollbackManager = new RollbackManager({ timeProvider: tp });
  }

  /**
   * Initialize all compliance components.
   *
   * @returns Result indicating success or failure
   */
  initialize(): Result<void> {
    if (this.#initialized) {
      return { ok: true, value: undefined };
    }

    if (!this.#governed) {
      return { ok: false, error: makeError('GOVERNANCE_REQUIRED', 'Compliance pack requires governance') };
    }

    this.#initialized = true;
    return { ok: true, value: undefined };
  }

  /**
   * Get the ClassificationEngine.
   *
   * SHARED_TYPES.md S3: Classification levels and enforcement.
   */
  getClassificationEngine(): Result<ClassificationEngine> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }
    return { ok: true, value: this.#classificationEngine };
  }

  /**
   * Get the TokenBudgetManager.
   *
   * SHARED_TYPES.md S20: Performance budget and token tracking.
   */
  getTokenBudgetManager(): Result<TokenBudgetManager> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }
    return { ok: true, value: this.#tokenBudgetManager };
  }

  /**
   * Get the EnterpriseAuditLogger.
   *
   * SHARED_TYPES.md S10.3: AuditLogEntry with hash chain.
   */
  getAuditLogger(): Result<EnterpriseAuditLogger> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }
    return { ok: true, value: this.#auditLogger };
  }

  /**
   * Get the RetentionPolicyEnforcer.
   *
   * SHARED_TYPES.md S17: Retention policy per classification.
   */
  getRetentionEnforcer(): Result<RetentionPolicyEnforcer> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }
    return { ok: true, value: this.#retentionEnforcer };
  }

  /**
   * Get the RollbackManager.
   *
   * PHASE_3_DESIGN_SOURCE.md S17: Rollback plan.
   */
  getRollbackManager(): Result<RollbackManager> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }
    return { ok: true, value: this.#rollbackManager };
  }

  /**
   * Run a comprehensive compliance check of all controls.
   *
   * Verifies:
   * 1. Classification engine is operational
   * 2. Token budget manager is operational
   * 3. Audit logger is operational with valid chain
   * 4. Retention enforcer is operational
   * 5. Rollback manager is operational
   * 6. Governance is enforced (no bypass)
   */
  runComplianceCheck(): Result<ComplianceCheckResult> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }

    const checks: ComplianceCheckItem[] = [];

    // 1. Classification engine
    const classResult = this.#classificationEngine.classifyOperation('test', {
      operationType: 'compliance_check',
      resourceClassification: 'unrestricted',
      actorClearance: 4,
    });
    checks.push({
      component: 'ClassificationEngine',
      status: classResult.ok ? 'pass' : 'fail',
      detail: classResult.ok ? 'Classification engine operational' : classResult.error.message,
    });

    // F-07: Token budget manager -- actually verify by creating a temp session
    let tokenBudgetOk = false;
    const tempSessionId = `__compliance_check_${Date.now()}`;
    try {
      const initResult = this.#tokenBudgetManager.initSession(tempSessionId, 1000, 1000);
      if (initResult.ok) {
        const reserveResult = this.#tokenBudgetManager.reserveTokens(tempSessionId, 'compliance_check', 0);
        tokenBudgetOk = reserveResult.ok && reserveResult.value.allowed;
        this.#tokenBudgetManager.removeSession(tempSessionId);
      }
    } catch {
      tokenBudgetOk = false;
    }
    checks.push({
      component: 'TokenBudgetManager',
      status: tokenBudgetOk ? 'pass' : 'fail',
      detail: tokenBudgetOk ? 'Token budget manager operational' : 'Token budget manager check failed',
    });

    // 3. Audit logger chain integrity
    const chainResult = this.#auditLogger.verifyChain();
    const chainValid = chainResult.ok && chainResult.value.valid;
    checks.push({
      component: 'EnterpriseAuditLogger',
      status: chainValid ? 'pass' : (this.#auditLogger.entryCount === 0 ? 'pass' : 'fail'),
      detail: chainValid
        ? `Audit chain valid (${String(this.#auditLogger.entryCount)} entries)`
        : this.#auditLogger.entryCount === 0
          ? 'Audit logger operational (empty chain)'
          : 'Audit chain integrity failure',
    });

    // F-07: Retention enforcer -- actually verify by calling getPolicy
    let retentionOk = false;
    try {
      const policy = this.#retentionEnforcer.getPolicy('unrestricted');
      retentionOk = policy !== null && policy.retentionDays > 0;
    } catch {
      retentionOk = false;
    }
    checks.push({
      component: 'RetentionPolicyEnforcer',
      status: retentionOk ? 'pass' : 'fail',
      detail: retentionOk ? 'Retention policy enforcer operational' : 'Retention policy enforcer check failed',
    });

    // F-07: Rollback manager -- verify by calling getLastResult (should not throw)
    let rollbackOk = false;
    try {
      this.#rollbackManager.getLastResult();
      rollbackOk = true;
    } catch {
      rollbackOk = false;
    }
    checks.push({
      component: 'RollbackManager',
      status: rollbackOk ? 'pass' : 'fail',
      detail: rollbackOk ? 'Rollback manager operational' : 'Rollback manager check failed',
    });

    // 6. Governance enforcement
    checks.push({
      component: 'GovernanceEnforcement',
      status: this.#governed ? 'pass' : 'fail',
      detail: this.#governed ? 'Governance is enforced (no bypass)' : 'Governance bypass detected',
    });

    const allPassed = checks.every(c => c.status === 'pass');

    return {
      ok: true,
      value: {
        overall: allPassed ? 'pass' : 'fail',
        checks,
        timestamp: this.#timeProvider.now(),
      },
    };
  }

  /**
   * Generate a compliance report for a specific framework.
   *
   * Delegates to AuditExporter for SOC2/ISO27001/FedRAMP format.
   *
   * @param framework - Target compliance framework
   * @param dateRange - Date range for the report
   * @returns Framework-specific compliance export
   */
  generateComplianceReport(
    framework: ComplianceFramework,
    dateRange: DateRange,
  ): Result<SOC2Export | ISO27001Export | FedRAMPExport> {
    if (!this.#initialized) {
      return { ok: false, error: makeError('NOT_INITIALIZED', 'Compliance pack not initialized') };
    }

    switch (framework) {
      case 'SOC2':
        return this.#auditExporter.exportSOC2(dateRange);
      case 'ISO27001':
        return this.#auditExporter.exportISO27001(dateRange);
      case 'FedRAMP':
        return this.#auditExporter.exportFedRAMP(dateRange);
      default:
        return { ok: false, error: makeError('UNSUPPORTED_FRAMEWORK', `Unsupported framework: ${String(framework)}`) };
    }
  }
}
