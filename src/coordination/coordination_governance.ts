// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §3
/**
 * AgentCoordinationClient Implementation — Full Coordination Governance subsystem.
 *
 * Implements: CO-3.1 through CO-3.20, CO-1.3 through CO-1.5,
 *             CO-A.1 through CO-A.5, CO-B.1 through CO-B.7,
 *             CO-12.1 through CO-12.12
 *
 * All methods return Promise<Result<T>> (AD-11). Never throws.
 * All operations are tenant-scoped (CO-1.3).
 * All operations are governance-checked (CO-1.4).
 * All operations produce audit entries (CO-1.5, CO-12.9).
 * Fail-closed governance (AD-4).
 *
 * Architecture:
 * - Single composition root via createAgentCoordinationClient factory
 * - Dependencies injected (AD-10)
 * - All IDs are branded types (AD-2)
 * - Delegates to A2ARuleEngine for rule evaluation
 * - Delegates to SessionForkManager for fork lifecycle
 * - Delegates to SyncEngine for distributed sync
 * - Delegates to ReplayVerifier for deterministic replay
 */

import { randomUUID } from 'node:crypto';
import type {
  Result, OperationContext,
  AgentId, TenantId, SessionId, MissionId,
} from '../kernel/interfaces/index.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type {
  AgentEventHandler,
  MergeStrategy,
  AgentTrustLevel,
  GovernanceDecision,
} from '../adapters/shared/types.js';
import type { Permission, EventId } from '../kernel/interfaces/index.js';
import type {
  A2AGovernanceRule, A2AGovernanceRuleInput, A2ARuleFilter,
  A2AAction, A2AVerdict, CapabilityBoundary,
  ForkedSession, ForkOptions, ForkMergeResult,
  SyncState, PeerRegistration, SyncOptions, SyncResult, SyncEvent, SyncLogOptions,
  StateSnapshot, SnapshotTrigger, ReplayVerifyOptions, ReplayVerification,
  DivergenceReport, CoordinationEvent,
} from './coordination_types.js';
import { DEFAULT_RULE_PRIORITY } from './coordination_types.js';
import type { AgentCoordinationError } from './coordination_errors.js';
import {
  a2aRuleNotFound, coordinationTenantMismatch, coordinationGovernanceRefusal,
} from './coordination_errors.js';
import { evaluateA2ARules, computeCapabilityBoundary } from './a2a_rule_engine.js';
import {
  forkSession as doForkSession, listForks as doListForks,
  mergeFork as doMergeFork, discardFork as doDiscardFork,
} from './session_fork.js';
import {
  getSyncState as doGetSyncState, registerPeer as doRegisterPeer,
  removePeer as doRemovePeer, triggerSync as doTriggerSync,
  getSyncLog as doGetSyncLog,
} from './sync_engine.js';
import {
  captureSnapshot as doCaptureSnapshot, verifyReplay as doVerifyReplay,
  getSnapshots as doGetSnapshots, detectDivergence as doDetectDivergence,
} from './replay_verifier.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: AgentCoordinationError): Result<T> {
  return { ok: false, error };
}

// ============================================================================
// AgentCoordinationClient Interface (CO-3.1 through CO-3.20)
// ============================================================================

/**
 * CO-3: Full coordination governance client interface.
 * 20 interface methods across 4 domains: A2A, Fork, Sync, Replay.
 */
