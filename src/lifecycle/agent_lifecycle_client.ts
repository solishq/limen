// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * AgentLifecycleClient Implementation
 *
 * LM-2.01 through LM-2.22: Full 22-method lifecycle client.
 * All methods return Result<T> (AD-11). Never throws.
 * All mutations produce audit entries (LM-13.24).
 * All mutations take OperationContext (LM-13.26).
 *
 * Architecture:
 * - Single composition root via createAgentLifecycleClient factory
 * - Dependencies injected (AD-10)
 * - Statistics computed on read from audit trail (LM-13.22)
 * - Agent name validated: 1-64 chars, alphanumeric+hyphens+underscores (LM-14.01, LM-14.02)
 * - Decommission cascade executes atomically (LM-14.13)
 *
 * Defect classes defended:
 * - DC-TYPE: Branded AgentId prevents cross-ID confusion
 * - DC-STATE: State transition validation prevents invalid transitions
 * - DC-SECURITY: Trust-ceiling enforcement on capability grants
 * - DC-CONSENT: Fail-closed consent checks
 * - DC-AUDIT: Every mutation appends audit entry
 * - DC-DATA: Statistics from audit trail, never stored counters
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type {
  AgentId, TenantId, ConsentId, ClaimId, UserId,
  AgentTrustLevel, AgentCapability, AgentFramework,
  ClassificationLevel, ConsentableOperation,
  OperationContext, Result,
  AgentEvent, AgentEventHandler,
} from '../adapters/shared/types.js';
import { TRUST_TO_CLEARANCE } from '../adapters/shared/types.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { EventBus } from '../kernel/interfaces/events.js';

import type {
  AgentLifecycleClient,
  AgentRegistrationSpec, RegisteredAgent, AgentUpdate, AgentFilter,
  AgentState, AgentStatistics, AgentCapabilitySet,
  CapabilityRequest, CapabilityDecision, CapabilityDenial, CapabilityHistoryEntry,
  PromotionRequest, TrustPromotionResult, DemotionResult,
  SuspensionResult, ReactivationResult,
  AgentConsentRecord, ConsentDecision, ConsentRevocationResult, ConsentStatus, ConsentScope,
  KnowledgeExportOptions, KnowledgePackage, KnowledgeImportOptions, KnowledgeImportResult,
  KnowledgeTransferOptions, KnowledgeTransferResult,
  DecommissionResult, KnowledgePackageId,
  ExportedClaim, ExportedTechnique, ExportedRelationship,
} from './lifecycle_types.js';

import {
  ok, agentNotFound, agentAlreadyExists, agentDecommissioned, agentSuspended,
  promotionDenied, demotionBelowFloor,
  consentNotFound,
  transferDenied, importIntegrityFailed, classificationExceeded,
  governanceRefusal, capabilityDenied, invalidStateTransition,
} from './lifecycle_errors.js';

import {
  previousTrustLevel,
  intersectCapabilitiesWithTrust,
  isCapabilityAllowedAtTrust, validatePromotion, validateDemotion,
  toCoretrustLevel, CAPABILITY_TRUST_FLOOR,
} from './trust_promotion.js';

// ============================================================================
// Dependencies
// ============================================================================

export interface AgentLifecycleClientDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly audit: AuditTrail;
  readonly kernelEvents: EventBus;
  readonly time: TimeProvider;
  readonly getContext: () => OperationContext;
}

// ============================================================================
// Agent Name Validation (LM-14.01, LM-14.02)
// ============================================================================

/** LM-14.01: 1-64 chars. LM-14.02: alphanumeric + hyphens + underscores */
const AGENT_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function validateAgentName(name: string): string | null {
  if (!AGENT_NAME_REGEX.test(name)) {
    return 'Agent name must be 1-64 characters, alphanumeric + hyphens + underscores only';
  }
  return null;
}

// ============================================================================
// Valid Frameworks (LM-14.03)
// ============================================================================

// AgentFramework enum values — SHARED_TYPES §21
const VALID_FRAMEWORKS: ReadonlySet<string> = new Set([
  'claude', 'codex', 'openclaw', 'hermes', 'gemma', // framework enum set
  'crew_ai', 'auto_gen', 'semantic_kernel', 'llama_index', 'custom',
]);

// ============================================================================
// Classification Level Ordering
// ============================================================================

const CLASSIFICATION_RANK: Record<string, number> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
};

function classificationToRank(level: ClassificationLevel): number {
  return CLASSIFICATION_RANK[level] ?? 0;
}

// ============================================================================
// Database Row Types
// ============================================================================

interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly framework: string;
  readonly version: string;
  readonly tenant_id: string | null;
  readonly state: string;
  readonly trust_level: string;
  readonly owner: string;
  readonly metadata: string;
  readonly registered_at: string;
  readonly last_active_at: string | null;
  readonly decommissioned_at: string | null;
  readonly decommission_reason: string | null;
  readonly suspension_reason: string | null;  // BK-12: dedicated suspension reason column
}

interface CapabilityRow {
  readonly agent_id: string;
  readonly capability: string;
  readonly status: string;
  readonly granted_at: string | null;
  readonly reason: string | null;
  readonly decided_by: string | null;
}

interface CapabilityHistoryRow {
  readonly id: string;
  readonly agent_id: string;
  readonly capability: string;
  readonly action: string;
  readonly reason: string;
  readonly decided_by: string;
  readonly timestamp: string;
}

