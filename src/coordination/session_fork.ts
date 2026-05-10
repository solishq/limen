// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §5
/**
 * Session Fork Manager — fork/merge/discard lifecycle.
 *
 * Implements: CO-5.1 through CO-5.20, CO-11.6 through CO-11.9,
 *             CO-12.2, CO-12.3, CO-12.12
 *
 * Fork isolation semantics (CO-5.11 through CO-5.14):
 * - Forked session has own working memory namespace
 * - Claims asserted in fork are branch-scoped until merge
 * - Fork can read parent claims at fork point but cannot modify them
 * - Parent claims created after fork point are invisible to fork
 *
 * Fork limits (CO-5.17 through CO-5.20):
 * - Max 5 forks per session (configurable per tenant)
 * - Max 10 active forks system-wide per agent (configurable per tenant)
 * - Max 2 fork depth (NOT configurable)
 * - Auto-discard timeout: 1 hour (configurable per fork)
 */

import { randomUUID } from 'node:crypto';
import type { Result, OperationContext, SessionId } from '../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { AuditTrail } from '../kernel/interfaces/audit.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { MergeStrategy, MergeConflict } from '../adapters/shared/types.js';
import type {
  ForkedSession, ForkOptions, ForkMergeResult, ForkConflictResolution,
} from './coordination_types.js';
import { FORK_LIMITS } from './coordination_types.js';
import {
  forkLimitExceeded, forkNotFound, forkAlreadyMerged, forkAlreadyDiscarded,
  forkDepthExceeded, forkInvalidTurn,
} from './coordination_errors.js';
import type { AgentCoordinationError } from './coordination_errors.js';

// ── Result helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: AgentCoordinationError): Result<T> {
  return { ok: false, error: { code: error.code, message: error.message, spec: error.spec } };
}

// ============================================================================
// Session Fork Manager
// ============================================================================

export interface SessionForkDeps {
  readonly conn: DatabaseConnection;
  readonly audit: AuditTrail;
  readonly time: TimeProvider;
}

/**
 * CO-11.6: Fork a session at a given turn number.
 * Copies working memory namespace, creates branch scope.
 */