export interface AgentCoordinationClient {
  // --- A2A Governance ---
  registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput): Promise<Result<string>>;
  removeA2ARule(ctx: OperationContext, ruleId: string): Promise<Result<void>>;
  listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter): Promise<Result<A2AGovernanceRule[]>>;
  validateA2AAction(ctx: OperationContext, action: A2AAction, targetAgent: AgentId): Promise<Result<A2AVerdict>>;
  getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string): Promise<Result<CapabilityBoundary>>;

  // --- Session Forking ---
  forkSession(ctx: OperationContext, atTurn: number, options?: ForkOptions): Promise<Result<ForkedSession>>;
  listForks(ctx: OperationContext, sessionId: SessionId): Promise<Result<ForkedSession[]>>;
  mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy): Promise<Result<ForkMergeResult>>;
  discardFork(ctx: OperationContext, forkId: string): Promise<Result<void>>;

  // --- Distributed Sync ---
  getSyncState(ctx: OperationContext): Promise<Result<SyncState>>;
  registerPeer(ctx: OperationContext, peer: PeerRegistration): Promise<Result<string>>;
  removePeer(ctx: OperationContext, peerId: string): Promise<Result<void>>;
  triggerSync(ctx: OperationContext, options?: SyncOptions): Promise<Result<SyncResult>>;
  getSyncLog(ctx: OperationContext, options?: SyncLogOptions): Promise<Result<SyncEvent[]>>;

  // --- Deterministic Replay ---
  captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger): Promise<Result<StateSnapshot>>;
  verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions): Promise<Result<ReplayVerification>>;
  getSnapshots(ctx: OperationContext, missionId: MissionId): Promise<Result<StateSnapshot[]>>;
  detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string): Promise<Result<DivergenceReport>>;

  // --- Events ---
  on(ctx: OperationContext, event: CoordinationEvent, handler: AgentEventHandler): string;
  off(ctx: OperationContext, subscriptionId: string): void;
}

// ============================================================================
// Factory Dependencies
// ============================================================================

export interface CoordinationGovernanceDeps {
  readonly getConnection: () => DatabaseConnection;
  readonly getContext: () => OperationContext;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
  readonly nodeId?: string;
  /**
   * FINDING-027: Tenancy mode determines whether null tenantId is acceptable.
   * In single-tenant mode, tenantId is always null — this is valid.
   * In multi-tenant mode, null tenantId is rejected (CO-12.1).
   * Defaults to 'single' for backward compatibility.
   */
  readonly tenancyMode?: 'single' | 'multi';
}

// ============================================================================
// Factory Function (AD-7, AD-10)
// ============================================================================

/**
 * Create an AgentCoordinationClient instance.
 * Single composition root. Dependencies injected. Returned object is frozen.
 */
