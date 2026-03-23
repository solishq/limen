/**
 * Mission/Outcome Contract Model interfaces for Phase 0A governance layer.
 * Truth Model: Deliverable 4 (Mission/Outcome Contract Model)
 *
 * Phase: 0A (Governance Primitives)
 *
 * BC-030: MissionContract defines immutable success/outcome criteria.
 * BC-031: constitutionalMode per-tenant flag governs contract requirement.
 * BC-032: Contract satisfaction evaluated atomically with result finalization.
 * BC-033: ContractSatisfactionResult is typed (not boolean).
 * BC-034: constitutionalMode is one-way irreversible (false → true only).
 * BC-035: When constitutionalMode=true, all missions require a contract.
 * BC-036: When constitutionalMode=false, missions without contract are valid (v3.2 compat).
 * BC-037: Contract satisfaction returns specific unmet criteria on failure.
 * BC-038 (v1.1): constitutionalMode stored in kernel config (core_config), NOT gov_ tables.
 * INV-X04: Every entity carries schemaVersion.
 * INV-X06: constitutionalMode one-way irreversible.
 */

import type { MissionId, TenantId, Result } from './common.js';
import type { MissionContractId } from './governance_ids.js';
import type { DatabaseConnection } from './database.js';

// ─── Contract Criterion ───

/**
 * BC-030: Individual success criterion within a mission contract.
 * Each criterion has a description and an evaluation method identifier.
 */
export interface ContractCriterion {
  /** Human-readable description of the criterion */
  readonly description: string;
  /** Machine-readable evaluation method identifier */
  readonly evaluationMethod: string;
  /** Whether this criterion is required (true) or aspirational (false) */
  readonly required: boolean;
}

// ─── Mission Contract Entity ───

/**
 * BC-030: MissionContract — immutable definition of success/outcome criteria.
 * Once created, a contract is never modified. Versioning creates new contracts.
 * BC-035: When constitutionalMode=true, every mission must reference a contract.
 * INV-X04: schemaVersion tracks governance schema version.
 */
export interface MissionContract {
  readonly contractId: MissionContractId;
  readonly tenantId: string;
  /** Mission objective this contract governs */
  readonly objective: string;
  /** Constraints that bound the mission's execution */
  readonly constraints: Readonly<Record<string, unknown>>;
  /** Ordered list of criteria that define mission success. BC-030 */
  readonly criteria: readonly ContractCriterion[];
  /** INV-X04: Governance schema version */
  readonly schemaVersion: string;
  readonly createdAt: string;
}

// ─── Contract Satisfaction ───

/**
 * BC-033: Typed contract satisfaction result.
 * Not a boolean — carries structured detail about which criteria passed/failed.
 * BC-037: On failure, lists specific unmet criteria.
 */
export interface ContractSatisfactionResult {
  /** Overall satisfaction outcome */
  readonly satisfied: boolean;
  /** Per-criterion results */
  readonly criterionResults: readonly CriterionResult[];
  /** Timestamp of evaluation */
  readonly evaluatedAt: string;
}

/**
 * BC-037: Per-criterion evaluation result.
 * On failure, the reason is provided for programmatic analysis.
 */
export interface CriterionResult {
  /** Description of the criterion evaluated */
  readonly description: string;
  /** Whether this criterion was satisfied */
  readonly met: boolean;
  /** Reason for failure (present only when met=false) */
  readonly reason: string | null;
}

// ─── Store Interface ───

/**
 * MissionContract persistence operations.
 * BC-032: Evaluation is atomic with result finalization (one SQLite transaction).
 */
export interface MissionContractStore {
  create(conn: DatabaseConnection, contract: MissionContract): Result<MissionContract>;
  get(conn: DatabaseConnection, contractId: MissionContractId): Result<MissionContract | null>;
  /**
   * BC-032: Evaluate contract satisfaction atomically.
   * BC-033: Returns typed result, not boolean.
   * BC-037: On failure, lists unmet criteria.
   */
  evaluate(
    conn: DatabaseConnection,
    contractId: MissionContractId,
    missionId: MissionId,
  ): Result<ContractSatisfactionResult>;
}

/**
 * BC-034, BC-038 (v1.1): Constitutional mode management.
 * Stored in kernel config (core_config table), not governance tables.
 * INV-X06: One-way irreversible (false → true only).
 */
export interface ConstitutionalModeStore {
  /** Get the current constitutionalMode for a tenant */
  get(conn: DatabaseConnection, tenantId: TenantId): Result<boolean>;
  /**
   * BC-034: Enable constitutionalMode (one-way, irreversible).
   * Returns error if already enabled (idempotent) or if tenant not found.
   */
  enable(conn: DatabaseConnection, tenantId: TenantId): Result<void>;
}
