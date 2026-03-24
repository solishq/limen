/**
 * Mission Store -- Foundation store for all orchestration.
 * S ref: S6 (Mission lifecycle), I-18 (persistence), I-20 (tree limits),
 *        I-22 (capability immutability), I-24 (goal anchoring), FM-19 (delegation cycle)
 *
 * Phase: 3 (Orchestration)
 * Implements: Mission creation, state transitions, tree structure queries.
 * All state mutations include audit entries in the same transaction (I-03).
 */

import type { Result, OperationContext, MissionId, AgentId, TenantId } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, MissionStore, Mission, MissionState, MissionConstraints,
  ProposeMissionInput, ProposeMissionOutput,
} from '../interfaces/orchestration.js';
import { MISSION_TRANSITIONS, MISSION_TREE_DEFAULTS, generateId } from '../interfaces/orchestration.js';

/** S6: Parse mission row from database to domain object */
function rowToMission(row: Record<string, unknown>): Mission {
  return {
    id: row['id'] as MissionId,
    tenantId: (row['tenant_id'] ?? null) as Mission['tenantId'],
    parentId: (row['parent_id'] ?? null) as MissionId | null,
    agentId: row['agent_id'] as AgentId,
    objective: row['objective'] as string,
    successCriteria: JSON.parse(row['success_criteria'] as string) as string[],
    scopeBoundaries: JSON.parse(row['scope_boundaries'] as string) as string[],
    capabilities: JSON.parse(row['capabilities'] as string) as string[],
    state: row['state'] as MissionState,
    planVersion: row['plan_version'] as number,
    delegationChain: JSON.parse(row['delegation_chain'] as string) as string[],
    constraints: JSON.parse(row['constraints_json'] as string) as MissionConstraints,
    depth: row['depth'] as number,
    compacted: (row['compacted'] as number) === 1,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    completedAt: (row['completed_at'] ?? null) as string | null,
  };
}

/**
 * S6: Create the mission store module.
 * Factory function returns frozen object per C-07.
 */
