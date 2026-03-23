/**
 * Eval Schema interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 8 (Eval Schema)
 *
 * Phase: 0A (Foundation)
 *
 * BC-090: EvalCase is an immutable evaluation record.
 * BC-091: EvalCase created atomically with result finalization (one SQLite transaction).
 * BC-092: EvalCase references MissionContractId (not a copy of the contract).
 * BC-093: EvalCase carries pinnedVersions for replay stability.
 * BC-094: EvalProvenance includes agent/capability/prompt version metadata.
 * BC-095: When constitutionalMode=true, no Attempt completion without EvalCase.
 * INV-X04: Every entity carries schemaVersion.
 * EDGE-091: Legacy mode — eval case created with contractSatisfaction=null.
 */

import type { Result } from './common.js';
import type { EvalCaseId, AttemptId, MissionContractId } from './governance_ids.js';
import type { DatabaseConnection } from './database.js';

// ─── Eval Dimension ───

/**
 * BC-090: Individual evaluation dimension within an eval case.
 * Each dimension represents a measurable quality aspect.
 */
export interface EvalDimension {
  /** Dimension name (e.g., 'accuracy', 'completeness', 'relevance') */
  readonly name: string;
  /** Numeric score for this dimension */
  readonly score: number;
  /** Maximum possible score for this dimension */
  readonly maxScore: number;
  /** Optional evaluator rationale */
  readonly rationale?: string;
}

// ─── Eval Provenance ───

/**
 * BC-094: Provenance metadata for evaluation reproducibility.
 * schemaVersion is MUST (INV-X04). Others are SHOULD for v1.
 */
export interface EvalProvenance {
  /** MUST: Eval schema version (INV-X04, Amendment A12) */
  readonly evalSchemaVersion: string;
  /** SHOULD: Agent version that produced the result being evaluated */
  readonly agentVersion?: string;
  /** SHOULD: Capability snapshot at time of execution */
  readonly capabilitySnapshot?: string;
  /** SHOULD: Prompt version used during execution */
  readonly promptVersion?: string;
}

// ─── Eval Case Entity ───

/**
 * BC-090: EvalCase — immutable evaluation record.
 * BC-091: Created atomically with result finalization.
 * BC-092: References MissionContractId, not a contract copy.
 * BC-093: Carries pinnedVersions (traceGrammarVersion, evalSchemaVersion, missionContractVersion).
 * EDGE-091: When constitutionalMode=false, contractSatisfaction may be null.
 */
export interface EvalCase {
  readonly evalCaseId: EvalCaseId;
  readonly tenantId: string;
  /** BC-091: Attempt this eval case evaluates */
  readonly attemptId: AttemptId;
  /** BC-092: Reference to the governing contract (null in legacy mode) */
  readonly contractId: MissionContractId | null;
  /** Evaluation dimensions with scores */
  readonly dimensions: readonly EvalDimension[];
  /** BC-094: Provenance metadata */
  readonly provenance: EvalProvenance;
  /** BC-093: Pinned governance schema versions */
  readonly pinnedVersions: EvalPinnedVersions;
  /** Contract satisfaction result (null in legacy mode per EDGE-091) */
  readonly contractSatisfaction: boolean | null;
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
  readonly createdAt: string;
}

/**
 * BC-093: Version pinning for eval replay stability.
 */
export interface EvalPinnedVersions {
  readonly traceGrammarVersion: string;
  readonly evalSchemaVersion: string;
  readonly missionContractVersion: string;
}

// ─── Store Interface ───

/**
 * EvalCase persistence operations.
 * BC-091: Creation is atomic with result finalization.
 * BC-095: When constitutionalMode=true, Attempt cannot complete without EvalCase.
 */
export interface EvalCaseStore {
  /** BC-091: Create eval case atomically */
  create(conn: DatabaseConnection, evalCase: EvalCase): Result<EvalCase>;
  get(conn: DatabaseConnection, evalCaseId: EvalCaseId): Result<EvalCase | null>;
  getByAttempt(conn: DatabaseConnection, attemptId: AttemptId): Result<EvalCase | null>;
  getByContract(conn: DatabaseConnection, contractId: MissionContractId): Result<readonly EvalCase[]>;
}
