/**
 * Agent management API wrapper for the API surface.
 * S ref: S12 (agent definitions), DL-2 (agent lifecycle), UC-4 (agent pipeline),
 *        I-08 (agent identity persistence), I-09 (trust progression),
 *        I-13 (RBAC), I-17 (governance boundary)
 *
 * Phase: Sprint 2 (Trust & Learning — I-09 Trust Progression)
 * Implements: SDD §7 build order item 9
 *
 * I-08: "Identity persists across engine restarts. Stored, not configured.
 * Agent versions immutable once deployed."
 *
 * I-09: "No agent starts with admin trust. Progression: untrusted → probationary
 * → trusted → admin (human grant only). Revocable on safety violation."
 *
 * All agent state persisted in core_agents table (migration v32).
 * Trust transitions recorded in core_trust_transitions (migration v33).
 * Safety violations recorded in core_safety_violations (migration v33).
 * No in-memory cache — single source of truth is SQLite.
 * Tenant isolation via COALESCE(tenant_id, '__NULL__') pattern on all queries.
 *
 * All mutations delegate to kernel database via getConnection().
 *
 * Invariants enforced: I-08, I-09, I-13 (RBAC), I-17 (governance boundary), FM-10 (tenant isolation)
 */

import type {
  OperationContext, DatabaseConnection, RateLimiter, RbacEngine,
  AgentId,
} from '../../kernel/interfaces/index.js';
import type {
  AgentApi, AgentRegistration, AgentView, PipelineStage, AgentPipeline,
  MissionResult, TrustPromotionOptions, SafetyViolationInput,
} from '../interfaces/api.js';
import { LimenError } from '../errors/limen_error.js';
import { requirePermission } from '../enforcement/rbac_guard.js';
import { requireRateLimit } from '../enforcement/rate_guard.js';
import {
  type TrustLevel,
  getNextTrustLevel,
  validatePromotion,
  checkSelfPromotion,
  getDemotionTarget,
} from './trust_progression.js';

// ============================================================================
// AgentApiImpl
// ============================================================================

/**
 * S12, DL-2, I-08: Agent management API implementation.
 *
 * Agent records are stored in the core_agents table (migration v32).
 * All queries are tenant-scoped via COALESCE pattern.
 * Triggers enforce version/name/id immutability and retired terminal state.
 */
// CF-014: Maximum registered agents per tenant
const MAX_AGENTS = 1_000;

// CF-028: Maximum capabilities per agent (prevent unbounded JSON)
const MAX_CAPABILITIES = 50;

// CF-028: Maximum domains per agent (prevent unbounded JSON)
const MAX_DOMAINS = 20;

/**
 * Row shape from core_agents SELECT queries.
 * Internal — never exposed to consumers.
 */
interface AgentRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly name: string;
  readonly version: number;
  readonly trust_level: string;
  readonly status: string;
  readonly system_prompt: string | null;
  readonly capabilities: string;
  readonly domains: string;
  readonly template: string | null;
  readonly hitl: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Map a database row to a frozen AgentView.
 * Only exposes fields declared in the AgentView interface (frozen zone).
 * C-07: Deep freeze on all returned objects.
 */
function rowToView(row: AgentRow): Readonly<AgentView> {
  let capabilities: readonly string[] = [];
  let domains: readonly string[] = [];

  try {
    const parsed = JSON.parse(row.capabilities);
    if (Array.isArray(parsed)) capabilities = parsed;
  } catch { /* malformed JSON → empty array */ }

  try {
    const parsed = JSON.parse(row.domains);
    if (Array.isArray(parsed)) domains = parsed;
  } catch { /* malformed JSON → empty array */ }

  return Object.freeze({
    id: row.id as AgentId,
    name: row.name,
    version: row.version,
    trustLevel: row.trust_level as AgentView['trustLevel'],
    status: row.status as AgentView['status'],
    capabilities: Object.freeze([...capabilities]),
    domains: Object.freeze([...domains]),
    createdAt: row.created_at,
  });
}

export class AgentApiImpl implements AgentApi {
  constructor(
    private readonly rbac: RbacEngine,
    private readonly rateLimiter: RateLimiter,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getContext: () => OperationContext,
    private readonly time?: import('../../kernel/interfaces/time.js').TimeProvider,
  ) {}

  /**
   * CF-028: Agent name validation pattern.
   * Alphanumeric, hyphens, underscores, dots. 1-128 chars.
   * S ref: S12 (agent definitions), I-07 (isolation), FM-10 (tenant scoping)
   */
  private static readonly AGENT_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