export function createMissionStore(): MissionStore {

  /** S15: Create a new mission with full validation */
  function create(
    deps: OrchestrationDeps,
    ctx: OperationContext,
    input: ProposeMissionInput,
  ): Result<ProposeMissionOutput> {
    const now = deps.time.nowISO();
    const missionId = generateId() as MissionId;

    const maxTasks = input.constraints.maxTasks ?? MISSION_TREE_DEFAULTS.maxTasks;
    const maxDepth = input.constraints.maxDepth ?? MISSION_TREE_DEFAULTS.maxDepth;
    const maxChildren = input.constraints.maxChildren ?? MISSION_TREE_DEFAULTS.maxChildren;
    const budgetDecayFactor = input.constraints.budgetDecayFactor ?? MISSION_TREE_DEFAULTS.budgetDecayFactor;

    let depth = 0;
    let delegationChain: string[] = [];
    let effectiveBudget = input.constraints.budget;
    let effectiveCapabilities = [...input.capabilities];

    // CF-026/DEV-003: Validate agentId is non-empty (S15: "assignedAgentId: must exist")
    if (!input.agentId || (input.agentId as string).trim().length === 0) {
      return { ok: false, error: { code: 'AGENT_NOT_FOUND', message: 'agentId must be non-empty', spec: 'S15' } };
    }

    // Child mission validation
    if (input.parentMissionId !== null) {
      const parentResult = get(deps, input.parentMissionId);
      if (!parentResult.ok) {
        // CF-026/DEV-003: Use MISSION_NOT_FOUND for missing parent, not AGENT_NOT_FOUND
        return { ok: false, error: { code: 'MISSION_NOT_FOUND', message: 'Parent mission not found', spec: 'S15' } };
      }
      const parent = parentResult.value;

      // I-20: Depth check
      depth = parent.depth + 1;
      if (depth > maxDepth) {
        return { ok: false, error: { code: 'DEPTH_EXCEEDED', message: `Depth ${depth} exceeds maxDepth ${maxDepth}`, spec: 'I-20' } };
      }

      // I-20: Children count check
      const childCountResult = getChildrenCount(deps, input.parentMissionId);
      if (childCountResult.ok && childCountResult.value >= maxChildren) {
        return { ok: false, error: { code: 'CHILDREN_EXCEEDED', message: `Children count ${childCountResult.value} >= maxChildren ${maxChildren}`, spec: 'I-20' } };
      }

      // I-20: Tree size check (O(1) via core_tree_counts)
      const rootId = getRootMissionId(deps, input.parentMissionId);
      if (rootId.ok) {
        const treeCount = deps.conn.get<{ total_count: number }>(
          'SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?',
          [rootId.value],
        );
        if (!treeCount) {
          // Debt 2: Missing tree count row is data integrity corruption — do not silently skip enforcement
          return { ok: false, error: { code: 'TREE_SIZE_EXCEEDED', message: `Tree count row missing for root mission ${rootId.value} — cannot verify tree size limit`, spec: 'I-20' } };
        }
        if (treeCount.total_count >= MISSION_TREE_DEFAULTS.maxTotalMissions) {
          return { ok: false, error: { code: 'TREE_SIZE_EXCEEDED', message: `Tree size ${treeCount.total_count} >= max ${MISSION_TREE_DEFAULTS.maxTotalMissions}`, spec: 'I-20' } };
        }
      }

      // I-22: Capability subset check
      const parentCaps = new Set(parent.capabilities);
      for (const cap of input.capabilities) {
        if (!parentCaps.has(cap)) {
          return { ok: false, error: { code: 'CAPABILITY_VIOLATION', message: `Capability '${cap}' not in parent capabilities`, spec: 'I-22' } };
        }
      }
      effectiveCapabilities = input.capabilities.filter(c => parentCaps.has(c));

      // S15: Budget decay -- child budget <= parent remaining * decayFactor
      const parentResource = deps.conn.get<{ token_remaining: number }>(
        'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
        [input.parentMissionId],
      );
      if (!parentResource) {
        // Debt 2: Missing resource row means budget enforcement is impossible — do not silently skip
        return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: `Resource record missing for parent mission ${input.parentMissionId} — cannot verify budget decay`, spec: 'S15' } };
      }
      const maxChildBudget = parentResource.token_remaining * budgetDecayFactor;
      if (input.constraints.budget > maxChildBudget) {
        return { ok: false, error: { code: 'BUDGET_EXCEEDED', message: `Requested budget ${input.constraints.budget} exceeds parent remaining ${parentResource.token_remaining} × decayFactor ${budgetDecayFactor} = ${maxChildBudget}`, spec: 'S15' } };
      }
      effectiveBudget = input.constraints.budget;

      // S15: Deadline check — child deadline must not extend beyond parent
      if (new Date(input.constraints.deadline).getTime() > new Date(parent.constraints.deadline).getTime()) {
        return { ok: false, error: { code: 'DEADLINE_EXCEEDED', message: `Child deadline ${input.constraints.deadline} extends beyond parent deadline ${parent.constraints.deadline}`, spec: 'S15' } };
      }

      // FM-19: Delegation chain
      delegationChain = [...parent.delegationChain, parent.agentId as string];

      // FM-19: Cycle detection
      if (delegationChain.includes(input.agentId as string)) {
        return { ok: false, error: { code: 'DELEGATION_CYCLE', message: `Agent ${input.agentId} already in delegation chain: ${delegationChain.join(' -> ')}`, spec: 'FM-19' } };
      }
    }

    const constraints: MissionConstraints = {
      budget: effectiveBudget,
      deadline: input.constraints.deadline,
      maxTasks,
      maxDepth,
      maxChildren,
      budgetDecayFactor,
    };

    // I-03: All mutations in single transaction with audit
    deps.conn.transaction(() => {
      // Insert mission
      deps.conn.run(
        `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective,
         success_criteria, scope_boundaries, capabilities, state, plan_version,
         delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', 0, ?, ?, ?, 0, ?, ?)`,
        [
          missionId,
          ctx.tenantId,
          input.parentMissionId,
          input.agentId,
          input.objective,
          JSON.stringify(input.successCriteria),
          JSON.stringify(input.scopeBoundaries),
          JSON.stringify(effectiveCapabilities),
          JSON.stringify(delegationChain),
          JSON.stringify(constraints),
          depth,
          now,
          now,
        ],
      );

      // I-24: Insert immutable goal anchor
      deps.conn.run(
        `INSERT INTO core_mission_goals (mission_id, objective, success_criteria, scope_boundaries, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          missionId,
          input.objective,
          JSON.stringify(input.successCriteria),
          JSON.stringify(input.scopeBoundaries),
          now,
        ],
      );

      // I-20: Update tree counts
      if (input.parentMissionId === null) {
        // Root mission: create tree count entry
        // FM-10: tenant_id inherited from context
        deps.conn.run(
          'INSERT INTO core_tree_counts (root_mission_id, total_count, tenant_id) VALUES (?, 1, ?)',
          [missionId, ctx.tenantId],
        );
      } else {
        // Child mission: increment root's tree count
        const rootResult = getRootMissionId(deps, input.parentMissionId);
        if (rootResult.ok) {
          deps.conn.run(
            'UPDATE core_tree_counts SET total_count = total_count + 1 WHERE root_mission_id = ?',
            [rootResult.value],
          );
        }
      }

      // S11: Allocate resources
      deps.conn.run(
        `INSERT INTO core_resources (mission_id, tenant_id, token_allocated, token_consumed,
         token_remaining, deadline, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [missionId, ctx.tenantId, effectiveBudget, effectiveBudget, input.constraints.deadline, now],
      );

      // §17, I-78: Deduct child budget from parent remaining.
      // S17 side effects: "Resource row allocated (budget reserved from parent)."
      // I-78 conservation law: sum(child.allocated) <= parent.allocated.
      // S6: "constraints.budget can only decrease (consumption and child allocation)."
      // Pattern mirrors budget_governance.ts:190-195 (SC-8 atomic transfer).
      if (input.parentMissionId !== null) {
        deps.conn.run(
          'UPDATE core_resources SET token_remaining = token_remaining - ?, updated_at = ? WHERE mission_id = ?',
          [effectiveBudget, now, input.parentMissionId],
        );
      }

      // I-03: Audit entry
      deps.audit.append(deps.conn, {
        tenantId: ctx.tenantId,
        actorType: ctx.userId ? 'user' : 'agent',
        actorId: (ctx.userId ?? ctx.agentId ?? 'system') as string,
        operation: 'propose_mission',
        resourceType: 'mission',
        resourceId: missionId,
        detail: { parentMissionId: input.parentMissionId, objective: input.objective },
      });
    });

    return {
      ok: true,
      value: {
        missionId,
        state: 'CREATED',
        allocated: {
          budget: effectiveBudget,
          capabilities: effectiveCapabilities,
        },
      },
    };
  }

  /** S6: Transition mission state with validation against lifecycle */
  function transition(
    deps: OrchestrationDeps,
    missionId: MissionId,
    from: MissionState,
    to: MissionState,
  ): Result<void> {
    const validTargets = MISSION_TRANSITIONS[from];
    if (!validTargets.includes(to)) {
      return { ok: false, error: { code: 'INVALID_TRANSITION', message: `Cannot transition from ${from} to ${to}`, spec: 'S6' } };
    }

    const now = deps.time.nowISO();
    const isTerminal = to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED';

    // Debt 3: Derive tenant_id from mission for audit trail
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    const transitionTenantId = (missionRow?.tenant_id ?? null) as TenantId | null;

    deps.conn.transaction(() => {
      const result = deps.conn.run(
        `UPDATE core_missions SET state = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''} WHERE id = ? AND state = ?`,
        isTerminal ? [to, now, now, missionId, from] : [to, now, missionId, from],
      );

      if (result.changes === 0) {
        throw new Error(`Mission ${missionId} not in state ${from}`);
      }

      deps.audit.append(deps.conn, {
        tenantId: transitionTenantId,
        actorType: 'system',
        actorId: 'orchestrator',
        operation: 'mission_transition',
        resourceType: 'mission',
        resourceId: missionId,
        detail: { from, to },
      });
    });

    return { ok: true, value: undefined };
  }

  /** S6: Get mission by id */
  function get(deps: OrchestrationDeps, missionId: MissionId): Result<Mission> {
    const row = deps.conn.get<Record<string, unknown>>(
      'SELECT * FROM core_missions WHERE id = ?',
      [missionId],
    );
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Mission ${missionId} not found`, spec: 'S6' } };
    }
    return { ok: true, value: rowToMission(row) };
  }

  /** S6: Get children of a mission */
  function getChildren(deps: OrchestrationDeps, missionId: MissionId): Result<Mission[]> {
    const rows = deps.conn.query<Record<string, unknown>>(
      'SELECT * FROM core_missions WHERE parent_id = ?',
      [missionId],
    );
    return { ok: true, value: rows.map(rowToMission) };
  }

  /** I-20: Get depth of a mission */
  function getDepth(deps: OrchestrationDeps, missionId: MissionId): Result<number> {
    const row = deps.conn.get<{ depth: number }>(
      'SELECT depth FROM core_missions WHERE id = ?',
      [missionId],
    );
    if (!row) {
      return { ok: false, error: { code: 'NOT_FOUND', message: `Mission ${missionId} not found`, spec: 'I-20' } };
    }
    return { ok: true, value: row.depth };
  }

  /** I-20: Get children count */
  function getChildrenCount(deps: OrchestrationDeps, missionId: MissionId): Result<number> {
    const row = deps.conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions WHERE parent_id = ?',
      [missionId],
    );
    return { ok: true, value: row?.cnt ?? 0 };
  }

  /** I-20: Get root mission id by walking up the parent chain */
  function getRootMissionId(deps: OrchestrationDeps, missionId: MissionId): Result<MissionId> {
    let currentId = missionId;
    // P0-A Critical #11/#14: Cycle detection via visited set.
    // The bounded loop (maxDepth+1) is retained as a safety net, but a Set<string>
    // catches cycles that the depth bound alone would silently produce wrong values for.
    const visited = new Set<string>();
    for (let i = 0; i < MISSION_TREE_DEFAULTS.maxDepth + 1; i++) {
      if (visited.has(currentId as string)) {
        return { ok: false, error: { code: 'CYCLE_DETECTED', message: `Cycle detected in mission hierarchy at ${currentId}`, spec: 'I-20' } };
      }
      visited.add(currentId as string);
      const row = deps.conn.get<{ parent_id: string | null }>(
        'SELECT parent_id FROM core_missions WHERE id = ?',
        [currentId],
      );
      if (!row) {
        return { ok: false, error: { code: 'NOT_FOUND', message: `Mission ${currentId} not found`, spec: 'I-20' } };
      }
      if (row.parent_id === null) {
        return { ok: true, value: currentId };
      }
      currentId = row.parent_id as MissionId;
    }
    // If we exhaust the loop without finding root and without cycle, something is deeply wrong.
    // The visited set would have caught any cycle, so this is a depth overflow.
    return { ok: false, error: { code: 'CYCLE_DETECTED', message: `Mission hierarchy exceeded max traversal depth at ${currentId}`, spec: 'I-20' } };
  }

  return Object.freeze({
    create,
    transition,
    get,
    getChildren,
    getDepth,
    getChildrenCount,
    getRootMissionId,
  });
}
