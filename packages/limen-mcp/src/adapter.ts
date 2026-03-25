/**
 * Session Adapter — manages Limen mission/task lifecycle for MCP sessions.
 *
 * Session mapping:
 *   Project  → Limen Mission  (one per project, created on session_open)
 *   Session  → Limen Task     (one per session_open, for scratch working memory)
 *   MCP Server → Limen Agent "limen-mcp" (registered on adapter init)
 *
 * Governance protection:
 *   Protected prefixes block supersession of governance claims via connect.
 *   v1 limitation: governance check relies on local claim subject cache (Map).
 *   Claims from previous sessions are not tracked — documented known limitation.
 */

import type { Limen, MissionId, TaskId, MissionHandle } from 'limen-ai';

/** Session info returned on successful open. */
export interface SessionInfo {
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly project: string;
}

/**
 * Adapter configuration.
 *
 * `protectedPrefixes` — Set of subject prefix strings used for governance
 * protection on `limen_connect` with `supersedes` relationship. Any claim
 * whose subject starts with a protected prefix cannot be superseded.
 * Populated from the `LIMEN_PROTECTED_PREFIXES` environment variable
 * (comma-separated, e.g. "governance:,system:,constitution:").
 * Defaults to empty set (no governance protection) if not configured.
 */
export interface AdapterConfig {
  readonly protectedPrefixes: Set<string>;
}

/**
 * Manages the MCP ↔ Limen lifecycle bridge.
 *
 * One adapter per MCP server process. At most one active session at a time.
 * The adapter registers itself as agent "limen-mcp" on init.
 */
export class SessionAdapter {
  private readonly _limen: Limen;
  private readonly _protectedPrefixes: Set<string>;

  private _handle: MissionHandle | null = null;
  private _missionId: MissionId | null = null;
  private _taskId: TaskId | null = null;
  private _project: string | null = null;

  /**
   * Local cache of claim subjects keyed by claimId.
   * Used for v1 governance check on connect/supersedes.
   * Only tracks claims created via remember/reflect in THIS session.
   */
  private readonly _claimSubjects = new Map<string, string>();

  constructor(limen: Limen, config: AdapterConfig) {
    this._limen = limen;
    this._protectedPrefixes = config.protectedPrefixes;
  }

  /**
   * Register the "limen-mcp" agent. Safe to call multiple times —
   * catches duplicate registration errors.
   */
  async init(): Promise<void> {
    try {
      await this._limen.agents.register({
        name: 'limen-mcp',
        domains: ['knowledge', 'mcp'],
        capabilities: ['claim_assert', 'claim_query', 'working_memory'],
      });
    } catch {
      // Agent already registered — benign in MCP server restarts.
    }
  }

  /**
   * Open a session for a project.
   *
   * Creates a mission and a single task for scratch working memory.
   * Only one session may be active at a time.
   */
  async openSession(project: string): Promise<SessionInfo> {
    if (this._missionId !== null) {
      throw new Error(`Session already active for project "${this._project}". Close it first.`);
    }

    // 1. Create mission
    const deadline = new Date(Date.now() + 86_400_000).toISOString(); // clock-exempt: infrastructure boundary
    const handle = await this._limen.missions.create({
      agent: 'limen-mcp',
      objective: `Knowledge session: ${project}`,
      constraints: {
        tokenBudget: 1_000_000,
        deadline,
      },
    });

    // 2-3. Propose task graph and execution — wrapped for cleanup on failure (F-MCP-003)
    const taskIdStr = `session-${Date.now()}`; // clock-exempt: infrastructure ID generation
    const taskId = taskIdStr as TaskId;

    try {
      await handle.proposeTaskGraph({
        missionId: handle.id,
        tasks: [{
          id: taskIdStr,
          description: 'Session task',
          executionMode: 'deterministic',
          estimatedTokens: 100_000,
        }],
        dependencies: [],
        objectiveAlignment: 'Knowledge session',
      });

      await handle.proposeTaskExecution({
        taskId,
        executionMode: 'deterministic',
        environmentRequest: {
          capabilities: [],
          timeout: 86_400_000,
        },
      });
    } catch (err: unknown) {
      // Cleanup: cancel the orphaned mission (best effort)
      try {
        await handle.cancel();
      } catch {
        // Cleanup failure is acceptable — re-throw original error
      }
      throw err;
    }

    // 4. Store state (including handle for lifecycle management — F-MCP-001)
    this._handle = handle;
    this._missionId = handle.id;
    this._taskId = taskId;
    this._project = project;
    this._claimSubjects.clear();

    return {
      missionId: handle.id,
      taskId,
      project,
    };
  }

  /**
   * Close the active session. Optionally stores a summary claim
   * before clearing state. The summary claim is asserted by the caller
   * (limen_session_close tool), not here — this method only clears adapter state.
   */
  async closeSession(summary?: string): Promise<void> {
    // Terminate the Limen mission before clearing state (F-MCP-001)
    if (this._handle) {
      try {
        await this._handle.submitResult({
          missionId: this._handle.id,
          summary: summary ?? 'Session closed',
          confidence: 1.0,
          artifactIds: [],
        });
      } catch {
        // Best effort — don't block close if engine rejects the submission.
        // The mission may have already been cancelled or completed.
      }
    }

    this._handle = null;
    this._missionId = null;
    this._taskId = null;
    this._project = null;
    this._claimSubjects.clear();
  }

  /** Whether a session is currently active. */
  get active(): boolean {
    return this._missionId !== null;
  }

  /** The active mission ID. Throws if no session is active. */
  get missionId(): MissionId {
    if (this._missionId === null) {
      throw new Error('No active session. Call limen_session_open first.');
    }
    return this._missionId;
  }

  /** The active task ID. Throws if no session is active. */
  get taskId(): TaskId {
    if (this._taskId === null) {
      throw new Error('No active session. Call limen_session_open first.');
    }
    return this._taskId;
  }

  /** The active project name. Throws if no session is active. */
  get project(): string {
    if (this._project === null) {
      throw new Error('No active session. Call limen_session_open first.');
    }
    return this._project;
  }

  /** The underlying Limen engine instance. */
  get engine(): Limen {
    return this._limen;
  }

  /**
   * Check if a subject matches any protected prefix.
   * Protected prefixes block supersession via connect.
   */
  isProtected(subject: string): boolean {
    for (const prefix of this._protectedPrefixes) {
      if (subject.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Track a claim subject for governance checks on connect/supersedes.
   * Called by remember/reflect tools after successful assertion.
   */
  trackClaim(claimId: string, subject: string): void {
    this._claimSubjects.set(claimId, subject);
  }

  /**
   * Look up a tracked claim's subject by ID.
   * Returns undefined if the claim was not created in this session.
   *
   * KNOWN LIMITATION (R-001): v1 governance protection only covers claims
   * created in the current session. Claims from previous sessions are not
   * in this cache, so `getTrackedSubject` returns undefined for them.
   * This means the governance check on `limen_connect` with `supersedes`
   * will NOT block supersession of cross-session claims, even if they have
   * protected subjects. Must be resolved in v2 by querying the engine.
   */
  getTrackedSubject(claimId: string): string | undefined {
    return this._claimSubjects.get(claimId);
  }
}
