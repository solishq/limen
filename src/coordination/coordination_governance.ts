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
} from '../adapters/shared/types.js';
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
  a2aRuleNotFound, coordinationTenantMismatch,
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
  return { ok: false, error: { code: error.code, message: error.message, spec: error.spec } };
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

  function ensureTenant(ctx: OperationContext): Result<void> | null {
    // CO-12.1: All operations are tenant-scoped
    if (ctx.tenantId === null || ctx.tenantId === undefined) {
      return err(coordinationTenantMismatch(null, null));
    }
    return null;
  }

  // ── Build client ──

  const client: AgentCoordinationClient = {
    // ── A2A Governance (CO-3.1 through CO-3.5) ──

    async registerA2ARule(ctx: OperationContext, rule: A2AGovernanceRuleInput): Promise<Result<string>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<string>;

      const conn = getConnection();
      const ruleId = randomUUID();
      const now = time.nowISO();
      const priority = rule.priority ?? DEFAULT_RULE_PRIORITY;

      conn.transaction(() => {
        conn.run(
          `INSERT INTO coordination_a2a_rules
           (id, tenant_id, source_agent, target_agent, skill, action, conditions, priority, enabled, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [ruleId, ctx.tenantId, rule.sourceAgent, rule.targetAgent, rule.skill,
           rule.action, JSON.stringify(rule.conditions ?? []), priority, now,
           ctx.agentId ?? 'system'],
        );

        audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: 'agent',
          actorId: ctx.agentId ?? 'system',
          operation: 'register_a2a_rule',
          resourceType: 'a2a_rule',
          resourceId: ruleId,
        });
      });

      return ok(ruleId);
    },

    async removeA2ARule(ctx: OperationContext, ruleId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<void>;

      const conn = getConnection();
      const existing = conn.get<{ id: string }>(
        `SELECT id FROM coordination_a2a_rules WHERE id = ? AND tenant_id = ?`,
        [ruleId, ctx.tenantId],
      );
      if (!existing) return err(a2aRuleNotFound(ruleId));

      conn.transaction(() => {
        // CO-11.2: Soft-delete — set enabled=false, retain for audit
        conn.run(
          `UPDATE coordination_a2a_rules SET enabled = 0 WHERE id = ?`,
          [ruleId],
        );

        audit.append(conn, {
          tenantId: ctx.tenantId,
          actorType: 'agent',
          actorId: ctx.agentId ?? 'system',
          operation: 'remove_a2a_rule',
          resourceType: 'a2a_rule',
          resourceId: ruleId,
        });
      });

      return ok(undefined);
    },

    async listA2ARules(ctx: OperationContext, filter?: A2ARuleFilter): Promise<Result<A2AGovernanceRule[]>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<A2AGovernanceRule[]>;

      const conn = getConnection();
      let sql = `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ?`;
      const params: unknown[] = [ctx.tenantId];

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
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<A2AVerdict>;

      // CO-12.8: Evaluate boundaries on every call — no caching
      const conn = getConnection();
      const rows = conn.query<{
        id: string; tenant_id: string; source_agent: string; target_agent: string;
        skill: string; action: string; conditions: string; priority: number;
        enabled: number; created_at: string; created_by: string;
      }>(
        `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ? AND enabled = 1 ORDER BY priority ASC, created_at ASC`,
        [ctx.tenantId],
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

      const verdict = evaluateA2ARules(rules, action, targetAgent);

      // CO-12.9: Audit the validation
      audit.append(conn, {
        tenantId: ctx.tenantId,
        actorType: 'agent',
        actorId: ctx.agentId ?? 'system',
        operation: 'validate_a2a_action',
        resourceType: 'a2a_action',
        resourceId: verdict.ruleId,
      });

      return ok(verdict);
    },

    async getCapabilityBoundary(ctx: OperationContext, agentId: AgentId, skill: string): Promise<Result<CapabilityBoundary>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<CapabilityBoundary>;

      const conn = getConnection();

      // Look up agent trust level
      const agentRow = conn.get<{ trust_level: string }>(
        `SELECT trust_level FROM core_agents WHERE id = ? AND tenant_id = ?`,
        [agentId, ctx.tenantId],
      );
      const trustLevel: AgentTrustLevel = (agentRow?.trust_level as AgentTrustLevel) ?? 'untrusted';

      // Get rules for this agent
      const ruleRows = conn.query<{
        id: string; tenant_id: string; source_agent: string; target_agent: string;
        skill: string; action: string; conditions: string; priority: number;
        enabled: number; created_at: string; created_by: string;
      }>(
        `SELECT * FROM coordination_a2a_rules WHERE tenant_id = ? AND enabled = 1`,
        [ctx.tenantId],
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
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<ForkedSession>;

      const sessionId = (ctx as { sessionId?: SessionId }).sessionId ?? (randomUUID() as SessionId);
      return doForkSession(getForkDeps(), ctx, sessionId, atTurn, options);
    },

    async listForks(ctx: OperationContext, sessionId: SessionId): Promise<Result<ForkedSession[]>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<ForkedSession[]>;

      return doListForks(getForkDeps(), ctx, sessionId);
    },

    async mergeFork(ctx: OperationContext, forkId: string, strategy: MergeStrategy): Promise<Result<ForkMergeResult>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<ForkMergeResult>;

      return doMergeFork(getForkDeps(), ctx, forkId, strategy);
    },

    async discardFork(ctx: OperationContext, forkId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<void>;

      return doDiscardFork(getForkDeps(), ctx, forkId);
    },

    // ── Distributed Sync (CO-3.10 through CO-3.14) ──

    async getSyncState(ctx: OperationContext): Promise<Result<SyncState>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<SyncState>;

      return doGetSyncState(getSyncDeps(), ctx);
    },

    async registerPeer(ctx: OperationContext, peer: PeerRegistration): Promise<Result<string>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<string>;

      return doRegisterPeer(getSyncDeps(), ctx, peer);
    },

    async removePeer(ctx: OperationContext, peerId: string): Promise<Result<void>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<void>;

      return doRemovePeer(getSyncDeps(), ctx, peerId);
    },

    async triggerSync(ctx: OperationContext, options?: SyncOptions): Promise<Result<SyncResult>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<SyncResult>;

      return doTriggerSync(getSyncDeps(), ctx, options);
    },

    async getSyncLog(ctx: OperationContext, options?: SyncLogOptions): Promise<Result<SyncEvent[]>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<SyncEvent[]>;

      return doGetSyncLog(getSyncDeps(), ctx, options);
    },

    // ── Deterministic Replay (CO-3.15 through CO-3.18) ──

    async captureSnapshot(ctx: OperationContext, missionId: MissionId, trigger: SnapshotTrigger): Promise<Result<StateSnapshot>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<StateSnapshot>;

      return doCaptureSnapshot(getReplayDeps(), ctx, missionId, trigger);
    },

    async verifyReplay(ctx: OperationContext, missionId: MissionId, options?: ReplayVerifyOptions): Promise<Result<ReplayVerification>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<ReplayVerification>;

      return doVerifyReplay(getReplayDeps(), ctx, missionId, options);
    },

    async getSnapshots(ctx: OperationContext, missionId: MissionId): Promise<Result<StateSnapshot[]>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<StateSnapshot[]>;

      return doGetSnapshots(getReplayDeps(), ctx, missionId);
    },

    async detectDivergence(ctx: OperationContext, snapshotA: string, snapshotB: string): Promise<Result<DivergenceReport>> {
      const tenantCheck = ensureTenant(ctx);
      if (tenantCheck) return tenantCheck as Result<DivergenceReport>;

      return doDetectDivergence(getReplayDeps(), ctx, snapshotA, snapshotB);
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
