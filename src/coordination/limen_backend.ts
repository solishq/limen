/**
 * Phase 6 — Coordination Backend Adapter (FR-009)
 *
 * Thin adapter that maps a CoordinationBackend interface to Limen API calls,
 * enabling Symphonic Swarm cluster mode to use Limen as its coordination substrate.
 *
 * Architecture: Pure delegation layer. No new system calls. No new database tables.
 * Every operation translates to remember/recall/forget/claims.queryClaims.
 *
 * Clock injection: All temporal logic uses TimeProvider (Hard Stop #7).
 * Failure semantics: Every method returns Result<T> with specific error codes.
 *
 * Defect classes defended:
 *   DC-COORD-SC-3: Expired lock cleanup before contention check.
 *   DC-COORD-CC-1: Check-then-write for lock acquisition.
 *   DC-COORD-DI-2: JSON parse errors surfaced as typed errors.
 */

import type { Result } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { Limen } from '../api/interfaces/api.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'FR-009' } };
}

// ── Public Types ──

export interface SessionInfo {
  readonly sessionId: string;
  readonly agentRole: string;
  readonly project: string;
  readonly status: string;
  readonly registeredAt: string;
}

export interface DecisionInfo {
  readonly claimId: string;
  readonly sessionId: string;
  readonly domain: string;
  readonly content: string;
  readonly confidence: number;
  readonly recordedAt: string;
}

export interface LockInfo {
  readonly lockId: string;
  readonly domain: string;
  readonly holder: string;
  readonly expiresAt: string | null;
  readonly acquiredAt: string;
}

export interface CoordinationBackend {
  registerSession(session: {
    sessionId: string;
    agentRole: string;
    project: string;
    status: string;
  }): Result<void>;
  deregisterSession(sessionId: string): Result<void>;
  getActiveSessions(project?: string): Result<readonly SessionInfo[]>;

  recordDecision(decision: {
    sessionId: string;
    domain: string;
    content: string;
    confidence?: number;
  }): Result<{ claimId: string }>;
  getRecentDecisions(
    domain?: string,
    since?: string,
  ): Result<readonly DecisionInfo[]>;

  acquireLock(
    domain: string,
    holder: string,
    ttlMs?: number,
  ): Result<{ lockId: string }>;
  releaseLock(lockId: string): Result<void>;
  getActiveLocks(project?: string): Result<readonly LockInfo[]>;
}

// ── Subject URN Conventions ──

const SESSION_SUBJECT_PREFIX = 'entity:session:';
const DECISION_SUBJECT_PREFIX = 'entity:decision:';
const LOCK_SUBJECT_PREFIX = 'entity:lock:';

const SESSION_PREDICATE = 'session.active';
const LOCK_PREDICATE = 'lock.active';

function sessionSubject(sessionId: string): string {
  return `${SESSION_SUBJECT_PREFIX}${sessionId}`;
}

function decisionSubject(domain: string): string {
  return `${DECISION_SUBJECT_PREFIX}${domain}`;
}

function lockSubject(domain: string): string {
  return `${LOCK_SUBJECT_PREFIX}${domain}`;
}

function decisionPredicate(domain: string): string {
  return `decision.${domain}`;
}

// ── Implementation ──

/**
 * Create a CoordinationBackend backed by a Limen engine instance.
 *
 * @param limen - A fully initialized Limen engine instance.
 * @param time - TimeProvider for clock injection (Hard Stop #7).
 * @returns CoordinationBackend with all operations delegating to Limen.
 */
