/*
 * Mandatory governance layer.
 * Contract refs: SHARED_TYPES.md §§8-10.1, §20; AGENT_ADAPTER_ARCHITECTURE.md Invariant 8; CREWAI_ADAPTER_CONTRACT.md Claims 1.4-1.7, 2.1.
 */

import {
  adapterError,
  brand,
  CLASSIFICATION_NUMERIC,
  ok,
  err,
  validateGovernanceDecision,
  type AdapterId,
  type AdapterKernelError,
  type ClassificationLevel,
  type GovernanceContext,
  type GovernanceDecision,
  type Permission,
  type Result,
} from '../types/index.js';

export interface GovernanceRequirement {
  readonly requiredPermissions: readonly Permission[];
  readonly clearanceRequired: number | null;
  readonly rule: string;
}

export interface GovernanceEngineOptions {
  readonly adapterId: AdapterId;
  readonly nowIso: () => string;
  readonly idFactory: () => string;
  readonly maxEvaluationMs?: number;
}

export class GovernanceEngine {
  private readonly maxEvaluationMs: number;

  public constructor(private readonly options: GovernanceEngineOptions) {
    this.maxEvaluationMs = options.maxEvaluationMs ?? 10;
  }

  // SHARED_TYPES.md §10.1: decisions are allow-only when verdict.verdict === 'allow' and include injected evaluatedAt.
  public evaluate(
    context: GovernanceContext,
    requirement: GovernanceRequirement,
  ): Result<GovernanceDecision, AdapterKernelError> {
    const started = performance.now();
    const missingPermissions = requirement.requiredPermissions.filter((permission) => !context.operationContext.permissions.has(permission));
    const actualClearance = context.operationContext.clearanceLevel ?? 0;
    const clearanceDenied = requirement.clearanceRequired !== null && actualClearance < requirement.clearanceRequired;
    const auditId = brand<'EventId'>(this.options.idFactory());
    const evaluatedAt = this.options.nowIso();
    const decision: GovernanceDecision = missingPermissions.length === 0 && !clearanceDenied
      ? {
          allowed: true,
          verdict: { verdict: 'allow', auditId },
          reason: null,
          requiredPermissions: requirement.requiredPermissions,
          missingPermissions,
          clearanceRequired: requirement.clearanceRequired,
          clearanceActual: actualClearance,
          evaluatedAt,
        }
      : {
          allowed: false,
          verdict: {
            verdict: 'refuse',
            auditId,
            reason: clearanceDenied ? 'clearance_below_required' : 'missing_required_permission',
            rule: requirement.rule,
          },
          reason: clearanceDenied ? 'clearance_below_required' : 'missing_required_permission',
          requiredPermissions: requirement.requiredPermissions,
          missingPermissions,
          clearanceRequired: requirement.clearanceRequired,
          clearanceActual: actualClearance,
          evaluatedAt,
        };
    const elapsedMs = performance.now() - started;
    if (elapsedMs > this.maxEvaluationMs) {
      return err(adapterError(
        this.options.adapterId,
        'PERFORMANCE_BUDGET_EXCEEDED',
        `Governance evaluation exceeded ${this.maxEvaluationMs}ms.`,
        'SHARED_TYPES.md §20',
        { elapsedMs, maxEvaluationMs: this.maxEvaluationMs },
      ));
    }
    if (!validateGovernanceDecision(decision)) {
      return err(adapterError(
        this.options.adapterId,
        'GOVERNANCE_UNAVAILABLE',
        'Governance decision failed canonical validation.',
        'SHARED_TYPES.md §10.1',
        { decision },
      ));
    }
    return ok(decision);
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 2.1: governed:false is rejected for every caller.
  public validateGovernedFlag(governed: boolean | undefined): Result<void, AdapterKernelError> {
    if (governed === false) {
      return err(adapterError(
        this.options.adapterId,
        'GOVERNANCE_REFUSAL',
        'governed:false is invalid because governance is non-optional.',
        'CREWAI_ADAPTER_CONTRACT.md Claim 2.1',
        { rule: 'governance_non_optional' },
      ));
    }
    return ok(undefined);
  }
}

// SHARED_TYPES.md §3 and CREWAI_ADAPTER_CONTRACT.md Claim 1.5: classification clearance is explicit.
export function clearanceForClassification(classification: ClassificationLevel): number {
  return CLASSIFICATION_NUMERIC[classification];
}
