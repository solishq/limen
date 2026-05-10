// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * AutoGen Hook Translation
 *
 * Translates between AutoGen native tool calls/events and canonical Limen types.
 * AutoGen patterns: function_call via ConversableAgent, group_chat tool routing.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentToolCall,
  LimenOperation,
  AgentEventPayload,
  AdapterId,
  AgentId,
  SessionId,
  EventId,
  StructuredContent,
  AgentMemoryOptions,
} from '../shared/types.js';
import type { AutoGenHookEvent } from './types.js';

/**
 * Known AutoGen tool names that map to Limen operations.
 * AutoGen uses function registration; these are the Limen-bridged functions.
 */
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
 * Translate an AutoGen tool call (function_call) into canonical LimenOperations.
 * Returns null for unknown tools (caller returns UNKNOWN_TOOL error).
 */
export function translateToolToOperations(toolCall: AgentToolCall): LimenOperation[] | null {
  const { toolName, toolArgs: args } = toolCall;

  switch (toolName) {
    case 'limen_remember':
    case 'remember': {
      const content = typeof args.content === 'string'
        ? args.content
        : args.content as StructuredContent;
      const rememberOp: LimenOperation = args.options
        ? { type: 'remember', content, options: args.options as AgentMemoryOptions }
        : { type: 'remember', content };
      return [rememberOp];
    }

    case 'limen_recall':
    case 'recall':
    case 'search_memory': {
      const query: import('../shared/types.js').AgentRecallQuery = {
        ...(typeof args.query === 'string' ? { text: args.query } : args.text != null ? { text: args.text as string } : {}),
        ...(args.subject != null ? { subject: args.subject as string } : {}),
        ...(args.predicate != null ? { predicate: args.predicate as string } : {}),
      };
      const recallOp: LimenOperation = args.options
        ? { type: 'recall', query, options: args.options as import('../shared/types.js').AgentRecallOptions }
        : { type: 'recall', query };
      return [recallOp];
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
      }];
    }

    case 'limen_check_permission':
    case 'check_permission': {
      return [{
        type: 'check_permission',
        action: args.action as import('../shared/types.js').ComputerAction,
        context: args.context as import('../shared/types.js').GovernanceContext,
      }];
    }

    default:
      return null;
  }
}

/**
 * Map AutoGen native event to canonical Limen AgentEventPayload.
 * Returns null when no mapping exists.
 */
export function mapNativeEvent(
  nativeEvent: AutoGenHookEvent,
  adapterId: AdapterId,
  agentId: AgentId,
  sessionId: SessionId | null,
): AgentEventPayload | null {
  if (!nativeEvent || !nativeEvent.type) return null;

  let eventType: string | null = null;
  let data: Readonly<Record<string, unknown>> = {};

  switch (nativeEvent.type) {
    case 'message_sent':
      eventType = 'autogen:message_sent';
      data = { from: nativeEvent.from, to: nativeEvent.to, content: nativeEvent.content };
      break;
    case 'message_received':
      eventType = 'autogen:message_received';
      data = { from: nativeEvent.from, to: nativeEvent.to, content: nativeEvent.content };
      break;
    case 'tool_called':
      eventType = 'hook:after_tool_call';
      data = { toolName: nativeEvent.toolName, args: nativeEvent.args, result: nativeEvent.result ?? null };
      break;
    case 'code_executed':
      eventType = 'autogen:code_executed';
      data = { code: nativeEvent.code, exitCode: nativeEvent.exitCode, output: nativeEvent.output };
      break;
    case 'group_chat_turn':
      eventType = 'autogen:group_chat_turn';
      data = { speaker: nativeEvent.speaker, groupName: nativeEvent.groupName };
      break;
    case 'human_input_requested':
      eventType = 'autogen:human_input_requested';
      data = { prompt: nativeEvent.prompt };
      break;
    case 'termination':
      eventType = 'autogen:termination';
      data = { reason: nativeEvent.reason };
      break;
    default:
      return null;
  }

  return {
    eventId: randomUUID() as EventId,
    event: eventType,
    timestamp: new Date().toISOString(),
    adapterId,
    sessionId,
    agentId,
    data,
  };
}

/**
 * Map Limen AgentEventPayload back to AutoGen native event.
 * Returns null when no mapping exists.
 */
export function mapLimenEvent(limenEvent: AgentEventPayload): AutoGenHookEvent | null {
  if (!limenEvent) return null;

  if (limenEvent.event === 'hook:after_tool_call') {
    return {
      type: 'tool_called',
      toolName: (limenEvent.data.toolName as string) || '',
      args: (limenEvent.data.args as Readonly<Record<string, unknown>>) || {},
      result: limenEvent.data.result ?? undefined,
    };
  }

  if (limenEvent.event === 'autogen:message_sent') {
    return {
      type: 'message_sent',
      from: (limenEvent.data.from as string) || '',
      to: (limenEvent.data.to as string) || '',
      content: (limenEvent.data.content as string) || '',
    };
  }

  if (limenEvent.event === 'autogen:termination') {
    return {
      type: 'termination',
      reason: (limenEvent.data.reason as string) || '',
    };
  }

  return null;
}