  /**
   * S12, I-08: Register a new agent.
   * Permission: 'create_agent'
   * CF-028: Validates agent name before registration.
   * CF-014: Enforces max agent count per tenant.
   * FM-10: Tenant isolation via COALESCE pattern.
   *
   * Agent state persisted in core_agents table. No in-memory cache.
   */
  async register(config: AgentRegistration): Promise<AgentView> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'create_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    // CF-028: Validate agent name to prevent injection
    if (!AgentApiImpl.AGENT_NAME_PATTERN.test(config.name)) {
      throw new LimenError('INVALID_INPUT',
        `Agent name must match [a-zA-Z0-9._-]{1,128}, got '${config.name.slice(0, 40)}'.`);
    }

    // CF-028: Validate capabilities array
    const capabilities = config.capabilities ? [...config.capabilities] : [];
    if (capabilities.length > MAX_CAPABILITIES) {
      throw new LimenError('INVALID_INPUT',
        `Agent capabilities exceed maximum of ${MAX_CAPABILITIES}.`);
    }
    for (const cap of capabilities) {
      if (!AgentApiImpl.AGENT_NAME_PATTERN.test(cap)) {
        throw new LimenError('INVALID_INPUT',
          `Capability name must match [a-zA-Z0-9._-]{1,128}, got '${String(cap).slice(0, 40)}'.`);
      }
    }

    // CF-028: Validate domains array
    const domains = config.domains ? [...config.domains] : [];
    if (domains.length > MAX_DOMAINS) {
      throw new LimenError('INVALID_INPUT',
        `Agent domains exceed maximum of ${MAX_DOMAINS}.`);
    }
    for (const domain of domains) {
      if (!AgentApiImpl.AGENT_NAME_PATTERN.test(domain)) {
        throw new LimenError('INVALID_INPUT',
          `Domain name must match [a-zA-Z0-9._-]{1,128}, got '${String(domain).slice(0, 40)}'.`);
      }
    }

    const tenantId = ctx.tenantId ?? null;

