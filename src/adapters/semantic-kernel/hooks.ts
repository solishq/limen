/**
 * Semantic Kernel Hook Translation
 *
 * Translates between SK native kernel function invocations/events and canonical Limen types.
 * SK patterns: Plugin.Function calls, Planner steps, SK Memory operations.
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
import type { SKHookEvent } from './types.js';

/**
 * Known SK tool/function names that map to Limen operations.
 * SK uses Plugin.Function naming; these are the Limen-bridged functions.
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
  // SK-style Plugin.Function naming
  'LimenPlugin.Remember', 'LimenPlugin.Recall', 'LimenPlugin.Forget',
  'LimenPlugin.Branch', 'LimenPlugin.Merge', 'LimenPlugin.Connect',
  'LimenPlugin.GetBelief',
];

/**
 * Translate a SK kernel function call into canonical LimenOperations.
 * Supports both flat names and Plugin.Function naming convention.
 * Returns null for unknown tools.
 */
export function translateToolToOperations(toolCall: AgentToolCall): LimenOperation[] | null {
  const { toolName, toolArgs: args } = toolCall;

  // Normalize SK Plugin.Function to flat name
  const normalizedName = normalizeSkToolName(toolName);

  switch (normalizedName) {
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
      return null;
  }
}

/**
 * Normalize SK Plugin.Function naming to flat tool name.
 * e.g., "LimenPlugin.Remember" -> "remember"
 */
function normalizeSkToolName(name: string): string {
  const skMapping: Record<string, string> = {
    'LimenPlugin.Remember': 'remember',
    'LimenPlugin.Recall': 'recall',
    'LimenPlugin.Forget': 'forget',
    'LimenPlugin.Branch': 'create_branch',
    'LimenPlugin.Merge': 'merge_branches',
    'LimenPlugin.Connect': 'relate',
    'LimenPlugin.GetBelief': 'get_belief',
  };
  return skMapping[name] ?? name;
}

/**
 * Map SK native event to canonical Limen AgentEventPayload.
 */
export function mapNativeEvent(
  nativeEvent: SKHookEvent,
  adapterId: AdapterId,
  agentId: AgentId,
  sessionId: SessionId | null,
): AgentEventPayload | null {
  if (!nativeEvent || !nativeEvent.type) return null;

  let eventType: string | null = null;
  let data: Readonly<Record<string, unknown>> = {};

  switch (nativeEvent.type) {
    case 'function_invoked':
      eventType = 'hook:after_tool_call';
      data = { pluginName: nativeEvent.pluginName, functionName: nativeEvent.functionName, args: nativeEvent.args, result: nativeEvent.result ?? null };
      break;
    case 'function_invoking':
      eventType = 'hook:before_tool_call';
      data = { pluginName: nativeEvent.pluginName, functionName: nativeEvent.functionName, args: nativeEvent.args };
      break;
    case 'planner_step':
      eventType = 'sk:planner_step';
      data = { stepIndex: nativeEvent.stepIndex, plannerType: nativeEvent.plannerType, functionName: nativeEvent.functionName };
      break;
    case 'planner_complete':
      eventType = 'sk:planner_complete';
      data = { plannerType: nativeEvent.plannerType, totalSteps: nativeEvent.totalSteps, success: nativeEvent.success };
      break;
    case 'memory_save':
      eventType = 'sk:memory_save';
      data = { collection: nativeEvent.collection, key: nativeEvent.key, content: nativeEvent.content };
      break;
    case 'memory_recall':
      eventType = 'sk:memory_recall';
      data = { collection: nativeEvent.collection, query: nativeEvent.query, limit: nativeEvent.limit };
      break;
    case 'plugin_loaded':
      eventType = 'sk:plugin_loaded';
      data = { pluginName: nativeEvent.pluginName, functions: nativeEvent.functions };
      break;
    case 'prompt_rendered':
      eventType = 'sk:prompt_rendered';
      data = { templateName: nativeEvent.templateName, renderedLength: nativeEvent.renderedLength };
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
 * Map Limen AgentEventPayload back to SK native event.
 */
export function mapLimenEvent(limenEvent: AgentEventPayload): SKHookEvent | null {
  if (!limenEvent) return null;

  if (limenEvent.event === 'hook:after_tool_call') {
    return {
      type: 'function_invoked',
      pluginName: (limenEvent.data.pluginName as string) || '',
      functionName: (limenEvent.data.functionName as string) || (limenEvent.data.toolName as string) || '',
      args: (limenEvent.data.args as Readonly<Record<string, unknown>>) || {},
      result: limenEvent.data.result ?? undefined,
    };
  }

  if (limenEvent.event === 'hook:before_tool_call') {
    return {
      type: 'function_invoking',
      pluginName: (limenEvent.data.pluginName as string) || '',
      functionName: (limenEvent.data.functionName as string) || (limenEvent.data.toolName as string) || '',
      args: (limenEvent.data.args as Readonly<Record<string, unknown>>) || {},
    };
  }

  if (limenEvent.event === 'sk:planner_complete') {
    return {
      type: 'planner_complete',
      plannerType: (limenEvent.data.plannerType as string) || '',
      totalSteps: (limenEvent.data.totalSteps as number) || 0,
      success: (limenEvent.data.success as boolean) ?? false,
    };
  }

  return null;
}
