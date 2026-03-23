/**
 * Session management for the API surface.
 * S ref: S26 (conversation model), SD-07 (session resumption), SD-15 (default session caching),
 *        S48 (backward compat), I-27 (conversation integrity)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 5
 *
 * Sessions scope conversations to a tenant+agent pair. The session manager:
 *   1. Creates new sessions (binding tenantId + agentId + conversationId)
 *   2. Resumes existing sessions by ID (SD-07)
 *   3. Caches a default session for backward-compat limen.chat() (SD-15, S48)
 *   4. Tracks active streams per session for backpressure enforcement
 *   5. Provides conversation history via ConversationManager delegation
 *   6. Supports conversation branching at a given turn (S26.3)
 *
 * In-memory state per createLimen() instance:
 *   - Map<SessionId, SessionState>: active sessions
 *   - Default session (cached for S48 backward compat)
 *
 * No database tables owned. Session persistence delegated to L2 ConversationManager.
 *
 * Invariants enforced: I-27 (conversation integrity)
 * Failure modes defended: FM-10 (tenant data leakage via session isolation)
 */

import type {
  SessionId, AgentId, TenantId, UserId, Permission,
  RbacEngine, DatabaseConnection,
} from '../../kernel/interfaces/index.js';
import type { OrchestrationEngine, OrchestrationDeps } from '../../orchestration/interfaces/orchestration.js';
import type {
  SessionOptions, Session, ChatMessage, ChatOptions, ChatResult,
  InferOptions, InferResult, ConversationTurnView, HitlMode,
} from '../interfaces/api.js';
import type { AuditTrail } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { Substrate } from '../../substrate/interfaces/substrate.js';
import { LimenError, unwrapResult } from '../errors/limen_error.js';
import { requirePermission, buildOperationContext } from '../enforcement/rbac_guard.js';

// ============================================================================
// SessionState (in-memory, per-instance)
// ============================================================================

/**
 * S26, SDD §5: In-memory session state.
 * Tracks the active session context including streams for backpressure.
 */
export interface SessionState {
  readonly sessionId: SessionId;
  readonly tenantId: TenantId | null;
  readonly agentId: AgentId;
  readonly conversationId: string;
  readonly userId: UserId | null;
  readonly permissions: ReadonlySet<Permission>;
  readonly hitlMode: HitlMode | null;
  readonly createdAt: number;
  /** Mutable: tracks concurrent streams for backpressure enforcement (S36) */
  readonly activeStreams: Set<string>;
}

// ============================================================================
// SessionManager
// ============================================================================

/**
 * S26, SD-07, SD-15: Manages session lifecycle for a single Limen instance.
 *
 * Each createLimen() call produces a SessionManager.
 * Two createLimen() calls produce independent SessionManagers (C-06).
 */
// CF-014: Maximum concurrent sessions per Limen instance
const MAX_SESSIONS = 10_000;

export class SessionManager {
  private readonly sessions: Map<SessionId, SessionState> = new Map();
  private defaultSession: SessionState | null = null;

  constructor(
    private readonly rbac: RbacEngine,
    private readonly orchestration: OrchestrationEngine,
    private readonly getConnection: () => DatabaseConnection,
    private readonly getAudit: () => AuditTrail,
    private readonly getSubstrate: () => Substrate,
    private readonly tenancyMode: 'single' | 'multi',
    private readonly chatFn: (sessionState: SessionState, message: string | ChatMessage, options?: Omit<ChatOptions, 'sessionId'>) => ChatResult,
    private readonly inferFn: <T>(sessionState: SessionState, options: Omit<InferOptions<T>, 'sessionId'>) => Promise<InferResult<T>>,
    private readonly time?: TimeProvider,
  ) {}

  /**
   * S26: Create or resume a session.
   * If resumeSessionId is provided, attempts to resume an existing session (SD-07).
   * Otherwise creates a new session with a fresh conversation.
   *
   * @param options - Session creation/resumption options
   * @returns Active Session handle
   * @throws LimenError if agent not found, session not found (resume), or unauthorized
   */
  async createSession(options: SessionOptions): Promise<Session> {
    const conn = this.getConnection();

    // Build a minimal context for RBAC check
    const tenantId = options.tenantId ?? null;
    const userId = (options.user?.id ?? null) as UserId | null;

    // Resolve permissions for this user
    let permissions: ReadonlySet<Permission>;
    if (this.tenancyMode === 'single' || !this.rbac.isActive()) {
      // §3.7: RBAC dormant in single-user mode. All permissions granted.
      permissions = new Set<Permission>([
        'create_agent', 'modify_agent', 'delete_agent',
        'chat', 'infer', 'create_mission',
        'view_telemetry', 'view_audit',
        'manage_providers', 'manage_budgets', 'manage_roles',
        'purge_data',
        'approve_response', 'edit_response', 'takeover_session', 'review_batch',
      ]);
    } else if (userId !== null) {
      const permResult = this.rbac.getPermissions(conn, 'user', userId, tenantId);
      permissions = unwrapResult(permResult);
    } else {
      permissions = new Set<Permission>();
    }

    const ctx = buildOperationContext(tenantId, userId, null, permissions);

    // I-13: RBAC check for chat permission (creating a session implies chat intent)
    requirePermission(this.rbac, ctx, 'chat');

    // Use provided agent name as agentId (API layer resolves names)
    const agentId = options.agentName as AgentId;

    let sessionState: SessionState;

    if (options.resumeSessionId) {
      // SD-07: Resume existing session
      const existing = this.sessions.get(options.resumeSessionId);
      if (!existing) {
        throw new LimenError('SESSION_NOT_FOUND', 'The specified session was not found.');
      }

      // FM-10: Verify tenant isolation on resume
      if (existing.tenantId !== tenantId) {
        throw new LimenError('SESSION_NOT_FOUND', 'The specified session was not found.');
      }
      sessionState = existing;
    } else {
      // CF-014: Bound in-memory session count
      if (this.sessions.size >= MAX_SESSIONS) {
        throw new LimenError('RATE_LIMITED',
          `Maximum concurrent sessions (${MAX_SESSIONS}) exceeded. Close existing sessions first.`);
      }

      // Create new session with fresh conversation via L2 ConversationManager
      const deps = this.buildOrchDeps();
      const sessionId = this.generateSessionId();
      const conversationResult = this.orchestration.conversations.create(
        deps, sessionId, agentId, tenantId,
      );
      const conversationId = unwrapResult(conversationResult);

      sessionState = {
        sessionId,
        tenantId,
        agentId,
        conversationId,
        userId,
        permissions,
        hitlMode: options.hitl?.mode ?? null,
        createdAt: (this.time ?? { nowMs: () => Date.now() }).nowMs(),
        activeStreams: new Set(),
      };
    }

    // Register in active sessions
    this.sessions.set(sessionState.sessionId, sessionState);

    return this.buildSessionHandle(sessionState);
  }