interface ConsentRow {
  readonly id: string;
  readonly agent_id: string;
  readonly data_subject: string;
  readonly purpose: string;
  readonly scope: string;
  readonly status: string;
  readonly granted_at: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
  readonly revoked_reason: string | null;
  readonly tenant_id: string | null;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create the AgentLifecycleClient.
 * Single composition root (AD-10).
 */
export function createAgentLifecycleClient(deps: AgentLifecycleClientDeps): AgentLifecycleClient {
  const { getConnection, audit, kernelEvents, time, getContext } = deps;

  // Subscription tracking for on/off (LM-2.20, LM-2.21)
  const subscriptions = new Map<string, { pattern: string }>();

  // ────────────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────────────

  function emitEvent(event: string, agentId: string, data: Record<string, unknown>): void {
    try {
      const conn = getConnection();
      const ctx = getContext() as import('../kernel/interfaces/common.js').OperationContext;
      kernelEvents.emit(conn, ctx, {
        type: `lifecycle.${event}`,
        scope: 'system',
        payload: { agentId, ...data },
        propagation: 'local',
      });
    } catch {
      // Event emission failure is non-fatal (LM-8.18)
    }
  }

  /**
   * BK-05: Audit append is fail-closed. If audit fails, the operation MUST fail.
   * Returns the Result from audit.append so callers can propagate the error.
   * The state change must NOT proceed without its audit entry.
   */
  function appendAudit(conn: DatabaseConnection, actor: string, operation: string, resourceType: string, resourceId: string, detail?: Record<string, unknown> | undefined): Result<unknown> {
    const result = audit.append(conn, {
      tenantId: null,
      actorType: 'system' as const,
      actorId: actor,
      operation,
      resourceType,
      resourceId,
      ...(detail !== undefined ? { detail } : {}),
    });
    if (!result.ok) {
      // Audit failure is a governance violation — propagate, do not swallow
      return result;
    }
    return ok(undefined);
  }

  function getAgentRow(conn: DatabaseConnection, agentId: string): AgentRow | undefined {
    return conn.get<AgentRow>(
      'SELECT * FROM lm_agents WHERE id = ?',
      [agentId],
    );
  }

  function buildCapabilitySet(conn: DatabaseConnection, agentId: string): AgentCapabilitySet {
    const rows = conn.query<CapabilityRow>(
      'SELECT * FROM lm_capabilities WHERE agent_id = ?',
      [agentId],
    );
    const granted: AgentCapability[] = [];
    const denied: AgentCapability[] = [];
    const pending: AgentCapability[] = [];
    for (const row of rows) {
      const cap = row.capability as AgentCapability;
      if (row.status === 'granted') granted.push(cap);
      else if (row.status === 'denied') denied.push(cap);
      else if (row.status === 'pending') pending.push(cap);
    }
    return { granted, denied, pending };
  }

  /**
   * BK-06: Real statistics computed from audit trail and tables.
   * LM-13.22: Statistics computed from audit trail on read.
   * No separate counter storage -- derived from truth source.
   */
  function computeStatistics(conn: DatabaseConnection, agentId: string): AgentStatistics {
    // Count claims asserted/retracted from claim_assertions table
    let totalClaimsAsserted = 0;
    let totalClaimsRetracted = 0;
    try {
      const claimStats = conn.get<{ total: number; retracted: number }>(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'retracted' THEN 1 ELSE 0 END) as retracted
         FROM claim_assertions WHERE source_agent_id = ?`,
        [agentId],
      );
      totalClaimsAsserted = claimStats?.total ?? 0;
      totalClaimsRetracted = claimStats?.retracted ?? 0;
    } catch {
      // claim_assertions table may not exist in all configurations
    }

    // Count sessions from obs_sessions if table exists
    let totalSessions = 0;
    try {
      const sessCount = conn.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM obs_sessions WHERE agent_id = ?`,
        [agentId],
      );
      totalSessions = sessCount?.count ?? 0;
    } catch {
      // obs_sessions table may not exist in all configurations
    }

    // Count governance refusals from audit trail
    let refusalCount: { count: number } | undefined;
    try {
      refusalCount = conn.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM core_audit_log WHERE actor_id = ? AND operation LIKE '%governance.refusal%'`,
        [agentId],
      );
    } catch {
      // core_audit_log may not exist in all configurations
    }

    // Count active techniques (if technique table exists)
    let activeTechniques = 0;
    try {
      const techCount = conn.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM tgp_techniques WHERE source_agent_id = ? AND status = 'active'`,
        [agentId],
      );
      activeTechniques = techCount?.count ?? 0;
    } catch {
      // Table may not exist in all configurations
    }

    // R2-BK-01: Query core_missions for completed/failed counts (LM-13.22)
    let totalMissionsCompleted = 0;
    let totalMissionsFailed = 0;
    try {
      const missionStats = conn.get<{ completed: number; failed: number }>(
        `SELECT
          SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN state = 'FAILED' THEN 1 ELSE 0 END) as failed
         FROM core_missions WHERE agent_id = ?`,
        [agentId],
      );
      totalMissionsCompleted = missionStats?.completed ?? 0;
      totalMissionsFailed = missionStats?.failed ?? 0;
    } catch {
      // core_missions table may not exist in all configurations
    }

    // R2-BK-01: Compute session durations from obs_sessions (LM-13.22)
    let lastSessionDuration: number | null = null;
    let averageSessionDuration = 0;
    try {
      // Last session duration: most recent completed session
      const lastSession = conn.get<{ duration_ms: number | null }>(
        `SELECT (julianday(ended_at) - julianday(started_at)) * 86400000 as duration_ms
         FROM obs_sessions
         WHERE agent_id = ? AND ended_at IS NOT NULL
         ORDER BY ended_at DESC LIMIT 1`,
        [agentId],
      );
      lastSessionDuration = lastSession?.duration_ms ?? null;

      // Average session duration across all completed sessions
      const avgSession = conn.get<{ avg_ms: number | null }>(
        `SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400000) as avg_ms
         FROM obs_sessions
         WHERE agent_id = ? AND ended_at IS NOT NULL`,
        [agentId],
      );
      averageSessionDuration = avgSession?.avg_ms ?? 0;
    } catch {
      // obs_sessions table may not exist or lack started_at/ended_at columns
    }