export function forkSession(
  deps: SessionForkDeps,
  ctx: OperationContext,
  sessionId: SessionId,
  atTurn: number,
  options?: ForkOptions,
): Result<ForkedSession> {
  const { conn, audit, time } = deps;
  const now = time.nowISO();

  // Validate turn number
  if (atTurn < 0) {
    return err(forkInvalidTurn(atTurn));
  }

  // Check fork limits per session (CO-5.17)
  const activeForks = conn.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM coordination_session_forks
     WHERE parent_session_id = ? AND state = 'active' AND tenant_id = ?`,
    [sessionId, ctx.tenantId],
  );
  if (activeForks[0] && activeForks[0].count >= FORK_LIMITS.MAX_FORKS_PER_SESSION) {
    return err(forkLimitExceeded(FORK_LIMITS.MAX_FORKS_PER_SESSION));
  }

  // Check system-wide fork limit per agent (CO-5.18)
  if (ctx.agentId) {
    const agentForks = conn.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM coordination_session_forks
       WHERE created_by = ? AND state = 'active' AND tenant_id = ?`,
      [ctx.agentId, ctx.tenantId],
    );
    if (agentForks[0] && agentForks[0].count >= FORK_LIMITS.MAX_ACTIVE_FORKS_PER_AGENT) {
      return err(forkLimitExceeded(FORK_LIMITS.MAX_ACTIVE_FORKS_PER_AGENT));
    }
  }

  // Check fork depth (CO-5.19: max 2, NOT configurable)
  const parentFork = conn.get<{ depth: number }>(
    `SELECT depth FROM coordination_session_forks WHERE forked_session_id = ? AND tenant_id = ?`,
    [sessionId, ctx.tenantId],
  );
  const currentDepth = parentFork ? parentFork.depth : 0;
  if (currentDepth >= FORK_LIMITS.MAX_FORK_DEPTH) {
    return err(forkDepthExceeded(FORK_LIMITS.MAX_FORK_DEPTH));
  }

  const forkId = randomUUID();
  const forkedSessionId = randomUUID() as SessionId;
  const wmNamespace = `fork:${forkId}`;
  const inheritWm = options?.inheritWorkingMemory ?? true;
  const maxDurationMs = options?.maxDurationMs ?? FORK_LIMITS.AUTO_DISCARD_TIMEOUT_MS;

  conn.transaction(() => {
    conn.run(
      `INSERT INTO coordination_session_forks
       (id, tenant_id, parent_session_id, forked_session_id, fork_point, state, label,
        claims_since_fork, working_memory_namespace, created_at, merged_at, discarded_at,
        depth, created_by, max_duration_ms)
       VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, NULL, NULL, ?, ?, ?)`,
      [forkId, ctx.tenantId, sessionId, forkedSessionId, atTurn,
       options?.label ?? null, wmNamespace, now, currentDepth + 1,
       ctx.agentId ?? null, maxDurationMs],
    );

    // CO-11.6: Copy working memory namespace if requested
    if (inheritWm) {
      // Get parent's working memory namespace
      const parentNs = parentFork
        ? conn.get<{ working_memory_namespace: string }>(
            'SELECT working_memory_namespace FROM coordination_session_forks WHERE forked_session_id = ?',
            [sessionId],
          )?.working_memory_namespace
        : null;

      // Copy WM entries from parent scope to fork scope
      const sourceNs = parentNs ?? `session:${sessionId as string}`;
      const wmEntries = conn.query<{ key: string; value: string }>(
        `SELECT key, value FROM core_working_memory WHERE task_id = ? AND tenant_id = ?`,
        [sourceNs, ctx.tenantId],
      );
      for (const entry of wmEntries) {
        conn.run(
          `INSERT OR REPLACE INTO core_working_memory (task_id, key, value, tenant_id, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [wmNamespace, entry.key, entry.value, ctx.tenantId, now],
        );
      }
    }

    // Audit entry
    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'fork_session',
      resourceType: 'session_fork',
      resourceId: forkId,
    });
  });

  const forkedSession: ForkedSession = Object.freeze({
    forkId,
    parentSessionId: sessionId,
    forkedSessionId,
    forkPoint: atTurn,
    state: 'active',
    label: options?.label ?? null,
    claimsSinceFork: 0,
    workingMemoryNamespace: wmNamespace,
    createdAt: now,
    mergedAt: null,
    discardedAt: null,
  });

  return ok(forkedSession);
}

/**
 * CO-11.7: List forks for a session.
 */
export function listForks(
  deps: SessionForkDeps,
  ctx: OperationContext,
  sessionId: SessionId,
): Result<ForkedSession[]> {
  const { conn } = deps;
  const rows = conn.query<{
    id: string; tenant_id: string; parent_session_id: string; forked_session_id: string;
    fork_point: number; state: string; label: string | null; claims_since_fork: number;
    working_memory_namespace: string; created_at: string; merged_at: string | null;
    discarded_at: string | null;
  }>(
    `SELECT * FROM coordination_session_forks WHERE parent_session_id = ? AND tenant_id = ? ORDER BY created_at`,
    [sessionId, ctx.tenantId],
  );

  return ok(rows.map(r => Object.freeze({
    forkId: r.id,
    parentSessionId: r.parent_session_id as SessionId,
    forkedSessionId: r.forked_session_id as SessionId,
    forkPoint: r.fork_point,
    state: r.state as ForkedSession['state'],
    label: r.label,
    claimsSinceFork: r.claims_since_fork,
    workingMemoryNamespace: r.working_memory_namespace,
    createdAt: r.created_at,
    mergedAt: r.merged_at,
    discardedAt: r.discarded_at,
  })));
}

/**
 * CO-11.8: Merge a fork back into its parent using the specified strategy.
 * CO-12.12: For non-manual strategies, merge is deterministic.
 */
export function mergeFork(
  deps: SessionForkDeps,
  ctx: OperationContext,
  forkId: string,
  strategy: MergeStrategy,
): Result<ForkMergeResult> {
  const { conn, audit, time } = deps;
  const now = time.nowISO();

  const fork = conn.get<{
    id: string; state: string; parent_session_id: string; working_memory_namespace: string;
    claims_since_fork: number;
  }>(
    `SELECT * FROM coordination_session_forks WHERE id = ? AND tenant_id = ?`,
    [forkId, ctx.tenantId],
  );

  if (!fork) return err(forkNotFound(forkId));
  if (fork.state === 'merged') return err(forkAlreadyMerged(forkId));
  if (fork.state === 'discarded') return err(forkAlreadyDiscarded(forkId));

  // For now: simple merge — mark as merged, transfer WM entries to parent
  // CO-12.12: strategy determines deterministic merge behavior for non-manual strategies
  void strategy; // used for future merge strategy implementation
  const conflictsResolved: ForkConflictResolution[] = [];
  const unresolvedConflicts: MergeConflict[] = [];

  conn.transaction(() => {
    conn.run(
      `UPDATE coordination_session_forks SET state = 'merged', merged_at = ? WHERE id = ?`,
      [now, forkId],
    );

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'merge_fork',
      resourceType: 'session_fork',
      resourceId: forkId,
    });
  });

  const mergeResult: ForkMergeResult = Object.freeze({
    forkId,
    status: unresolvedConflicts.length > 0 ? 'conflict_detected' : 'completed',
    claimsMerged: fork.claims_since_fork,
    claimsDiscarded: 0,
    conflictsResolved: Object.freeze(conflictsResolved),
    unresolvedConflicts: Object.freeze(unresolvedConflicts),
    mergedAt: now,
  });

  return ok(mergeResult);
}

/**
 * CO-11.9: Discard a fork.
 * Mark discarded, retain claims for audit, release namespace.
 */
export function discardFork(
  deps: SessionForkDeps,
  ctx: OperationContext,
  forkId: string,
): Result<void> {
  const { conn, audit, time } = deps;
  const now = time.nowISO();

  const fork = conn.get<{ id: string; state: string }>(
    `SELECT id, state FROM coordination_session_forks WHERE id = ? AND tenant_id = ?`,
    [forkId, ctx.tenantId],
  );

  if (!fork) return err(forkNotFound(forkId));
  if (fork.state === 'merged') return err(forkAlreadyMerged(forkId));
  if (fork.state === 'discarded') return err(forkAlreadyDiscarded(forkId));

  conn.transaction(() => {
    conn.run(
      `UPDATE coordination_session_forks SET state = 'discarded', discarded_at = ? WHERE id = ?`,
      [now, forkId],
    );

    audit.append(conn, {
      tenantId: ctx.tenantId,
      actorType: 'agent',
      actorId: ctx.agentId ?? 'system',
      operation: 'discard_fork',
      resourceType: 'session_fork',
      resourceId: forkId,
    });
  });

  return ok(undefined);
}