    // CF-014: Count existing agents for this tenant
    const countRow = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\')',
      [tenantId],
    );
    if (countRow && countRow.cnt >= MAX_AGENTS) {
      throw new LimenError('RATE_LIMITED',
        `Maximum registered agents (${MAX_AGENTS}) exceeded. Retire unused agents first.`);
    }

    const agentId = crypto.randomUUID() as AgentId;
    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();

    // Insert into core_agents with unique constraint on (tenant_id, name)
    try {
      conn.run(
        `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, system_prompt, capabilities, domains, template, hitl, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          agentId,
          tenantId,
          config.name,
          1,
          'untrusted',
          'registered',
          config.systemPrompt ?? null,
          JSON.stringify(capabilities),
          JSON.stringify(domains),
          config.template ?? null,
          config.hitl ? 1 : 0,
          now,
          now,
        ],
      );
    } catch (err: unknown) {
      // Handle UNIQUE constraint violation on (tenant_id, name)
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed') || message.includes('idx_core_agents_tenant_name')) {
        throw new LimenError('INVALID_INPUT',
          `Agent with name '${config.name}' already exists for this tenant.`);
      }
      throw err;
    }

    // Read back and return frozen view
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE id = ?',
      [agentId],
    );
    if (!row) {
      throw new LimenError('ENGINE_UNHEALTHY', 'Agent insert succeeded but read-back failed.');
    }
    return rowToView(row);
  }

  /**
   * DL-2, I-08: Pause an agent.
   * Permission: 'modify_agent'
   * FM-10: Tenant-scoped query via COALESCE pattern.
   * I-08: Retired agents rejected by trigger (AGENT_RETIRED_TERMINAL).
   */
  async pause(name: string): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'modify_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const tenantId = ctx.tenantId ?? null;
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) {
      throw new LimenError('AGENT_NOT_FOUND', `Agent '${name}' not found.`);
    }

    if (row.status === 'retired') {
      throw new LimenError('INVALID_INPUT', `Agent '${name}' is retired and cannot be modified.`);
    }

    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();
    conn.run(
      'UPDATE core_agents SET status = ?, updated_at = ? WHERE id = ?',
      ['paused', now, row.id],
    );
  }

  /**
   * DL-2, I-08: Resume a paused agent.
   * Permission: 'modify_agent'
   * FM-10: Tenant-scoped query via COALESCE pattern.
   * Only paused agents can be resumed. Returns to 'registered' status.
   */
  async resume(name: string): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'modify_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const tenantId = ctx.tenantId ?? null;
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) {
      throw new LimenError('AGENT_NOT_FOUND', `Agent '${name}' not found.`);
    }

    if (row.status !== 'paused') {
      throw new LimenError('INVALID_INPUT', `Agent '${name}' is not paused (current status: ${row.status}).`);
    }

    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();
    conn.run(
      'UPDATE core_agents SET status = ?, updated_at = ? WHERE id = ?',
      ['registered', now, row.id],
    );
  }

  /**
   * DL-2, I-08: Retire an agent permanently.
   * Permission: 'delete_agent'
   * FM-10: Tenant-scoped query via COALESCE pattern.
   * I-08: Retirement is terminal — trigger prevents further mutation.
   */
  async retire(name: string): Promise<void> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'delete_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const tenantId = ctx.tenantId ?? null;
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) {
      throw new LimenError('AGENT_NOT_FOUND', `Agent '${name}' not found.`);
    }

    if (row.status === 'retired') {
      throw new LimenError('INVALID_INPUT', `Agent '${name}' is already retired.`);
    }

    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();
    conn.run(
      'UPDATE core_agents SET status = ?, updated_at = ? WHERE id = ?',
      ['retired', now, row.id],
    );
  }

  /**
   * S12, I-08: Get agent by name.
   * FM-10: Tenant-scoped lookup prevents cross-tenant data leakage.
   * C-07: Returns frozen AgentView or null.
   */
  async get(name: string): Promise<AgentView | null> {
    const conn = this.getConnection();
    const ctx = this.getContext();
    const tenantId = ctx.tenantId ?? null;

    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) return null;
    return rowToView(row);
  }

  /**
   * S12, I-08: List all agents for current tenant.
   * FM-10: COALESCE pattern for tenant isolation.
   * C-07: Returns frozen array of frozen AgentViews.
   */
  async list(): Promise<readonly AgentView[]> {
    const conn = this.getConnection();
    const ctx = this.getContext();
    const tenantId = ctx.tenantId ?? null;

    const rows = conn.query<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\')',
      [tenantId],
    );
    return Object.freeze(rows.map(rowToView));
  }

  /**
   * I-09: Promote agent trust level.
   * Permission: 'modify_agent'
   * FM-10: Tenant-scoped query via COALESCE pattern.
   *
   * Trust state machine (I-09):
   *   Forward: untrusted→probationary, probationary→trusted, trusted→admin
   *   Admin requires actorType='human' (application-level AND trigger enforcement)
   *   No skipping levels (untrusted→trusted is INVALID)
   *   Retired agents cannot be promoted (blocked by retired terminal trigger)
   *   Self-promotion is blocked (Security critical finding)
   *
   * In a transaction:
   *   1. INSERT into core_trust_transitions (audit log)
   *   2. UPDATE core_agents trust_level
   *   3. Return updated AgentView
   */
  async promote(name: string, options?: TrustPromotionOptions): Promise<AgentView> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'modify_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const tenantId = ctx.tenantId ?? null;
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) {
      throw new LimenError('AGENT_NOT_FOUND', `Agent '${name}' not found.`);
    }

    // Retired agents cannot be promoted (terminal state)
    if (row.status === 'retired') {
      throw new LimenError('INVALID_INPUT', `Agent '${name}' is retired and cannot be promoted.`);
    }

    // Self-promotion prevention (Security critical)
    const selfCheck = checkSelfPromotion(ctx.agentId, row.id);
    if (!selfCheck.allowed) {
      throw new LimenError('INVALID_INPUT', selfCheck.reason);
    }

    const currentLevel = row.trust_level as TrustLevel;
    const actorType = options?.actorType ?? 'system';

    // Determine target level
    let targetLevel: TrustLevel;
    if (options?.targetLevel) {
      targetLevel = options.targetLevel;
    } else {
      const next = getNextTrustLevel(currentLevel);
      if (!next) {
        throw new LimenError('INVALID_INPUT', `Agent '${name}' is already at admin trust level.`);
      }
      targetLevel = next;
    }

    // Validate the promotion via state machine
    const validation = validatePromotion(currentLevel, targetLevel, actorType);
    if (!validation.valid) {
      throw new LimenError('INVALID_INPUT', validation.reason);
    }

    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();
    const transitionId = crypto.randomUUID();

    // Transaction: INSERT transition record + UPDATE trust level
    // The trigger on core_agents will verify the transition record exists for admin promotion
    conn.transaction(() => {
      // 1. INSERT transition audit record
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transitionId,
          tenantId,
          row.id,
          currentLevel,
          targetLevel,
          actorType,
          options?.actorId ?? null,
          options?.reason ?? `Promoted from ${currentLevel} to ${targetLevel}`,
          JSON.stringify({}),
          now,
        ],
      );

      // 2. UPDATE agent trust level
      // For admin promotion, the trg_core_agents_trust_admin_guard_v2 trigger
      // will verify the transition record exists with actor_type='human'
      conn.run(
        'UPDATE core_agents SET trust_level = ?, updated_at = ? WHERE id = ?',
        [targetLevel, now, row.id],
      );
    });

    // Read back and return frozen view
    const updatedRow = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE id = ?',
      [row.id],
    );
    if (!updatedRow) {
      throw new LimenError('ENGINE_UNHEALTHY', 'Trust promotion succeeded but read-back failed.');
    }
    return rowToView(updatedRow);
  }

  /**
   * I-09: Record a safety violation against an agent.
   * Permission: 'modify_agent'
   * FM-10: Tenant-scoped query via COALESCE pattern.
   *
   * Records the violation and determines automatic trust demotion:
   *   critical/high severity → demote to untrusted
   *   low/medium on admin → demote to trusted
   *   low/medium on trusted → demote to probationary
   *   low/medium on probationary → demote to untrusted
   *   any on untrusted → no demotion (already lowest)
   *
   * In a transaction:
   *   1. INSERT into core_safety_violations
   *   2. If demotion needed: INSERT into core_trust_transitions + UPDATE core_agents
   *   3. Return updated AgentView
   */
  async recordViolation(name: string, violation: SafetyViolationInput): Promise<AgentView> {
    const conn = this.getConnection();
    const ctx = this.getContext();

    requirePermission(this.rbac, ctx, 'modify_agent');
    requireRateLimit(this.rateLimiter, conn, ctx, 'api_calls');

    const tenantId = ctx.tenantId ?? null;
    const row = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE COALESCE(tenant_id, \'__NULL__\') = COALESCE(?, \'__NULL__\') AND name = ?',
      [tenantId, name],
    );
    if (!row) {
      throw new LimenError('AGENT_NOT_FOUND', `Agent '${name}' not found.`);
    }

    const currentLevel = row.trust_level as TrustLevel;
    const now = (this.time ?? { nowISO: () => new Date().toISOString() }).nowISO();
    const violationId = crypto.randomUUID();

    // F-S2-001: Retired agents — record violation but skip demotion path.
    // The retired terminal trigger (trg_core_agents_retired_terminal) ABORTs any UPDATE
    // on core_agents for retired agents. If we attempt demotion inside the same transaction
    // as the violation INSERT, the rollback loses the violation record entirely.
    // Fix: detect retired status BEFORE the transaction, and handle separately.
    if (row.status === 'retired') {
      // Record the violation outside a transaction that would touch core_agents.
      // demotion_applied = 0: retired agents cannot be demoted (terminal state).
      conn.run(
        `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, evidence_json, demotion_applied, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          violationId,
          tenantId,
          row.id,
          violation.violationType,
          violation.severity,
          violation.description,
          JSON.stringify(violation.evidence ?? {}),
          0,
          now,
        ],
      );

      // Return agent view as-is — no mutation on retired agents.
      return rowToView(row);
    }

    const demotionTarget = getDemotionTarget(currentLevel, violation.severity);

    conn.transaction(() => {
      // 1. INSERT safety violation record
      conn.run(
        `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, evidence_json, demotion_applied, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          violationId,
          tenantId,
          row.id,
          violation.violationType,
          violation.severity,
          violation.description,
          JSON.stringify(violation.evidence ?? {}),
          demotionTarget ? 1 : 0,
          now,
        ],
      );

      // 2. If demotion needed, record transition and update trust level
      if (demotionTarget) {
        const transitionId = crypto.randomUUID();
        conn.run(
          `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transitionId,
            tenantId,
            row.id,
            currentLevel,
            demotionTarget,
            'policy',
            'safety-violation-demotion',
            `Automatic demotion due to ${violation.severity} ${violation.violationType} violation: ${violation.description}`,
            JSON.stringify({ violationId, severity: violation.severity, violationType: violation.violationType }),
            now,
          ],
        );

        conn.run(
          'UPDATE core_agents SET trust_level = ?, updated_at = ? WHERE id = ?',
          [demotionTarget, now, row.id],
        );
      }
    });

    // Read back and return frozen view
    const updatedRow = conn.get<AgentRow>(
      'SELECT * FROM core_agents WHERE id = ?',
      [row.id],
    );
    if (!updatedRow) {
      throw new LimenError('ENGINE_UNHEALTHY', 'Violation recording succeeded but read-back failed.');
    }
    return rowToView(updatedRow);
  }

  /**
   * UC-4, A-05: Create a typed agent pipeline for sequential processing.
   * Internally creates a mission with a linear task graph (A-05).
   */
  pipeline(_stages: readonly PipelineStage[]): AgentPipeline {
    const impl = this;

    return {
      async execute(_input: Record<string, unknown>): Promise<MissionResult> {
        const conn = impl.getConnection();
        const ctx = impl.getContext();

        requirePermission(impl.rbac, ctx, 'create_mission');
        requireRateLimit(impl.rateLimiter, conn, ctx, 'api_calls');

        // Pipeline creates a mission per stage and chains them
        // This is a convenience wrapper; actual implementation would use SC-1, SC-2
        throw new LimenError('ENGINE_UNHEALTHY', 'Pipeline execution requires full orchestration wiring.');
      },
    };
  }
}
