/**
 * CrewAI Tool Hook Translation
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md S1.5, S3.2.1, S5
 * Implements: Translation between CrewAI native hook payloads and canonical Limen types.
 *
 * Claims covered: 1.9, 2.8, 3.8
 */

import { randomUUID } from 'node:crypto';
import type {
  CrewAIToolCallHookContext,
  CrewAIToolCall,
  CrewAIToolContext,
  CrewAIHookEvent,
  AgentEventPayload,
  AgentToolCall,
  LimenOperation,
  ActionDigest,
  AdapterId,
  AgentId,
  SessionId,
  TaskId,
  EventId,
  StructuredContent,
  AgentMemoryOptions,
} from './types.js';

/**
 * CREWAI_ADAPTER_CONTRACT.md S1.5, Claim 2.8 --
 * Normalize CrewAI hook context into a CrewAIToolCall.
 *
 * tool_name is the only authoritative tool identifier.
 * Role names, task descriptions, and backstories never imply capabilities.
 */
export function normalizeHookContext(
  hookContext: CrewAIToolCallHookContext,
  crewId: string,
  agentRole: string,
  taskId: TaskId | null,
  delegationDepth: number,
  processType: 'sequential' | 'hierarchical',
  hookPhase: 'before_tool_call' | 'after_tool_call',
  callId: string,
): CrewAIToolCall {
  const digest: ActionDigest = {
    action: hookContext.tool_name,
    domain: 'execution',
    timestamp: new Date().toISOString(),
    sessionId: '' as SessionId, // Will be overridden by caller
    outcome: 'allowed', // Tentative; governance decides final outcome
  };

  const toolContext: CrewAIToolContext = {
    crewId,
    agentRole,
    taskId,
    delegationDepth,
    processType,
    hookPhase,
    rawHookContextDigest: digest,
  };

  return {
    // AgentToolCall canonical fields
    toolName: hookContext.tool_name,
    toolArgs: hookContext.tool_input,
    callId,
    agentFramework: 'crew_ai',
    rawPayload: hookContext,
    // CrewAI specializations (Invariant: tool === toolName, args === toolArgs)
    tool: hookContext.tool_name,
    args: hookContext.tool_input,
    context: toolContext,
  };
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.2.1 --
 * Validate that a CrewAI hook context has the required fields.
 * Returns null if valid, error detail string if invalid.
 *
 * Claim 2.8: adapter MUST NOT infer tool from agent.role, task.description,
 * or arbitrary { tool, args } fields.
 */
export function validateHookContext(
  payload: unknown,
): { valid: true; context: CrewAIToolCallHookContext } | { valid: false; detail: string } {
  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, detail: 'Hook payload must be a non-null object' };
  }

  const obj = payload as Record<string, unknown>;

  // tool_name is required and must be a string
  if (typeof obj.tool_name !== 'string' || obj.tool_name.length === 0) {
    return { valid: false, detail: 'Missing or empty tool_name in hook context' };
  }

  // tool_input is required and must be an object
  if (typeof obj.tool_input !== 'object' || obj.tool_input === null) {
    return { valid: false, detail: 'Missing or invalid tool_input in hook context' };
  }

  return {
    valid: true,
    context: obj as unknown as CrewAIToolCallHookContext,
  };
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S5 -- Translate a CrewAI tool call into LimenOperations.
 *
 * Claim 1.9: known tools -> LimenOperation[]; unknown tools -> UNKNOWN_TOOL.
 * Returns null if tool is unknown (caller handles UNKNOWN_TOOL error).
 */
