// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * CrewAI Adapter Types
 *
 * CrewAI-specific types are defined here.
 * All shared types are re-exported from ../shared/types.js for backward compatibility.
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md v1.0.0
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1
 */

// Re-export all shared types for backward compatibility
export * from '../shared/types.js';

// Import types needed by CrewAI-local definitions
import type {
  AgentToolCall,
  AgentMemoryOptions,
  TaskId,
  SessionId,
  ActionDigest,
  AdapterErrorCode,
} from '../shared/types.js';

// ─────────────────────────────────────────────────
// CrewAI Adapter Local Types (CREWAI_ADAPTER_CONTRACT.md)
// ─────────────────────────────────────────────────

/** CREWAI_ADAPTER_CONTRACT.md S1.5 -- CrewAI hook context shape */
export interface CrewAIToolCallHookContext {
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
  readonly tool?: unknown;
  readonly agent?: unknown;
  readonly task?: unknown;
  readonly crew?: unknown;
  readonly tool_result?: string | null;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.2.1 -- CrewAI tool call (extends AgentToolCall) */
export interface CrewAIToolCall extends AgentToolCall {
  readonly agentFramework: 'crew_ai';
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly context: CrewAIToolContext;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.2.1 -- CrewAI tool context */
export interface CrewAIToolContext {
  readonly crewId: string;
  readonly agentRole: string;
  readonly taskId: TaskId | null;
  readonly delegationDepth: number;
  readonly processType: 'sequential' | 'hierarchical';
  readonly hookPhase: 'before_tool_call' | 'after_tool_call';
  readonly rawHookContextDigest: ActionDigest;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.2.1 -- CrewAI hook event */
export type CrewAIHookEvent =
  | { readonly type: 'before_tool_call'; readonly context: CrewAIToolCallHookContext }
  | { readonly type: 'after_tool_call'; readonly context: CrewAIToolCallHookContext };

/** CREWAI_ADAPTER_CONTRACT.md S3.2.1 -- CrewAI session start */
export interface CrewAISessionStart {
  readonly crewId: string;
  readonly agentRole: string;
  readonly processType: 'sequential' | 'hierarchical';
  readonly taskId?: TaskId;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.2.1 -- CrewAI session end */
export interface CrewAISessionEnd {
  readonly sessionId: SessionId;
  readonly crewId: string;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.3 -- CrewContext */
export interface CrewContext {
  readonly crewId: string;
  readonly agentRole: string;
  readonly taskId: TaskId | null;
  readonly delegationDepth: number;
}

/** CREWAI_ADAPTER_CONTRACT.md S3.3 -- RememberOptions (extends AgentMemoryOptions) */
export interface RememberOptions extends AgentMemoryOptions {
  readonly crewContext?: CrewContext;
}

/** CREWAI_ADAPTER_CONTRACT.md S8.2 -- CrewAI audit details */
export interface CrewAIAuditDetails {
  readonly operationType:
    | 'remember'
    | 'recall'
    | 'createBranch'
    | 'mergeBranches'
    | 'resolveConflict'
    | 'translateToolCall'
    | 'translateActionToGovernance'
    | 'onAgentSessionStart'
    | 'onAgentSessionEnd'
    | 'initialize'
    | 'shutdown'
    | 'healthCheck';
  readonly crewId: string;
  readonly agentRole: string;
  readonly delegationDepth: number;
  readonly tokenCost: number;
  readonly governanceState: 'allowed' | 'refused' | 'escalated' | 'sandboxed' | 'not_applicable';
  readonly beliefIds?: readonly string[];
  readonly branchIds?: readonly string[];
  readonly toolName?: string;
  readonly errorCode?: AdapterErrorCode;
  readonly duration: number;
}