export function createLimenBackend(
  limen: Limen,
  time: TimeProvider,
): CoordinationBackend {
  return {
    // ── Session Management ──

    registerSession(session): Result<void> {
      const now = time.nowISO();
      const payload: SessionInfo = {
        sessionId: session.sessionId,
        agentRole: session.agentRole,
        project: session.project,
        status: session.status,
        registeredAt: now,
      };
      const result = limen.remember(
        sessionSubject(session.sessionId),
        SESSION_PREDICATE,
        JSON.stringify(payload),
      );
      if (!result.ok) {
        return err('COORD_SESSION_REGISTER_FAILED', result.error.message);
      }
      return ok(undefined);
    },

    deregisterSession(sessionId): Result<void> {
      // Find the claim for this session
      const recallResult = limen.recall(
        sessionSubject(sessionId),
        SESSION_PREDICATE,
      );
      if (!recallResult.ok) {
        return err('COORD_SESSION_DEREGISTER_FAILED', recallResult.error.message);
      }
      const beliefs = recallResult.value;
      if (beliefs.length === 0) {
        return err('COORD_SESSION_NOT_FOUND', `No active session with id '${sessionId}'`);
      }
      // Retract the most recent active claim for this session
      const belief = beliefs[0]!;
      const forgetResult = limen.forget(belief.claimId, 'manual');
      if (!forgetResult.ok) {
        return err('COORD_SESSION_DEREGISTER_FAILED', forgetResult.error.message);
      }
      return ok(undefined);
    },

    getActiveSessions(project?): Result<readonly SessionInfo[]> {
      const recallResult = limen.recall(
        `${SESSION_SUBJECT_PREFIX}*`,
        SESSION_PREDICATE,
      );
      if (!recallResult.ok) {
        return err('COORD_SESSION_QUERY_FAILED', recallResult.error.message);
      }
      const sessions: SessionInfo[] = [];
      for (const belief of recallResult.value) {
        try {
          const info = JSON.parse(belief.value) as SessionInfo;
          if (project === undefined || info.project === project) {
            sessions.push(info);
          }
        } catch {
          // DC-COORD-DI-2: Skip malformed entries rather than failing entire query
          continue;
        }
      }
      return ok(sessions);
    },

    // ── Decision Coordination ──

    recordDecision(decision): Result<{ claimId: string }> {
      const confidence = decision.confidence ?? 0.7;
      const result = limen.remember(
        decisionSubject(decision.domain),
        decisionPredicate(decision.domain),
        JSON.stringify({
          sessionId: decision.sessionId,
          content: decision.content,
        }),
        { confidence },
      );
      if (!result.ok) {
        return err('COORD_DECISION_RECORD_FAILED', result.error.message);
      }
      return ok({ claimId: result.value.claimId });
    },

    getRecentDecisions(domain?, since?): Result<readonly DecisionInfo[]> {
      const predicateFilter = domain
        ? decisionPredicate(domain)
        : 'decision.*';
      const subjectFilter = domain
        ? decisionSubject(domain)
        : `${DECISION_SUBJECT_PREFIX}*`;

      const recallResult = limen.recall(subjectFilter, predicateFilter);
      if (!recallResult.ok) {
        return err('COORD_DECISION_QUERY_FAILED', recallResult.error.message);
      }

      const decisions: DecisionInfo[] = [];
      for (const belief of recallResult.value) {
        // Filter by 'since' timestamp if provided
        if (since && belief.createdAt < since) {
          continue;
        }
        try {
          const data = JSON.parse(belief.value) as {
            sessionId: string;
            content: string;
          };
          // Extract domain from predicate: "decision.<domain>"
          const domainFromPredicate = belief.predicate.startsWith('decision.')
            ? belief.predicate.substring('decision.'.length)
            : belief.predicate;

          decisions.push({
            claimId: belief.claimId,
            sessionId: data.sessionId,
            domain: domainFromPredicate,
            content: data.content,
            confidence: belief.confidence,
            recordedAt: belief.createdAt,
          });
        } catch {
          // DC-COORD-DI-2: Skip malformed entries
          continue;
        }
      }
      return ok(decisions);
    },

    // ── Domain Locking ──

    acquireLock(domain, holder, ttlMs?): Result<{ lockId: string }> {
      const now = time.nowISO();
      const nowMs = new Date(now).getTime();

      // Check for existing active lock on this domain
      // DC-COORD-SC-3: Check expiry before declaring contention
      const existingResult = limen.recall(
        lockSubject(domain),
        LOCK_PREDICATE,
      );
      if (!existingResult.ok) {
        return err('COORD_LOCK_QUERY_FAILED', existingResult.error.message);
      }

      for (const belief of existingResult.value) {
        try {
          const lockData = JSON.parse(belief.value) as {
            holder: string;
            expiresAt: string | null;
          };
          // If expired, clean up the stale lock
          if (lockData.expiresAt && new Date(lockData.expiresAt).getTime() <= nowMs) {
            limen.forget(belief.claimId, 'expired');
            continue;
          }
          // DC-COORD-CC-1: Active non-expired lock found -- contention
          return err(
            'COORD_LOCK_CONTENTION',
            `Domain '${domain}' is already locked by '${lockData.holder}'`,
          );
        } catch {
          // Malformed lock data -- clean it up
          limen.forget(belief.claimId, 'manual');
          continue;
        }
      }

      // No active lock -- acquire
      const expiresAt = ttlMs
        ? new Date(nowMs + ttlMs).toISOString()
        : null;

      const lockPayload = JSON.stringify({ holder, expiresAt });
      const result = limen.remember(
        lockSubject(domain),
        LOCK_PREDICATE,
        lockPayload,
      );
      if (!result.ok) {
        return err('COORD_LOCK_ACQUIRE_FAILED', result.error.message);
      }
      return ok({ lockId: result.value.claimId });
    },

    releaseLock(lockId): Result<void> {
      const forgetResult = limen.forget(lockId, 'manual');
      if (!forgetResult.ok) {
        return err('COORD_LOCK_RELEASE_FAILED', forgetResult.error.message);
      }
      return ok(undefined);
    },

    getActiveLocks(_project?): Result<readonly LockInfo[]> {
      const now = time.nowISO();
      const nowMs = new Date(now).getTime();

      const recallResult = limen.recall(
        `${LOCK_SUBJECT_PREFIX}*`,
        LOCK_PREDICATE,
      );
      if (!recallResult.ok) {
        return err('COORD_LOCK_QUERY_FAILED', recallResult.error.message);
      }

      const locks: LockInfo[] = [];
      for (const belief of recallResult.value) {
        try {
          const data = JSON.parse(belief.value) as {
            holder: string;
            expiresAt: string | null;
          };
          // Skip expired locks
          if (data.expiresAt && new Date(data.expiresAt).getTime() <= nowMs) {
            continue;
          }
          // Extract domain from subject: "entity:lock:<domain>"
          const domain = belief.subject.startsWith(LOCK_SUBJECT_PREFIX)
            ? belief.subject.substring(LOCK_SUBJECT_PREFIX.length)
            : belief.subject;

          locks.push({
            lockId: belief.claimId,
            domain,
            holder: data.holder,
            expiresAt: data.expiresAt,
            acquiredAt: belief.createdAt,
          });
        } catch {
          // DC-COORD-DI-2: Skip malformed entries
          continue;
        }
      }
      return ok(locks);
    },
  };
}