export function translateToolToOperations(
  toolCall: CrewAIToolCall,
): LimenOperation[] | null {
  const { tool, args } = toolCall;

  // Map CrewAI tool names to canonical Limen operations
  switch (tool) {
    case 'limen_remember':
    case 'remember': {
      const content = typeof args.content === 'string'
        ? args.content
        : args.content as StructuredContent;
      return [{ type: 'remember', content, options: args.options as AgentMemoryOptions | undefined }];
    }

    case 'limen_recall':
    case 'recall':
    case 'search_memory': {
      return [{
        type: 'recall',
        query: {
          text: typeof args.query === 'string' ? args.query : (args.text as string | undefined),
          subject: args.subject as string | undefined,
          predicate: args.predicate as string | undefined,
        },
        options: args.options as AgentMemoryOptions | undefined,
      }];
    }

    case 'limen_forget':
    case 'forget': {
      return [{
        type: 'forget',
        entryId: args.entryId as string & { readonly __brand: 'ClaimId' },
        reason: (args.reason as string) || 'Agent requested forget',
      }];
    }

    case 'limen_connect':
    case 'connect':
    case 'relate': {
      return [{
        type: 'relate',
        fromId: args.fromId as string & { readonly __brand: 'ClaimId' },
        toId: args.toId as string & { readonly __brand: 'ClaimId' },
        relationType: (args.relationType as 'supports' | 'contradicts' | 'supersedes' | 'derived_from') || 'supports',
      }];
    }

    case 'limen_branch':
    case 'create_branch': {
      return [{
        type: 'create_branch',
        baseBeliefId: args.baseBeliefId as string & { readonly __brand: 'ClaimId' },
        description: (args.description as string) || '',
      }];
    }

    case 'limen_merge':
    case 'merge_branches': {
      return [{
        type: 'merge_branches',
        branchIds: args.branchIds as readonly (string & { readonly __brand: 'AgentBranchId' })[],
        strategy: (args.strategy as 'highest_confidence' | 'most_recent' | 'manual' | 'union') || 'highest_confidence',
      }];
    }

    case 'limen_get_belief':
    case 'get_belief': {
      return [{
        type: 'get_belief',
        beliefId: args.beliefId as string & { readonly __brand: 'ClaimId' },
      }];
    }

    case 'limen_discard_branch':
    case 'discard_branch': {
      return [{
        type: 'discard_branch',
        branchId: args.branchId as string & { readonly __brand: 'AgentBranchId' },
        reason: (args.reason as string) || 'Agent requested discard',
      }];
    }

    case 'limen_check_permission':
    case 'check_permission': {
      return [{
        type: 'check_permission',
        permission: args.permission as string,
        resource: (args.resource as string) || null,
      }];
    }

    default:
      return null; // Unknown tool -- caller returns UNKNOWN_TOOL
  }
}

/** Known tools for UNKNOWN_TOOL error response */
export const KNOWN_TOOLS: readonly string[] = [
  'limen_remember', 'remember',
  'limen_recall', 'recall', 'search_memory',
  'limen_forget', 'forget',
  'limen_connect', 'connect', 'relate',
  'limen_branch', 'create_branch',
  'limen_merge', 'merge_branches',
  'limen_get_belief', 'get_belief',
  'limen_discard_branch', 'discard_branch',
  'limen_check_permission', 'check_permission',
];

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 3.8 --
 * mapNativeEvent: Pure data transformation, no governance, no audit, no side effects.
 * Returns null when no mapping exists.
 */
export function mapNativeEvent(
  nativeEvent: CrewAIHookEvent,
  adapterId: AdapterId,
  agentId: AgentId,
  sessionId: SessionId | null,
): AgentEventPayload | null {
  if (!nativeEvent || !nativeEvent.type || !nativeEvent.context) {
    return null;
  }

  const eventType = nativeEvent.type === 'before_tool_call'
    ? 'hook:before_tool_call'
    : nativeEvent.type === 'after_tool_call'
      ? 'hook:after_tool_call'
      : null;

  if (!eventType) return null;

  return {
    eventId: randomUUID() as EventId,
    event: eventType,
    timestamp: new Date().toISOString(),
    adapterId,
    sessionId,
    agentId,
    data: {
      toolName: nativeEvent.context.tool_name,
      toolInput: nativeEvent.context.tool_input,
      toolResult: nativeEvent.context.tool_result ?? null,
      hookType: nativeEvent.type,
    },
  };
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S3.1, Claim 3.8 --
 * mapLimenEvent: Pure data transformation, no governance, no audit, no side effects.
 * Returns null when no mapping exists.
 */
export function mapLimenEvent(
  limenEvent: AgentEventPayload,
): CrewAIHookEvent | null {
  if (!limenEvent) return null;

  if (limenEvent.event === 'hook:before_tool_call') {
    const data = limenEvent.data;
    return {
      type: 'before_tool_call',
      context: {
        tool_name: (data.toolName as string) || '',
        tool_input: (data.toolInput as Record<string, unknown>) || {},
        tool_result: (data.toolResult as string | null) ?? null,
      },
    };
  }

  if (limenEvent.event === 'hook:after_tool_call') {
    const data = limenEvent.data;
    return {
      type: 'after_tool_call',
      context: {
        tool_name: (data.toolName as string) || '',
        tool_input: (data.toolInput as Record<string, unknown>) || {},
        tool_result: (data.toolResult as string | null) ?? null,
      },
    };
  }

  return null;
}