  /**
   * S48, SD-15: Get or create the default session for backward-compat limen.chat().
   * The default session uses agent named 'default' and is cached for reuse.
   */
  async getDefaultSession(): Promise<SessionState> {
    if (this.defaultSession) {
      return this.defaultSession;
    }

    // A-03: Default agent name is 'default'
    const session = await this.createSession({ agentName: 'default' });
    const state = this.sessions.get(session.id);
    if (!state) {
      throw new LimenError('ENGINE_UNHEALTHY', 'Failed to create default session.');
    }

    this.defaultSession = state;
    return state;
  }

  /**
   * Get an active session state by ID.
   * Used internally by chat/infer when sessionId is provided.
   */
  getSessionState(sessionId: SessionId): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * S26: Close a session. Removes from active sessions.
   */
  async closeSession(sessionState: SessionState): Promise<void> {
    // Remove from active sessions
    this.sessions.delete(sessionState.sessionId);

    // Clear default session reference if this was it
    if (this.defaultSession?.sessionId === sessionState.sessionId) {
      this.defaultSession = null;
    }
  }

  /**
   * Shutdown: close all sessions.
   * Called during limen.shutdown().
   */
  async closeAll(): Promise<void> {
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      await this.closeSession(session);
    }
  }

  /**
   * Get count of all active streams across all sessions.
   * Used by stream capacity enforcement (S36).
   */
  getActiveStreamCount(tenantId: TenantId | null): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.tenantId === tenantId) {
        count += session.activeStreams.size;
      }
    }
    return count;
  }

  // ─── Private Helpers ──

  /**
   * Build OrchestrationDeps for L2 subsystem calls.
   */
  private buildOrchDeps(): OrchestrationDeps {
    const clock = this.time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
    return {
      conn: this.getConnection(),
      substrate: this.getSubstrate(),
      audit: this.getAudit(),
      time: clock,
    };
  }

  /**
   * Build a Session handle from SessionState.
   * The Session interface exposes chat(), infer(), fork(), history(), close().
   */
  private buildSessionHandle(state: SessionState): Session {
    const manager = this;

    const session: Session = {
      id: state.sessionId,
      agentId: state.agentId,
      tenantId: state.tenantId,
      conversationId: state.conversationId,
      createdAt: new Date(state.createdAt).toISOString(),

      chat(message: string | ChatMessage, options?: Omit<ChatOptions, 'sessionId'>): ChatResult {
        return manager.chatFn(state, message, options);
      },

      async infer<T>(options: Omit<InferOptions<T>, 'sessionId'>): Promise<InferResult<T>> {
        return manager.inferFn(state, options);
      },

      async fork(atTurn: number): Promise<Session> {
        // S26.3: Fork conversation at given turn (copy-on-branch)
        const deps = manager.buildOrchDeps();
        const forkResult = manager.orchestration.conversations.fork(
          deps, state.conversationId, atTurn, state.tenantId,
        );
        const forkedConversationId = unwrapResult(forkResult);

        const forkedSessionId = manager.generateSessionId();
        const forkedState: SessionState = {
          sessionId: forkedSessionId,
          tenantId: state.tenantId,
          agentId: state.agentId,
          conversationId: forkedConversationId,
          userId: state.userId,
          permissions: state.permissions,
          hitlMode: state.hitlMode,
          createdAt: (manager.time ?? { nowMs: () => Date.now() }).nowMs(),
          activeStreams: new Set(),
        };

        manager.sessions.set(forkedSessionId, forkedState);
        return manager.buildSessionHandle(forkedState);
      },

      async history(): Promise<readonly ConversationTurnView[]> {
        // S26: Get conversation history via L2 ConversationManager
        const deps = manager.buildOrchDeps();
        const turnsResult = manager.orchestration.conversations.getTurns(
          deps, state.conversationId,
        );
        const turns = unwrapResult(turnsResult);

        // Map internal turn data to ConversationTurnView (no internal fields exposed)
        return turns.map((turn) => ({
          turnNumber: turn.turnNumber,
          role: turn.role as 'user' | 'assistant' | 'system' | 'tool',
          content: turn.content,
          timestamp: turn.createdAt,
          tokenCount: turn.tokenCount,
          isSummary: turn.isSummary,
        }));
      },

      async close(): Promise<void> {
        await manager.closeSession(state);
      },
    };

    return session;
  }

  /**
   * Generate a unique session ID.
   * Uses crypto.randomUUID() for collision-free identifiers.
   */
  private generateSessionId(): SessionId {
    return crypto.randomUUID() as SessionId;
  }
}