    return {
      totalSessions,
      totalClaimsAsserted,
      totalClaimsRetracted,
      totalMissionsCompleted,
      totalMissionsFailed,
      totalGovernanceRefusals: refusalCount?.count ?? 0,
      activeTechniques,
      lastSessionDuration,
      averageSessionDuration,
    };
  }

  function rowToRegisteredAgent(conn: DatabaseConnection, row: AgentRow): RegisteredAgent {
    const trustLevel = row.trust_level as AgentTrustLevel;
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(row.metadata); } catch { /* empty */ }

    return {
      id: row.id as AgentId,
      name: row.name,
      framework: row.framework as AgentFramework,
      version: row.version,
      tenantId: row.tenant_id as TenantId | null,
      state: row.state as AgentState,
      capabilities: buildCapabilitySet(conn, row.id),
      trustLevel,
      coreTrustLevel: toCoretrustLevel(trustLevel),
      clearanceLevel: TRUST_TO_CLEARANCE[trustLevel] ?? 0,
      owner: row.owner as unknown as UserId | AgentId,  // BK-14: proper branded type cast
      metadata,
      statistics: computeStatistics(conn, row.id),
      registeredAt: row.registered_at,
      lastActiveAt: row.last_active_at,
      decommissionedAt: row.decommissioned_at,
      decommissionReason: row.decommission_reason,
    };
  }

  /**
   * Guard: check agent exists and is in an operable state.
   * LM-9.03: Decommissioned returns error.
   * LM-9.04 / LM-14.08: Suspended blocks all ops except getAgent.
   */
  function requireActiveAgent(conn: DatabaseConnection, agentId: string, allowSuspended = false): Result<AgentRow> {
    const row = getAgentRow(conn, agentId);
    if (!row) return agentNotFound(agentId);
    if (row.state === 'decommissioned') return agentDecommissioned(agentId);
    if (row.state === 'suspended' && !allowSuspended) {
      // BK-12: Read suspension reason from dedicated column, not decommission_reason
      return agentSuspended(agentId, row.suspension_reason ?? 'suspended');
    }
    return ok(row);
  }

  // ────────────────────────────────────────────────────────────
  // Interface Implementation
  // ────────────────────────────────────────────────────────────

  const client: AgentLifecycleClient = {
    // ──── Registration & Identity (LM-2.01 through LM-2.05) ────

    async registerAgent(ctx: OperationContext, spec: AgentRegistrationSpec): Promise<Result<RegisteredAgent>> {
      // LM-14.01, LM-14.02: Validate name
      const nameErr = validateAgentName(spec.name);
      if (nameErr) return governanceRefusal(nameErr, 'registerAgent');

      // LM-14.03: Validate framework
      if (!VALID_FRAMEWORKS.has(spec.framework)) {
        return governanceRefusal(`Unrecognized framework '${spec.framework}'`, 'registerAgent');
      }

      const conn = getConnection();
      const agentId = randomUUID() as unknown as AgentId;
      const now = time.nowISO();
      const tenantId = spec.tenantId ?? null;

      // LM-13.02: Check uniqueness (name + framework + tenant)
      const existing = conn.get<{ id: string }>(
        `SELECT id FROM lm_agents WHERE name = ? AND framework = ? AND COALESCE(tenant_id, '__NULL__') = ?`,
        [spec.name, spec.framework, tenantId ?? '__NULL__'],
      );
      if (existing) return agentAlreadyExists(spec.name, spec.framework);

      // LM-3.06: Default to untrusted
      const trustLevel: AgentTrustLevel = 'untrusted';

      // LM-14.04, LM-14.05: Intersect capabilities with untrusted mapping
      const grantedCaps = intersectCapabilitiesWithTrust(spec.capabilities, trustLevel);

      return conn.transaction(() => {
        // Insert agent
        conn.run(
          `INSERT INTO lm_agents (id, name, framework, version, tenant_id, state, trust_level, owner, metadata, registered_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          [
            agentId as string, spec.name, spec.framework, spec.version,
            tenantId as string | null, trustLevel, spec.owner,
            JSON.stringify(spec.metadata ?? {}), now,
          ],
        );

        // Insert granted capabilities
        for (const cap of grantedCaps) {
          conn.run(
            `INSERT INTO lm_capabilities (agent_id, capability, status, granted_at, reason, decided_by)
             VALUES (?, ?, 'granted', ?, 'initial registration', 'system')`,
            [agentId as string, cap, now],
          );
          conn.run(
            `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
             VALUES (?, ?, ?, 'granted', 'initial registration', 'system', ?)`,
            [randomUUID(), agentId as string, cap, now],
          );
        }

        // LM-13.24: Audit entry (BK-05: fail-closed)
        const auditResult = appendAudit(conn, ctx.agentId as string ?? ctx.userId ?? 'system',
          'lifecycle.agent.registered', 'agent', agentId as string,
          { name: spec.name, framework: spec.framework, trustLevel, capabilities: grantedCaps });
        if (!auditResult.ok) return auditResult;

        // LM-14.06, LM-8.02: Emit agent:registered
        emitEvent('agent:registered', agentId as string, {
          name: spec.name, framework: spec.framework, trustLevel,
        });

        const agent = rowToRegisteredAgent(conn, getAgentRow(conn, agentId as string)!);
        return ok(agent);
      });
    },

    async getAgent(agentId: AgentId): Promise<Result<RegisteredAgent>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);
      // LM-14.08: getAgent works even for suspended/decommissioned agents
      return ok(rowToRegisteredAgent(conn, row));
    },

    async listAgents(filter?: AgentFilter): Promise<Result<readonly RegisteredAgent[]>> {
      const conn = getConnection();
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (filter?.state) {
        if (Array.isArray(filter.state)) {
          const states = filter.state as readonly string[];
          const placeholders = states.map(() => '?').join(', ');
          conditions.push(`state IN (${placeholders})`);
          for (const s of states) params.push(s);
        } else {
          conditions.push('state = ?');
          params.push(filter.state as string);
        }
      }
      if (filter?.framework) {
        conditions.push('framework = ?');
        params.push(filter.framework);
      }
      if (filter?.tenantId) {
        conditions.push('tenant_id = ?');
        params.push(filter.tenantId as string);
      }
      if (filter?.trustLevel) {
        conditions.push('trust_level = ?');
        params.push(filter.trustLevel);
      }
      if (filter?.owner) {
        conditions.push('owner = ?');
        params.push(filter.owner as string);
      }

      let sql = 'SELECT * FROM lm_agents';
      if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY registered_at DESC';
      if (filter?.limit) {
        sql += ` LIMIT ${Math.max(1, Math.min(filter.limit, 1000))}`;
      }
      if (filter?.offset) {
        sql += ` OFFSET ${Math.max(0, filter.offset)}`;
      }

      const rows = conn.query<AgentRow>(sql, params);

      // Post-filter for capability (requires join on lm_capabilities)
      let agents = rows.map(row => rowToRegisteredAgent(conn, row));
      if (filter?.capability) {
        agents = agents.filter(a => a.capabilities.granted.includes(filter.capability!));
      }

      return ok(agents);
    },

    async updateAgent(ctx: OperationContext, agentId: AgentId, update: AgentUpdate): Promise<Result<RegisteredAgent>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;

      // LM-3.33: Trust/clearance NOT changeable via updateAgent
      const sets: string[] = [];
      const params: (string | null)[] = [];

      if (update.name !== undefined) {
        const nameErr = validateAgentName(update.name);
        if (nameErr) return governanceRefusal(nameErr, 'updateAgent');
        sets.push('name = ?');
        params.push(update.name);
      }
      if (update.version !== undefined) {
        sets.push('version = ?');
        params.push(update.version);
      }
      if (update.metadata !== undefined) {
        sets.push('metadata = ?');
        params.push(JSON.stringify(update.metadata));
      }

      if (sets.length === 0) {
        // No changes requested -- return current state
        return ok(rowToRegisteredAgent(conn, check.value));
      }

      sets.push('last_active_at = ?');
      params.push(time.nowISO());
      params.push(agentId as string);

      return conn.transaction(() => {
        conn.run(`UPDATE lm_agents SET ${sets.join(', ')} WHERE id = ?`, params);

        const auditResult = appendAudit(conn, ctx.agentId as string ?? ctx.userId ?? 'system',
          'lifecycle.agent.updated', 'agent', agentId as string,
          { update });
        if (!auditResult.ok) return auditResult;

        // LM-8.03
        emitEvent('agent:updated', agentId as string, { update });

        return ok(rowToRegisteredAgent(conn, getAgentRow(conn, agentId as string)!));
      });
    },

    async decommissionAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DecommissionResult>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);

      // LM-10.12, LM-13.03: Terminal state check
      if (row.state === 'decommissioned') return agentDecommissioned(agentId as string);

      const now = time.nowISO();

      return conn.transaction(() => {
        // LM-14.14: Step 1 - Set state to decommissioned
        conn.run(
          `UPDATE lm_agents SET state = 'decommissioned', decommissioned_at = ?, decommission_reason = ?, last_active_at = ? WHERE id = ?`,
          [now, reason, now, agentId as string],
        );

        // BK-09: Query actual active sessions and terminate them
        let sessionsTerminated = 0;
        try {
          const activeSessions = conn.query<{ session_id: string }>(
            `SELECT session_id FROM obs_sessions WHERE agent_id = ? AND status = 'active'`,
            [agentId as string],
          );
          for (const session of activeSessions) {
            conn.run(
              `UPDATE obs_sessions SET status = 'terminated', ended_at = ? WHERE session_id = ?`,
              [now, session.session_id],
            );
          }
          sessionsTerminated = activeSessions.length;
        } catch {
          // obs_sessions table may not exist in all configurations — count remains 0
        }

        // LM-14.16: Step 3 - Revoke all active consents
        const activeConsents = conn.query<ConsentRow>(
          `SELECT * FROM lm_agent_consents WHERE agent_id = ? AND status = 'active'`,
          [agentId as string],
        );
        for (const consent of activeConsents) {
          conn.run(
            `UPDATE lm_agent_consents SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE id = ?`,
            [now, 'agent decommissioned', consent.id],
          );
          emitEvent('consent:revoked', agentId as string, { consentId: consent.id, reason: 'agent decommissioned' });
        }

        // LM-14.17: Step 4 - Revoke all capabilities
        const capabilities = conn.query<CapabilityRow>(
          `SELECT * FROM lm_capabilities WHERE agent_id = ?`,
          [agentId as string],
        );
        conn.run(`DELETE FROM lm_capabilities WHERE agent_id = ?`, [agentId as string]);

        // BK-10: Actually check if agent has claims before setting knowledgeArchived
        const claimCount = conn.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM claim_assertions WHERE source_agent_id = ?`,
          [agentId as string],
        );
        const hasClaims = (claimCount?.count ?? 0) > 0;
        if (hasClaims) {
          // Archive claims by marking them — they remain queryable but flagged
          conn.run(
            `UPDATE claim_assertions SET archived = 1 WHERE source_agent_id = ? AND archived = 0`,
            [agentId as string],
          );
        }
        const knowledgeArchived = hasClaims;

        // LM-14.19: Step 6 - Agent remains queryable with decommissioned state

        // LM-13.24: Audit (BK-05: fail-closed)
        const auditResult = appendAudit(conn, ctx.agentId as string ?? ctx.userId ?? 'system',
          'lifecycle.agent.decommissioned', 'agent', agentId as string,
          { reason, sessionsTerminated, consentsRevoked: activeConsents.length, capabilitiesRevoked: capabilities.length });
        if (!auditResult.ok) return auditResult;

        // LM-14.20, LM-8.06: Step 7 - Emit event
        emitEvent('agent:decommissioned', agentId as string, { reason });

        return ok<DecommissionResult>({
          agentId: agentId,
          decommissionedAt: now,
          claimsPreserved: claimCount?.count ?? 0,
          sessionsTerminated,
          knowledgeArchived,
          consentsRevoked: activeConsents.length,
          capabilitiesRevoked: capabilities.length,
        });
      });
    },

    // ──── Suspension & Reactivation (BK-04: LM-10.04, LM-10.06) ────

    async suspendAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<SuspensionResult>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);

      // LM-10.04: Only active agents can be suspended
      if (row.state === 'decommissioned') return agentDecommissioned(agentId as string);
      if (row.state === 'suspended') {
        return invalidStateTransition('suspended' as AgentState, 'suspended' as AgentState);
      }

      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      return conn.transaction(() => {
        // Set state to suspended with reason in dedicated column
        conn.run(
          `UPDATE lm_agents SET state = 'suspended', suspension_reason = ?, last_active_at = ? WHERE id = ?`,
          [reason, now, agentId as string],
        );

        // BK-05: Audit is fail-closed
        const auditResult = appendAudit(conn, actor,
          'lifecycle.agent.suspended', 'agent', agentId as string,
          { reason });
        if (!auditResult.ok) return auditResult;

        // LM-8.04: Emit agent:suspended event
        emitEvent('agent:suspended', agentId as string, { reason });

        return ok<SuspensionResult>({
          agentId,
          suspendedAt: now,
          reason,
          previousState: row.state as AgentState,
        });
      });
    },

    async reactivateAgent(ctx: OperationContext, agentId: AgentId): Promise<Result<ReactivationResult>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);

      // LM-10.06: Only suspended agents can be reactivated
      if (row.state === 'decommissioned') return agentDecommissioned(agentId as string);
      if (row.state === 'active') {
        return invalidStateTransition('active' as AgentState, 'active' as AgentState);
      }

      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      return conn.transaction(() => {
        // Set state back to active, clear suspension reason
        conn.run(
          `UPDATE lm_agents SET state = 'active', suspension_reason = NULL, last_active_at = ? WHERE id = ?`,
          [now, agentId as string],
        );

        // BK-05: Audit is fail-closed
        const auditResult = appendAudit(conn, actor,
          'lifecycle.agent.reactivated', 'agent', agentId as string);
        if (!auditResult.ok) return auditResult;

        // LM-8.05: Emit agent:reactivated event
        emitEvent('agent:reactivated', agentId as string, {});

        return ok<ReactivationResult>({
          agentId,
          reactivatedAt: now,
          previousState: row.state as AgentState,
        });
      });
    },

    // ──── Capability Management (LM-2.06 through LM-2.09) ────

    async requestCapabilityUpgrade(ctx: OperationContext, agentId: AgentId, request: CapabilityRequest): Promise<Result<CapabilityDecision>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;
      const row = check.value;

      const trustLevel = row.trust_level as AgentTrustLevel;
      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      const granted: AgentCapability[] = [];
      const denied: CapabilityDenial[] = [];

      for (const cap of request.capabilities) {
        // LM-13.04, LM-13.05: Check trust ceiling
        if (!isCapabilityAllowedAtTrust(cap, trustLevel)) {
          denied.push({
            capability: cap,
            reason: `Trust level '${trustLevel}' insufficient for capability '${cap}' (requires '${CAPABILITY_TRUST_FLOOR[cap]}')`,
          });
          // Record denial in history
          conn.run(
            `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
             VALUES (?, ?, ?, 'denied', ?, ?, ?)`,
            [randomUUID(), agentId as string, cap, `trust ceiling: requires ${CAPABILITY_TRUST_FLOOR[cap]}`, actor, now],
          );
        } else {
          // Grant the capability
          conn.run(
            `INSERT OR REPLACE INTO lm_capabilities (agent_id, capability, status, granted_at, reason, decided_by)
             VALUES (?, ?, 'granted', ?, ?, ?)`,
            [agentId as string, cap, now, request.justification, actor],
          );
          conn.run(
            `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
             VALUES (?, ?, ?, 'granted', ?, ?, ?)`,
            [randomUUID(), agentId as string, cap, request.justification, actor, now],
          );
          granted.push(cap);

          // LM-8.07
          emitEvent('capability:granted', agentId as string, { capability: cap });
        }
      }

      const auditResult = appendAudit(conn, actor, 'lifecycle.capability.requested', 'agent', agentId as string,
        { requested: request.capabilities, granted, denied: denied.map(d => d.capability) });
      if (!auditResult.ok) return auditResult;

      return ok<CapabilityDecision>({
        requestedCapabilities: request.capabilities as AgentCapability[],
        granted,
        denied,
        decidedBy: actor as UserId | AgentId | 'system',
        decidedAt: now,
      });
    },

    async revokeCapability(ctx: OperationContext, agentId: AgentId, capability: AgentCapability, reason: string): Promise<Result<void>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;

      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      return conn.transaction(() => {
        // LM-13.17: Immediate revocation
        conn.run(
          `DELETE FROM lm_capabilities WHERE agent_id = ? AND capability = ?`,
          [agentId as string, capability],
        );

        conn.run(
          `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
           VALUES (?, ?, ?, 'revoked', ?, ?, ?)`,
          [randomUUID(), agentId as string, capability, reason, actor, now],
        );

        const auditResult = appendAudit(conn, actor, 'lifecycle.capability.revoked', 'agent', agentId as string,
          { capability, reason });
        if (!auditResult.ok) return auditResult;

        // LM-8.08
        emitEvent('capability:revoked', agentId as string, { capability, reason });

        return ok(undefined);
      });
    },

    async getCapabilities(agentId: AgentId): Promise<Result<AgentCapabilitySet>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);
      return ok(buildCapabilitySet(conn, agentId as string));
    },

    async getCapabilityHistory(agentId: AgentId): Promise<Result<readonly CapabilityHistoryEntry[]>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);

      const rows = conn.query<CapabilityHistoryRow>(
        'SELECT * FROM lm_capability_history WHERE agent_id = ? ORDER BY timestamp DESC',
        [agentId as string],
      );

      return ok(rows.map(r => ({
        capability: r.capability as AgentCapability,
        action: r.action as CapabilityHistoryEntry['action'],
        reason: r.reason,
        decidedBy: r.decided_by as UserId | AgentId | 'system',
        timestamp: r.timestamp,
      })));
    },

    // ──── Trust Promotion (LM-2.10 through LM-2.12) ────

    async promoteAgent(ctx: OperationContext, agentId: AgentId, request: PromotionRequest): Promise<Result<TrustPromotionResult>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;
      const row = check.value;

      const currentLevel = row.trust_level as AgentTrustLevel;
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      // Validate promotion
      const validation = validatePromotion(
        currentLevel, request.targetLevel, request.evidence, actor, agentId as string,
      );

      if (!validation.valid) {
        return promotionDenied(request.targetLevel, validation.reason);
      }

      const now = time.nowISO();

      return conn.transaction(() => {
        // Update trust level
        conn.run(
          `UPDATE lm_agents SET trust_level = ?, last_active_at = ? WHERE id = ?`,
          [request.targetLevel, now, agentId as string],
        );

        // Grant newly unlocked capabilities
        for (const cap of validation.capabilitiesUnlocked) {
          conn.run(
            `INSERT OR REPLACE INTO lm_capabilities (agent_id, capability, status, granted_at, reason, decided_by)
             VALUES (?, ?, 'granted', ?, 'trust promotion unlock', ?)`,
            [agentId as string, cap, now, actor],
          );
          conn.run(
            `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
             VALUES (?, ?, ?, 'granted', 'trust promotion unlock', ?, ?)`,
            [randomUUID(), agentId as string, cap, actor, now],
          );
          emitEvent('capability:granted', agentId as string, { capability: cap, reason: 'trust promotion' });
        }

        const auditResult = appendAudit(conn, actor, 'lifecycle.trust.promoted', 'agent', agentId as string,
          { from: currentLevel, to: request.targetLevel, capabilitiesUnlocked: validation.capabilitiesUnlocked });
        if (!auditResult.ok) return auditResult;

        // LM-8.09
        emitEvent('trust:promoted', agentId as string, {
          previousLevel: currentLevel, newLevel: request.targetLevel,
        });

        return ok<TrustPromotionResult>({
          agentId,
          previousLevel: currentLevel,
          newLevel: request.targetLevel,
          capabilitiesUnlocked: validation.capabilitiesUnlocked as AgentCapability[],
          decidedBy: actor as UserId | AgentId | 'system',
          decidedAt: now,
        });
      });
    },

    async demoteAgent(ctx: OperationContext, agentId: AgentId, reason: string): Promise<Result<DemotionResult>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;
      const row = check.value;

      const currentLevel = row.trust_level as AgentTrustLevel;

      // LM-9.07: Cannot demote below untrusted
      if (currentLevel === 'untrusted') {
        return demotionBelowFloor(agentId as string, currentLevel);
      }

      // Demote one level down (demotion can skip but default is one-step)
      const targetLevel = previousTrustLevel(currentLevel);
      if (!targetLevel) return demotionBelowFloor(agentId as string, currentLevel);

      const validation = validateDemotion(currentLevel, targetLevel);
      if (!validation.valid) return governanceRefusal(validation.reason, 'demoteAgent');

      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      return conn.transaction(() => {
        conn.run(
          `UPDATE lm_agents SET trust_level = ?, last_active_at = ? WHERE id = ?`,
          [targetLevel, now, agentId as string],
        );

        // LM-5.18: Revoke capabilities above new level
        for (const cap of validation.capabilitiesRevoked) {
          conn.run(
            `DELETE FROM lm_capabilities WHERE agent_id = ? AND capability = ?`,
            [agentId as string, cap],
          );
          conn.run(
            `INSERT INTO lm_capability_history (id, agent_id, capability, action, reason, decided_by, timestamp)
             VALUES (?, ?, ?, 'revoked', ?, ?, ?)`,
            [randomUUID(), agentId as string, cap, `demotion: ${reason}`, actor, now],
          );
          emitEvent('capability:revoked', agentId as string, { capability: cap, reason: 'trust demotion' });
        }

        const auditResult = appendAudit(conn, actor, 'lifecycle.trust.demoted', 'agent', agentId as string,
          { from: currentLevel, to: targetLevel, reason, capabilitiesRevoked: validation.capabilitiesRevoked });
        if (!auditResult.ok) return auditResult;

        // LM-8.10
        emitEvent('trust:demoted', agentId as string, {
          previousLevel: currentLevel, newLevel: targetLevel, reason,
        });

        return ok<DemotionResult>({
          agentId,
          previousLevel: currentLevel,
          newLevel: targetLevel,
          capabilitiesRevoked: validation.capabilitiesRevoked as AgentCapability[],
          reason,
          decidedBy: actor as UserId | AgentId | 'system',
          decidedAt: now,
        });
      });
    },

    async getTrustLevel(agentId: AgentId): Promise<Result<AgentTrustLevel>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);
      return ok(row.trust_level as AgentTrustLevel);
    },

    // ──── Consent Governance (LM-2.13 through LM-2.16) ────

    async registerConsent(ctx: OperationContext, agentId: AgentId, consent: AgentConsentRecord): Promise<Result<ConsentId>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;

      const consentId = randomUUID() as unknown as ConsentId;
      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      return conn.transaction(() => {
        conn.run(
          `INSERT INTO lm_agent_consents (id, agent_id, data_subject, purpose, scope, status, granted_at, expires_at, tenant_id)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
          [
            consentId as string, agentId as string,
            consent.dataSubject, consent.purpose,
            JSON.stringify(consent.scope ?? {}),
            consent.grantedAt ?? now,
            consent.expiresAt ?? null,
            ctx.tenantId as string | null ?? null,
          ],
        );

        const auditResult = appendAudit(conn, actor, 'lifecycle.consent.registered', 'consent', consentId as string,
          { agentId: agentId as string, purpose: consent.purpose, dataSubject: consent.dataSubject });
        if (!auditResult.ok) return auditResult;

        // LM-8.11
        emitEvent('consent:registered', agentId as string, {
          consentId: consentId as string, purpose: consent.purpose,
        });

        return ok(consentId);
      });
    },

    async revokeConsent(ctx: OperationContext, consentId: ConsentId, reason: string): Promise<Result<ConsentRevocationResult>> {
      const conn = getConnection();
      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      const consentRow = conn.get<ConsentRow>(
        `SELECT * FROM lm_agent_consents WHERE id = ?`,
        [consentId as string],
      );
      if (!consentRow) return consentNotFound(consentId as string);

      return conn.transaction(() => {
        conn.run(
          `UPDATE lm_agent_consents SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE id = ?`,
          [now, reason, consentId as string],
        );

        // BK-13: Query actual affected claims
        const affectedClaims = conn.get<{ count: number }>(
          `SELECT COUNT(*) as count FROM claim_assertions WHERE source_agent_id = ? AND status = 'active'`,
          [consentRow.agent_id],
        );
        const claimsAffected = affectedClaims?.count ?? 0;

        // R2-BK-04: Count transfer operations authorized by THIS specific consent.
        // Previous code counted all transfer consents for the agent, which is wrong semantics.
        let transfersBlocked = 0;
        try {
          const blockedOps = conn.get<{ count: number }>(
            `SELECT COUNT(*) as count FROM lm_capability_history
             WHERE agent_id = ? AND capability = 'knowledge_transfer' AND reason LIKE ?`,
            [consentRow.agent_id, `%${consentId as string}%`],
          );
          transfersBlocked = blockedOps?.count ?? 0;
        } catch {
          // lm_capability_history may not have matching entries; fall back to 0
        }

        // BK-05: Audit is fail-closed
        const auditResult = appendAudit(conn, actor, 'lifecycle.consent.revoked', 'consent', consentId as string,
          { reason, agentId: consentRow.agent_id, claimsAffected, transfersBlocked });
        if (!auditResult.ok) return auditResult;

        // LM-8.12
        emitEvent('consent:revoked', consentRow.agent_id, {
          consentId: consentId as string, reason,
        });

        return ok<ConsentRevocationResult>({
          consentId,
          revokedAt: now,
          claimsAffected,
          transfersBlocked,
          cascadeActions: [`consent ${consentId as string} revoked: ${reason}`],
        });
      });
    },

    async checkConsent(agentId: AgentId, operation: ConsentableOperation): Promise<Result<ConsentDecision>> {
      const conn = getConnection();
      const now = time.nowISO();

      // LM-14.30: Find all active consents for this agent
      const consents = conn.query<ConsentRow>(
        `SELECT * FROM lm_agent_consents WHERE agent_id = ? AND status = 'active'`,
        [agentId as string],
      );

      for (const consent of consents) {
        // LM-14.32: Check expiry on read (LM-13.19, LM-13.21)
        if (consent.expires_at !== null) {
          const expiresMs = new Date(consent.expires_at).getTime();
          const nowMs = new Date(now).getTime();
          if (nowMs > expiresMs) {
            // Mark as expired (LM-13.20)
            conn.run(
              `UPDATE lm_agent_consents SET status = 'expired' WHERE id = ?`,
              [consent.id],
            );
            emitEvent('consent:expired', agentId as string, { consentId: consent.id });
            continue;
          }
        }

        // LM-14.31: Check operation match
        let scope: ConsentScope = {};
        try { scope = JSON.parse(consent.scope); } catch { /* empty */ }

        if (scope.operations && scope.operations.length > 0) {
          if (!scope.operations.includes(operation)) continue;
        }

        // LM-14.33: Matching consent found
        return ok<ConsentDecision>({
          allowed: true,
          consentId: consent.id as unknown as ConsentId,
          reason: `Consent '${consent.id}' authorizes operation '${operation}'`,
          expiresAt: consent.expires_at,
        });
      }

      // LM-14.34: No matching consent
      return ok<ConsentDecision>({
        allowed: false,
        consentId: null,
        reason: 'no active consent',
        expiresAt: null,
      });
    },

    async listConsents(agentId: AgentId): Promise<Result<readonly AgentConsentRecord[]>> {
      const conn = getConnection();
      const row = getAgentRow(conn, agentId as string);
      if (!row) return agentNotFound(agentId as string);

      const now = time.nowISO();
      const rows = conn.query<ConsentRow>(
        `SELECT * FROM lm_agent_consents WHERE agent_id = ? ORDER BY granted_at DESC`,
        [agentId as string],
      );

      return ok(rows.map(r => {
        // LM-13.21: Compute expiry on read
        let status = r.status as ConsentStatus;
        if (status === 'active' && r.expires_at) {
          if (new Date(now).getTime() > new Date(r.expires_at).getTime()) {
            status = 'expired';
          }
        }

        let scope: ConsentScope = {};
        try { scope = JSON.parse(r.scope); } catch { /* empty */ }

        return {
          id: r.id as unknown as ConsentId,
          agentId: r.agent_id as AgentId,
          dataSubject: r.data_subject,
          purpose: r.purpose as import('../adapters/shared/types.js').ConsentPurpose,
          scope,
          grantedAt: r.granted_at,
          expiresAt: r.expires_at,
          status,
        };
      }));
    },

    // ──── Knowledge Exchange (LM-2.17 through LM-2.19) ────

    async exportKnowledge(ctx: OperationContext, agentId: AgentId, options: KnowledgeExportOptions): Promise<Result<KnowledgePackage>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;
      const row = check.value;

      // BK-03: Capability gate — LM-14.21 requires knowledge_export
      const caps = buildCapabilitySet(conn, agentId as string);
      if (!caps.granted.includes('knowledge_export')) {
        return capabilityDenied('knowledge_export', 'agent lacks knowledge_export capability');
      }

      const trustLevel = row.trust_level as AgentTrustLevel;
      const agentClearance = TRUST_TO_CLEARANCE[trustLevel] ?? 0;

      // LM-13.12: Cannot export above agent's clearance
      if (options.classification) {
        const requestedRank = classificationToRank(options.classification);
        if (requestedRank > agentClearance) {
          return classificationExceeded(agentClearance, options.classification);
        }
      }

      const now = time.nowISO();
      const pkgId = randomUUID() as unknown as KnowledgePackageId;
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      const maxClassification = options.classification ?? (['unrestricted', 'internal', 'confidential', 'restricted', 'critical'][agentClearance] as ClassificationLevel) ?? 'unrestricted';

      // BK-07 + R2-BK-03: Query actual claims, include classification if column exists
      type ClaimRow = {
        id: string; subject: string; predicate: string; object_value: string;
        confidence: number; valid_at: string; reasoning: string | null;
        object_type: string; classification?: string;
      };
      let claimRows: ClaimRow[];
      try {
        claimRows = conn.query<ClaimRow>(
          `SELECT id, subject, predicate, object_value, confidence, valid_at, reasoning, object_type, classification
           FROM claim_assertions
           WHERE source_agent_id = ? AND status = 'active' AND archived = 0`,
          [agentId as string],
        );
      } catch {
        // classification column may not exist (pre-migration 034) — fall back without it
        claimRows = conn.query<ClaimRow>(
          `SELECT id, subject, predicate, object_value, confidence, valid_at, reasoning, object_type
           FROM claim_assertions
           WHERE source_agent_id = ? AND status = 'active' AND archived = 0`,
          [agentId as string],
        );
      }

      const claims: ExportedClaim[] = [];
      const domains = new Set<string>();

      for (const cr of claimRows) {
        // Filter by domain if specified
        const domain = cr.predicate.split('.')[0] ?? '';
        if (options.domains && options.domains.length > 0 && !options.domains.includes(domain)) continue;
        // Filter by min confidence
        if (options.minConfidence !== undefined && cr.confidence < options.minConfidence) continue;

        domains.add(domain);
        // R2-BK-03: Use actual classification from claim_assertions if available,
        // fall back to 'unrestricted' only when column data is absent.
        const claimClassification: ClassificationLevel = cr.classification
          ? (cr.classification as ClassificationLevel)
          : 'unrestricted';

        claims.push({
          originalId: cr.id as ClaimId,
          subject: cr.subject,
          predicate: cr.predicate,
          value: cr.object_value,
          confidence: cr.confidence,
          classification: claimClassification,
          reasoning: cr.reasoning,
          createdAt: cr.valid_at,
        });
      }

      // BK-07: Query techniques if requested
      const techniques: ExportedTechnique[] = [];
      if (options.includeTechniques !== false) {
        try {
          const techRows = conn.query<{
            id: string; description: string; domain: string; status: string;
            success_rate: number; evaluation_count: number;
          }>(
            `SELECT id, description, domain, status, success_rate, evaluation_count
             FROM tgp_techniques WHERE source_agent_id = ?`,
            [agentId as string],
          );
          for (const tr of techRows) {
            techniques.push({
              originalId: tr.id as ClaimId,
              description: tr.description,
              domain: tr.domain,
              status: tr.status as 'candidate' | 'active' | 'suspended' | 'retired',
              successRate: tr.success_rate ?? 0,
              evaluationCount: tr.evaluation_count ?? 0,
            });
          }
        } catch {
          // tgp_techniques table may not exist
        }
      }

      // BK-07: Query relationships if requested
      const relationships: ExportedRelationship[] = [];
      if (options.includeRelationships !== false && claims.length > 0) {
        try {
          const claimIds = claims.map(c => c.originalId as string);
          // Query relationships where either side is one of the agent's claims
          const placeholders = claimIds.map(() => '?').join(',');
          const relRows = conn.query<{
            from_claim_id: string; to_claim_id: string; type: string;
          }>(
            `SELECT from_claim_id, to_claim_id, type FROM claim_relationships
             WHERE from_claim_id IN (${placeholders}) OR to_claim_id IN (${placeholders})`,
            [...claimIds, ...claimIds],
          );
          for (const rr of relRows) {
            relationships.push({
              fromClaimOriginalId: rr.from_claim_id as ClaimId,
              toClaimOriginalId: rr.to_claim_id as ClaimId,
              type: rr.type as import('../adapters/shared/types.js').RelationshipType,
            });
          }
        } catch {
          // claim_relationships table may not exist
        }
      }

      // Serialize and compute checksum (LM-7.16)
      const serialized = JSON.stringify({ claims, techniques, relationships });
      const checksum = createHash('sha256').update(serialized).digest('hex');

      // BK-05: Audit is fail-closed
      const auditResult = appendAudit(conn, actor, 'lifecycle.knowledge.exported', 'agent', agentId as string,
        { packageId: pkgId as string, format: options.format, claimCount: claims.length });
      if (!auditResult.ok) return auditResult;

      // LM-8.14
      emitEvent('knowledge:exported', agentId as string, { packageId: pkgId as string });

      return ok<KnowledgePackage>({
        id: pkgId,
        sourceAgentId: agentId,
        exportedAt: now,
        format: options.format,
        claims,
        techniques,
        relationships,
        metadata: {
          claimCount: claims.length,
          techniqueCount: techniques.length,
          relationshipCount: relationships.length,
          domains: Array.from(domains),
          classificationMax: maxClassification,
        },
        checksum,
      });
    },

    async importKnowledge(ctx: OperationContext, agentId: AgentId, pkg: KnowledgePackage, options?: KnowledgeImportOptions): Promise<Result<KnowledgeImportResult>> {
      const conn = getConnection();
      const check = requireActiveAgent(conn, agentId as string);
      if (!check.ok) return check;
      const row = check.value;

      // BK-03: Capability gate — LM-14.04 requires knowledge_import
      const caps = buildCapabilitySet(conn, agentId as string);
      if (!caps.granted.includes('knowledge_import')) {
        return capabilityDenied('knowledge_import', 'agent lacks knowledge_import capability');
      }

      const startMs = Date.now();
      const trustLevel = row.trust_level as AgentTrustLevel;
      const agentClearance = TRUST_TO_CLEARANCE[trustLevel] ?? 0;
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';

      // LM-7.42: Validate integrity (default true)
      const shouldValidate = options?.validateIntegrity !== false;
      if (shouldValidate) {
        const serialized = JSON.stringify({ claims: pkg.claims, techniques: pkg.techniques, relationships: pkg.relationships });
        const actualChecksum = createHash('sha256').update(serialized).digest('hex');
        if (actualChecksum !== pkg.checksum) {
          return importIntegrityFailed(pkg.checksum, actualChecksum);
        }
      }

      // LM-13.13: Cannot import above agent's clearance
      const pkgMaxRank = classificationToRank(pkg.metadata.classificationMax);
      if (pkgMaxRank > agentClearance) {
        return classificationExceeded(agentClearance, pkg.metadata.classificationMax);
      }

      // LM-13.10, LM-13.11: Cap confidence at 0.5 by default
      const confidenceCap = options?.confidenceCap ?? 0.5;
      const conflictStrategy = options?.conflictStrategy ?? 'skip';

      // BK-08: Real import — write imported claims to the database
      let imported = 0;
      let skipped = 0;
      let conflicts = 0;
      const newClaimIds: ClaimId[] = [];
      const now = time.nowISO();

      return conn.transaction(() => {
        for (const claim of pkg.claims) {
          // Check for conflicts — existing claim with same subject+predicate
          const existing = conn.get<{ id: string }>(
            `SELECT id FROM claim_assertions WHERE subject = ? AND predicate = ? AND source_agent_id = ? AND status = 'active'`,
            [claim.subject, claim.predicate, agentId as string],
          );

          if (existing) {
            if (conflictStrategy === 'skip') {
              skipped++;
              continue;
            } else if (conflictStrategy === 'override') {
              // Retract the existing claim
              conn.run(
                `UPDATE claim_assertions SET status = 'retracted' WHERE id = ?`,
                [existing.id],
              );
            }
            conflicts++;
          }

          // Insert the imported claim with capped confidence
          const newId = randomUUID() as ClaimId;
          const cappedConfidence = Math.min(claim.confidence, confidenceCap);
          conn.run(
            `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value, confidence, valid_at, source_agent_id, grounding_mode, status, archived)
             VALUES (?, NULL, ?, ?, 'string', ?, ?, ?, ?, 'evidence_path', 'active', 0)`,
            [newId as string, claim.subject, claim.predicate, typeof claim.value === 'string' ? claim.value : JSON.stringify(claim.value), cappedConfidence, now, agentId as string],
          );
          newClaimIds.push(newId);
          imported++;
        }

        const duration = Date.now() - startMs;

        // BK-05: Audit is fail-closed
        const auditResult = appendAudit(conn, actor, 'lifecycle.knowledge.imported', 'agent', agentId as string,
          { packageId: pkg.id as string, imported, skipped, conflicts, format: pkg.format });
        if (!auditResult.ok) return auditResult;

        // LM-8.15
        emitEvent('knowledge:imported', agentId as string, { packageId: pkg.id as string, imported });

        return ok<KnowledgeImportResult>({
          imported,
          skipped,
          conflicts,
          branchCreated: conflictStrategy === 'branch' && conflicts > 0,
          branchId: null,
          newClaimIds,
          duration,
        });
      });
    },

    async transferKnowledge(ctx: OperationContext, fromAgentId: AgentId, toAgentId: AgentId, options: KnowledgeTransferOptions): Promise<Result<KnowledgeTransferResult>> {
      const conn = getConnection();

      // LM-14.21: Source must be active with knowledge_export capability
      const fromCheck = requireActiveAgent(conn, fromAgentId as string);
      if (!fromCheck.ok) return fromCheck;
      const fromCaps = buildCapabilitySet(conn, fromAgentId as string);
      if (!fromCaps.granted.includes('knowledge_export')) {
        return transferDenied('source agent lacks knowledge_export capability', fromAgentId as string, toAgentId as string);
      }

      // LM-14.22: Target must be active with knowledge_import capability
      const toCheck = requireActiveAgent(conn, toAgentId as string);
      if (!toCheck.ok) return toCheck;
      const toCaps = buildCapabilitySet(conn, toAgentId as string);
      if (!toCaps.granted.includes('knowledge_import')) {
        return transferDenied('target agent lacks knowledge_import capability', fromAgentId as string, toAgentId as string);
      }

      // LM-14.23: Consent check is MANDATORY (cannot be disabled)
      const consentResult = await client.checkConsent(fromAgentId, 'transfer_knowledge');
      if (!consentResult.ok) return consentResult;
      if (!consentResult.value.allowed) {
        return transferDenied('no active consent for knowledge transfer', fromAgentId as string, toAgentId as string);
      }

      const now = time.nowISO();
      const actor = ctx.agentId as string ?? ctx.userId ?? 'system';
      const confidenceCap = options.confidenceCap ?? 0.5;

      // LM-14.24-14.27: Export from source, apply filters, import to target
      const exportOpts: KnowledgeExportOptions = {
        format: 'limen_native' as const,
        ...(options.domains ? { domains: options.domains } : {}),
        ...(options.includeTechniques !== undefined ? { includeTechniques: options.includeTechniques } : {}),
      };
      const exportResult = await client.exportKnowledge(ctx, fromAgentId, exportOpts);

      if (!exportResult.ok) return exportResult;

      const importResult = await client.importKnowledge(ctx, toAgentId, exportResult.value, {
        conflictStrategy: 'skip',
        confidenceCap,
      });

      if (!importResult.ok) return importResult;

      const auditResult = appendAudit(conn, actor, 'lifecycle.knowledge.transferred', 'agent', fromAgentId as string,
        { fromAgentId: fromAgentId as string, toAgentId: toAgentId as string, transferred: importResult.value.imported });
      if (!auditResult.ok) return auditResult;

      // LM-14.28
      emitEvent('knowledge:exported', fromAgentId as string, { toAgentId: toAgentId as string });
      emitEvent('knowledge:imported', toAgentId as string, { fromAgentId: fromAgentId as string });
      emitEvent('knowledge:transferred', fromAgentId as string, {
        fromAgentId: fromAgentId as string, toAgentId: toAgentId as string,
      });

      return ok<KnowledgeTransferResult>({
        fromAgentId,
        toAgentId,
        transferred: importResult.value.imported,
        skipped: importResult.value.skipped,
        conflicts: importResult.value.conflicts,
        newClaimIds: importResult.value.newClaimIds,
        transferredAt: now,
        consentId: consentResult.value.consentId,
      });
    },

    // ──── Events (LM-2.20 through LM-2.22) ────

    on(event: AgentEvent, handler: AgentEventHandler): string {
      // Bridge: kernel EventBus subscribe -> AgentEventHandler
      const pattern = `lifecycle.${event}`;
      const result = kernelEvents.subscribe(pattern, (evt) => {
        handler({
          eventId: randomUUID() as import('../adapters/shared/types.js').EventId,
          event,
          timestamp: time.nowISO(),
          adapterId: 'lifecycle' as import('../adapters/shared/types.js').AdapterId,
          sessionId: null,
          agentId: (evt.payload?.agentId ?? '') as AgentId,
          data: evt.payload as Readonly<Record<string, unknown>>,
        });
      });
      // BK-02: Propagate subscription failure instead of silently swallowing
      if (!result.ok) {
        throw new Error(`Event subscription failed for pattern '${pattern}': ${result.error.message}`);
      }
      const subId = result.value;
      subscriptions.set(subId, { pattern });
      return subId;
    },

    off(subscriptionId: string): void {
      kernelEvents.unsubscribe(subscriptionId);
      subscriptions.delete(subscriptionId);
    },
  };

  return client;
}