export function createAgentCoordinationClient(
  deps: CoordinationGovernanceDeps,
): AgentCoordinationClient {
  const { getConnection, audit, time } = deps;
  const nodeId = deps.nodeId ?? randomUUID();
  const tenancyMode = deps.tenancyMode ?? 'single';

  // Event subscriptions — stored in closure (survives Object.freeze)
  const subscriptions = new Map<string, { event: CoordinationEvent; handler: AgentEventHandler }>();

  // ── Helpers ──

  function getSyncDeps() {
    return { conn: getConnection(), audit, time, nodeId };
  }

  function getForkDeps() {
    return { conn: getConnection(), audit, time };
  }

  function getReplayDeps() {
    return { conn: getConnection(), audit, time };
  }

  /**
   * FINDING-027: In single-tenant mode, tenantId is null. The coordination tables
   * have `tenant_id NOT NULL`, so we use a sentinel value '__DEFAULT__' to represent
   * the single-tenant scope. This sentinel is applied transparently — callers
   * continue to pass ctx.tenantId=null and the coordination layer handles it.
   */
  const SINGLE_TENANT_SENTINEL = '__DEFAULT__';

  /**
   * Resolve the effective tenantId for DB operations.
   * In single-tenant mode: null -> '__DEFAULT__'.
   * In multi-tenant mode: pass through as-is.
   */
  function effectiveTenantId(ctx: OperationContext): TenantId | null {
    if (tenancyMode === 'single' && (ctx.tenantId === null || ctx.tenantId === undefined)) {
      return SINGLE_TENANT_SENTINEL as unknown as TenantId;
    }
    return ctx.tenantId;
  }

  /**
   * Create a context with the effective tenant ID for delegated functions.
   * In single-tenant mode, replaces null tenantId with the sentinel value.
   */
  function withEffectiveTenant(ctx: OperationContext): OperationContext {
    const eTid = effectiveTenantId(ctx);
    if (eTid === ctx.tenantId) return ctx;
    return { ...ctx, tenantId: eTid as TenantId };
  }

  function ensureTenant(ctx: OperationContext, operation: string): Result<void> | null {
    // FINDING-027: In single-tenant mode, tenantId is always null — this is valid.
    // CO-12.1 tenant-scoping only applies in multi-tenant mode.
    if (tenancyMode === 'single') {
      return null; // Accept null tenantId in single-tenant mode
    }

    // CO-12.1: In multi-tenant mode, all operations require a non-null tenantId
    if (ctx.tenantId === null || ctx.tenantId === undefined) {
      // BRK-CO-005: Audit failed operations before returning error
      try {
        const conn = getConnection();
        audit.append(conn, {
          tenantId: null,
          actorType: 'agent',
          actorId: ctx.agentId ?? 'system',
          operation: `${operation}_denied`,
          resourceType: 'coordination',
          resourceId: 'tenant_mismatch',
        });
      } catch {
        // Best-effort audit — do not mask the tenant error
      }
      return err(coordinationTenantMismatch(null, null));
    }
    return null;
  }

  // BRK-CO-006: Trust level to clearance mapping (same pattern as OG subsystem)
  const TRUST_TO_CLEARANCE: Record<string, number> = {
    untrusted: 0,
    low: 1,
    medium: 2,
    high: 3,
    verified: 4,
  };

  // BRK-CO-006: Governance evaluation — check permissions + trust levels (Appendix A/B)
  function evaluateGovernance(
    ctx: OperationContext,
    requiredPermission: string,
    requiredTrustLevel: string,
  ): Result<void> {
    // Check permissions via the ReadonlySet<Permission> on OperationContext
    if (ctx.permissions) {
      const perm = requiredPermission as Permission;
      if (!ctx.permissions.has(perm)) {
        const decision: GovernanceDecision = {
          allowed: false,
          verdict: { verdict: 'refuse' as const, auditId: '' as EventId, reason: `Missing required permission: ${requiredPermission}`, rule: 'CO-A.1' },
          reason: `Missing required permission: ${requiredPermission}`,
          requiredPermissions: [perm],
          missingPermissions: [perm],
          clearanceRequired: null,
          clearanceActual: null,
          evaluatedAt: time.nowISO(),
        };
        return err(coordinationGovernanceRefusal(decision));
      }
    }

    // Evaluate trust level via clearanceLevel on OperationContext
    const requiredClearance = TRUST_TO_CLEARANCE[requiredTrustLevel] ?? 0;
    if (ctx.clearanceLevel !== undefined && ctx.clearanceLevel < requiredClearance) {
      const decision: GovernanceDecision = {
        allowed: false,
        verdict: { verdict: 'refuse' as const, auditId: '' as EventId, reason: `Insufficient trust level: required ${requiredTrustLevel} (clearance ${requiredClearance}), actual clearance ${ctx.clearanceLevel}`, rule: 'CO-A.2' },
        reason: `Insufficient trust level: required ${requiredTrustLevel}`,
        requiredPermissions: [],
        missingPermissions: [],
        clearanceRequired: requiredClearance,
        clearanceActual: ctx.clearanceLevel,
        evaluatedAt: time.nowISO(),
      };
      return err(coordinationGovernanceRefusal(decision));
    }

    return ok(undefined);
  }

  // BRK-CO-009: Emit coordination events to subscribers
  function emitCoordinationEvent(event: CoordinationEvent, data: Record<string, unknown>): void {
    for (const [, sub] of subscriptions) {
      if (sub.event === event) {
        try {
          const ctx = deps.getContext();
          sub.handler({
            eventId: randomUUID() as import('../kernel/interfaces/index.js').EventId,
            event,
            timestamp: time.nowISO(),
            adapterId: '' as import('../adapters/shared/types.js').AdapterId,
            sessionId: (ctx as { sessionId?: import('../kernel/interfaces/index.js').SessionId }).sessionId ?? null,
            agentId: (ctx.agentId ?? 'system') as import('../kernel/interfaces/index.js').AgentId,
            data: Object.freeze(data),
          });
        } catch {
          // Best-effort event delivery — do not propagate subscriber errors
        }
      }
    }
  }

  // ── Build client ──

  const client: AgentCoordinationClient = {
    // ── A2A Governance (CO-3.1 through CO-3.5) ──

    async registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput): Promise<Result<string>> {
      const tenantCheck = ensureTenant(ctx, 'register_a2a_rule');
      if (tenantCheck) return tenantCheck as Result<string>;
      const govCheck = evaluateGovernance(ctx, 'manage_agents', 'medium');
      if (!govCheck.ok) return govCheck as Result<string>;

      const conn = getConnection();
      const ruleId = randomUUID();
      const now = time.nowISO();
      const priority = rule.priority ?? DEFAULT_RULE_PRIORITY;

      conn.transaction(() => {
        conn.run(
          `INSERT INTO coordination_a2a_rules
           (id, tenant_id, source_agent, target_agent, skill, action, conditions, priority, enabled, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [ruleId, effectiveTenantId(ctx), rule.sourceAgent, rule.targetAgent, rule.skill,
           rule.action, JSON.stringify(rule.conditions ?? []), priority, now,
           ctx.agentId ?? 'system'],
        );

        audit.append(conn, {
          tenantId: effectiveTenantId(ctx),
          actorType: 'agent',
          actorId: ctx.agentId ?? 'system',
          operation: 'register_a2a_rule',
          resourceType: 'a2a_rule',
          resourceId: ruleId,
        });
      });

      // BRK-CO-009: Emit event
      emitCoordinationEvent('a2a:rule_registered', { ruleId, sourceAgent: rule.sourceAgent, targetAgent: rule.targetAgent });

      return ok(ruleId);
    },

    async removeA2ARule(ctx: OperationContext, ruleId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx, 'remove_a2a_rule');
      if (tenantCheck) return tenantCheck as Result<void>;
      const govCheck = evaluateGovernance(ctx, 'manage_agents', 'medium');
      if (!govCheck.ok) return govCheck as Result<void>;

      const conn = getConnection();
      const existing = conn.get<{ id: string }>(
        `SELECT id FROM coordination_a2a_rules WHERE id = ? AND tenant_id = ?`,
        [ruleId, effectiveTenantId(ctx)],
      );
      if (!existing) return err(a2aRuleNotFound(ruleId));

      conn.transaction(() => {
        // CO-11.2: Soft-delete — set enabled=false, retain for audit
        // BRK-CO-014: Add tenant_id to WHERE clause for tenant isolation
        conn.run(
          `UPDATE coordination_a2a_rules SET enabled = 0 WHERE id = ? AND tenant_id = ?`,
          [ruleId, effectiveTenantId(ctx)],
        );

        audit.append(conn, {
          tenantId: effectiveTenantId(ctx),
          actorType: 'agent',
          actorId: ctx.agentId ?? 'system',
          operation: 'remove_a2a_rule',
          resourceType: 'a2a_rule',
          resourceId: ruleId,
        });
      });

      // BRK-CO-009: Emit event
      emitCoordinationEvent('a2a:rule_removed', { ruleId });

      return ok(undefined);
    },

    async listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter): Promise<Result<A2AGovernanceRule[]>> {
      const tenantCheck = ensureTenant(ctx, 'list_a2a_rules');
      if (tenantCheck) return tenantCheck as Result<A2AGovernanceRule[]>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<A2AGovernanceRule[]>;

      const conn = getConnection();
      let sql = `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ?`;
      const params: unknown[] = [effectiveTenantId(ctx)];

      if (filter?.sourceAgent) { sql += ' AND source_agent = ?'; params.push(filter.sourceAgent); }
      if (filter?.targetAgent) { sql += ' AND target_agent = ?'; params.push(filter.targetAgent); }
      if (filter?.skill) { sql += ' AND skill = ?'; params.push(filter.skill); }
      if (filter?.action) { sql += ' AND action = ?'; params.push(filter.action); }
      if (filter?.enabled !== undefined) { sql += ' AND enabled = ?'; params.push(filter.enabled ? 1 : 0); }

      sql += ' ORDER BY priority ASC, created_at ASC';

      const rows = conn.query<{
        id: string; tenant_id: string; source_agent: string; target_agent: string;
        skill: string; action: string; conditions: string; priority: number;
        enabled: number; created_at: string; created_by: string;
      }>(sql, params);

      const rules: A2AGovernanceRule[] = rows.map(r => Object.freeze({
        id: r.id,
        tenantId: r.tenant_id as TenantId,
        sourceAgent: r.source_agent as AgentId | '*',
        targetAgent: r.target_agent as AgentId | '*',
        skill: r.skill as string | '*',
        action: r.action as A2AGovernanceRule['action'],
        conditions: Object.freeze(JSON.parse(r.conditions)),
        priority: r.priority,
        enabled: r.enabled === 1,
        createdAt: r.created_at,
        createdBy: r.created_by as AgentId,
      }));

      return ok(rules);
    },

    async validateA2AAction(ctx: OperationContext, action: A2AAction, targetAgent: AgentId): Promise<Result<A2AVerdict>> {
      const tenantCheck = ensureTenant(ctx, 'validate_a2a_action');
      if (tenantCheck) return tenantCheck as Result<A2AVerdict>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<A2AVerdict>;

      // CO-12.8: Evaluate boundaries on every call — no caching
      const conn = getConnection();
      const rows = conn.query<{
        id: string; tenant_id: string; source_agent: string; target_agent: string;
        skill: string; action: string; conditions: string; priority: number;
        enabled: number; created_at: string; created_by: string;
      }>(
        `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ? AND enabled = 1 ORDER BY priority ASC, created_at ASC`,
        [effectiveTenantId(ctx)],
      );

      const rules: A2AGovernanceRule[] = rows.map(r => ({
        id: r.id,
        tenantId: r.tenant_id as TenantId,
        sourceAgent: r.source_agent as AgentId | '*',
        targetAgent: r.target_agent as AgentId | '*',
        skill: r.skill as string | '*',
        action: r.action as A2AGovernanceRule['action'],
        conditions: JSON.parse(r.conditions),
        priority: r.priority,
        enabled: true,
        createdAt: r.created_at,
        createdBy: r.created_by as AgentId,
      }));

      const verdict = evaluateA2ARules(rules, action, targetAgent, time);

      // CO-12.9: Audit the validation
      audit.append(conn, {
        tenantId: effectiveTenantId(ctx),
        actorType: 'agent',
        actorId: ctx.agentId ?? 'system',
        operation: 'validate_a2a_action',
        resourceType: 'a2a_action',
        resourceId: verdict.ruleId,
      });

      // BRK-CO-009: Emit event based on verdict
      if (!verdict.allowed) {
        emitCoordinationEvent('a2a:action_denied', { ruleId: verdict.ruleId, reason: verdict.reason });
      } else if (verdict.maskedFields) {
        emitCoordinationEvent('a2a:action_masked', { ruleId: verdict.ruleId, maskedFields: verdict.maskedFields });
      } else if (verdict.rateLimited) {
        emitCoordinationEvent('a2a:rate_limited', { ruleId: verdict.ruleId });
      } else {
        emitCoordinationEvent('a2a:action_validated', { ruleId: verdict.ruleId });
      }

      return ok(verdict);
    },

    async getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string): Promise<Result<CapabilityBoundary>> {
      const tenantCheck = ensureTenant(ctx, 'get_capability_boundary');
      if (tenantCheck) return tenantCheck as Result<CapabilityBoundary>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<CapabilityBoundary>;

      const conn = getConnection();

      // Look up agent trust level
      const agentRow = conn.get<{ trust_level: string }>(
        `SELECT trust_level FROM core_agents WHERE id = ? AND tenant_id = ?`,
        [agentId, effectiveTenantId(ctx)],
      );
      const trustLevel: AgentTrustLevel = (agentRow?.trust_level as AgentTrustLevel) ?? 'untrusted';

      // Get rules for this agent
      const ruleRows = conn.query<{
        id: string; tenant_id: string; source_agent: string; target_agent: string;
        skill: string; action: string; conditions: string; priority: number;
        enabled: number; created_at: string; created_by: string;
      }>(
        `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ? AND enabled = 1`,
        [effectiveTenantId(ctx)],
      );

      const rules: A2AGovernanceRule[] = ruleRows.map(r => ({
        id: r.id,
        tenantId: r.tenant_id as TenantId,
        sourceAgent: r.source_agent as AgentId | '*',
        targetAgent: r.target_agent as AgentId | '*',
        skill: r.skill as string | '*',
        action: r.action as A2AGovernanceRule['action'],
        conditions: JSON.parse(r.conditions),
        priority: r.priority,
        enabled: true,
        createdAt: r.created_at,
        createdBy: r.created_by as AgentId,
      }));

      const boundary = computeCapabilityBoundary(agentId, skill, trustLevel, rules);
      return ok(boundary);
    },

    // ── Session Forking (CO-3.6 through CO-3.9) ──

    async forkSession(ctx: OperationContext, atTurn: number, options?: ForkOptions): Promise<Result<ForkedSession>> {
      const tenantCheck = ensureTenant(ctx, 'fork_session');
      if (tenantCheck) return tenantCheck as Result<ForkedSession>;
      const govCheck = evaluateGovernance(ctx, 'assert_claim', 'low');
      if (!govCheck.ok) return govCheck as Result<ForkedSession>;

      const eCtx = withEffectiveTenant(ctx);
      const sessionId = (ctx as { sessionId?: SessionId }).sessionId ?? (randomUUID() as SessionId);
      const result = doForkSession(getForkDeps(), eCtx, sessionId, atTurn, options);
      // BRK-CO-009: Emit event on successful fork
      if (result.ok) {
        emitCoordinationEvent('fork:created', { forkId: result.value.forkId, sessionId: sessionId as string, atTurn });
      }
      return result;
    },

    async listForks(ctx: OperationContext, sessionId: SessionId): Promise<Result<ForkedSession[]>> {
      const tenantCheck = ensureTenant(ctx, 'list_forks');
      if (tenantCheck) return tenantCheck as Result<ForkedSession[]>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<ForkedSession[]>;

      return doListForks(getForkDeps(), withEffectiveTenant(ctx), sessionId);
    },

    async mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy): Promise<Result<ForkMergeResult>> {
      const tenantCheck = ensureTenant(ctx, 'merge_fork');
      if (tenantCheck) return tenantCheck as Result<ForkMergeResult>;
      const govCheck = evaluateGovernance(ctx, 'assert_claim', 'low');
      if (!govCheck.ok) return govCheck as Result<ForkMergeResult>;

      const result = doMergeFork(getForkDeps(), withEffectiveTenant(ctx), forkId, strategy);
      // BRK-CO-009: Emit event on successful merge (or conflict_detected)
      if (result.ok) {
        if (result.value.unresolvedConflicts.length > 0) {
          emitCoordinationEvent('fork:conflict_detected', { forkId, conflictCount: result.value.unresolvedConflicts.length });
        } else {
          emitCoordinationEvent('fork:merged', { forkId, claimsMerged: result.value.claimsMerged });
        }
      }
      return result;
    },

    async discardFork(ctx: OperationContext, forkId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx, 'discard_fork');
      if (tenantCheck) return tenantCheck as Result<void>;
      const govCheck = evaluateGovernance(ctx, 'assert_claim', 'low');
      if (!govCheck.ok) return govCheck as Result<void>;

      const result = doDiscardFork(getForkDeps(), withEffectiveTenant(ctx), forkId);
      // BRK-CO-009: Emit event on successful discard
      if (result.ok) {
        emitCoordinationEvent('fork:discarded', { forkId });
      }
      return result;
    },

    // ── Distributed Sync (CO-3.10 through CO-3.14) ──

    async getSyncState(ctx: OperationContext): Promise<Result<SyncState>> {
      const tenantCheck = ensureTenant(ctx, 'get_sync_state');
      if (tenantCheck) return tenantCheck as Result<SyncState>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<SyncState>;

      return doGetSyncState(getSyncDeps(), withEffectiveTenant(ctx));
    },

    async registerPeer(ctx: OperationContext, peer: PeerRegistration): Promise<Result<string>> {
      const tenantCheck = ensureTenant(ctx, 'register_peer');
      if (tenantCheck) return tenantCheck as Result<string>;
      const govCheck = evaluateGovernance(ctx, 'manage_agents', 'medium');
      if (!govCheck.ok) return govCheck as Result<string>;

      const result = doRegisterPeer(getSyncDeps(), withEffectiveTenant(ctx), peer);
      if (result.ok) {
        emitCoordinationEvent('sync:peer_registered', { peerId: result.value, nodeId: peer.nodeId });
      }
      return result;
    },

    async removePeer(ctx: OperationContext, peerId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx, 'remove_peer');
      if (tenantCheck) return tenantCheck as Result<void>;
      const govCheck = evaluateGovernance(ctx, 'manage_agents', 'medium');
      if (!govCheck.ok) return govCheck as Result<void>;

      const result = doRemovePeer(getSyncDeps(), withEffectiveTenant(ctx), peerId);
      if (result.ok) {
        emitCoordinationEvent('sync:peer_removed', { peerId });
      }
      return result;
    },

    async triggerSync(ctx: OperationContext, options?: SyncOptions): Promise<Result<SyncResult>> {
      const tenantCheck = ensureTenant(ctx, 'trigger_sync');
      if (tenantCheck) return tenantCheck as Result<SyncResult>;
      const govCheck = evaluateGovernance(ctx, 'manage_agents', 'medium');
      if (!govCheck.ok) return govCheck as Result<SyncResult>;

      const result = doTriggerSync(getSyncDeps(), withEffectiveTenant(ctx), options);
      if (result.ok) {
        emitCoordinationEvent('sync:completed', { syncId: result.value.syncId, peersContacted: result.value.peersContacted });
      }
      return result;
    },

    async getSyncLog(ctx: OperationContext, options?: SyncLogOptions): Promise<Result<SyncEvent[]>> {
      const tenantCheck = ensureTenant(ctx, 'get_sync_log');
      if (tenantCheck) return tenantCheck as Result<SyncEvent[]>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<SyncEvent[]>;

      return doGetSyncLog(getSyncDeps(), withEffectiveTenant(ctx), options);
    },

    // ── Deterministic Replay (CO-3.15 through CO-3.18) ──

    async captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger): Promise<Result<StateSnapshot>> {
      const tenantCheck = ensureTenant(ctx, 'capture_snapshot');
      if (tenantCheck) return tenantCheck as Result<StateSnapshot>;
      const govCheck = evaluateGovernance(ctx, 'assert_claim', 'low');
      if (!govCheck.ok) return govCheck as Result<StateSnapshot>;

      const result = doCaptureSnapshot(getReplayDeps(), withEffectiveTenant(ctx), missionId, trigger);
      if (result.ok) {
        emitCoordinationEvent('replay:snapshot_captured', { snapshotId: result.value.id, missionId: missionId as string });
      }
      return result;
    },

    async verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions): Promise<Result<ReplayVerification>> {
      const tenantCheck = ensureTenant(ctx, 'verify_replay');
      if (tenantCheck) return tenantCheck as Result<ReplayVerification>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<ReplayVerification>;

      const result = doVerifyReplay(getReplayDeps(), withEffectiveTenant(ctx), missionId, options);
      if (result.ok) {
        if (result.value.verified) {
          emitCoordinationEvent('replay:verification_complete', { missionId: missionId as string, verified: true });
        } else {
          emitCoordinationEvent('replay:verification_failed', { missionId: missionId as string, divergenceCount: result.value.divergences.length });
        }
      }
      return result;
    },

    async getSnapshots(ctx: OperationContext, missionId: MissionId): Promise<Result<StateSnapshot[]>> {
      const tenantCheck = ensureTenant(ctx, 'get_snapshots');
      if (tenantCheck) return tenantCheck as Result<StateSnapshot[]>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<StateSnapshot[]>;

      return doGetSnapshots(getReplayDeps(), withEffectiveTenant(ctx), missionId);
    },

    async detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string): Promise<Result<DivergenceReport>> {
      const tenantCheck = ensureTenant(ctx, 'detect_divergence');
      if (tenantCheck) return tenantCheck as Result<DivergenceReport>;
      const govCheck = evaluateGovernance(ctx, 'query_claims', 'low');
      if (!govCheck.ok) return govCheck as Result<DivergenceReport>;

      const result = doDetectDivergence(getReplayDeps(), withEffectiveTenant(ctx), snapshotA, snapshotB);
      if (result.ok && result.value.divergences.length > 0) {
        emitCoordinationEvent('replay:divergence_detected', { snapshotA, snapshotB, divergenceCount: result.value.divergences.length });
      }
      return result;
    },

    // ── Events (CO-3.19, CO-3.20) ──

    on(_ctx: OperationContext, event: CoordinationEvent, handler: AgentEventHandler): string {
      const subscriptionId = randomUUID();
      subscriptions.set(subscriptionId, { event, handler });
      return subscriptionId;
    },

    off(_ctx: OperationContext, subscriptionId: string): void {
      subscriptions.delete(subscriptionId);
    },
  };

  // Note: NOT frozen here — the engine's deepFreeze (C-07) handles freezing
  // after the permission gateway has wrapped methods.
  return client;
}
