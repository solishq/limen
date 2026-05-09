/**
 * LlamaIndex Hook Translation
 *
 * Translates between LlamaIndex native operations/events and canonical Limen types.
 * LlamaIndex patterns: Query engine queries -> governed recall, data ingestion -> governed remember,
 * index management, retriever integration.
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
import type { LlamaIndexHookEvent } from './types.js';

/**
 * Known LlamaIndex tool names that map to Limen operations.
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
  // LlamaIndex-style tool names
  'query', 'ingest', 'retrieve',
  'index_insert', 'index_delete', 'index_refresh',
];

/**
 * Translate a LlamaIndex tool call into canonical LimenOperations.
 * Returns null for unknown tools.
 *
 * LlamaIndex-specific mappings:
 * - query/retrieve -> recall (query engine integration)
 * - ingest/index_insert -> remember (data connector integration)
 * - index_delete -> forget (index management)
 * - index_refresh -> remember + forget sequence
 */
export function translateToolToOperations(toolCall: AgentToolCall): LimenOperation[] | null {
  const { toolName, toolArgs: args } = toolCall;

  switch (toolName) {
    // Standard Limen tools
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

    // LlamaIndex-specific: query -> governed recall
    case 'query':
    case 'retrieve': {
      return [{
        type: 'recall',
        query: {
          text: (args.query as string) || (args.text as string) || '',
          subject: args.subject as string | undefined,
          predicate: args.predicate as string | undefined,
        },
        options: {
          limit: (args.topK as number) || (args.limit as number) || undefined,
          searchMode: (args.searchMode as 'text' | 'semantic' | 'hybrid') || 'semantic',
        },
      }];
    }

    // LlamaIndex-specific: ingest/index_insert -> governed remember
    case 'ingest':
    case 'index_insert': {
      const content = typeof args.content === 'string'
        ? args.content
        : typeof args.document === 'string'
          ? args.document
          : (args.content ?? args.document) as StructuredContent;
      return [{ type: 'remember', content: content as string | StructuredContent, options: args.options as AgentMemoryOptions | undefined }];
    }

    // LlamaIndex-specific: index_delete -> governed forget
    case 'index_delete': {
      return [{
        type: 'forget',
        entryId: (args.nodeId || args.entryId) as string & { readonly __brand: 'ClaimId' },
        reason: (args.reason as string) || 'Index node deletion',
      }];
    }

    // LlamaIndex-specific: index_refresh -> remember new + forget stale
    case 'index_refresh': {
      const ops: LimenOperation[] = [];
      const toAdd = args.documentsToAdd as readonly string[] | undefined;
      const toDelete = args.nodeIdsToDelete as readonly string[] | undefined;

      if (toAdd) {
        for (const doc of toAdd) {
          ops.push({ type: 'remember', content: doc });
        }
      }
      if (toDelete) {
        for (const nodeId of toDelete) {
          ops.push({
            type: 'forget',
            entryId: nodeId as string & { readonly __brand: 'ClaimId' },
            reason: 'Index refresh: stale node removal',
          });
        }
      }
      return ops.length > 0 ? ops : [];
    }

    default:
      return null;
  }
}

/**
 * Map LlamaIndex native event to canonical Limen AgentEventPayload.
 */
export function mapNativeEvent(
  nativeEvent: LlamaIndexHookEvent,
  adapterId: AdapterId,
  agentId: AgentId,
  sessionId: SessionId | null,
): AgentEventPayload | null {
  if (!nativeEvent || !nativeEvent.type) return null;

  let eventType: string | null = null;
  let data: Readonly<Record<string, unknown>> = {};

  switch (nativeEvent.type) {
    case 'query_start':
      eventType = 'llamaindex:query_start';
      data = { query: nativeEvent.query, engineType: nativeEvent.engineType };
      break;
    case 'query_end':
      eventType = 'llamaindex:query_end';
      data = { query: nativeEvent.query, responseLength: nativeEvent.responseLength, nodesUsed: nativeEvent.nodesUsed };
      break;
    case 'retrieval_start':
      eventType = 'llamaindex:retrieval_start';
      data = { query: nativeEvent.query, topK: nativeEvent.topK };
      break;
    case 'retrieval_end':
      eventType = 'llamaindex:retrieval_end';
      data = { query: nativeEvent.query, nodesRetrieved: nativeEvent.nodesRetrieved, scoreRange: nativeEvent.scoreRange };
      break;
    case 'ingestion_start':
      eventType = 'llamaindex:ingestion_start';
      data = { documentCount: nativeEvent.documentCount, connectorType: nativeEvent.connectorType };
      break;
    case 'ingestion_end':
      eventType = 'llamaindex:ingestion_end';
      data = { documentCount: nativeEvent.documentCount, nodesCreated: nativeEvent.nodesCreated, connectorType: nativeEvent.connectorType };
      break;
    case 'index_refresh':
      eventType = 'llamaindex:index_refresh';
      data = { indexId: nativeEvent.indexId, nodesAdded: nativeEvent.nodesAdded, nodesDeleted: nativeEvent.nodesDeleted };
      break;
    case 'embedding_generated':
      eventType = 'llamaindex:embedding_generated';
      data = { dimensions: nativeEvent.dimensions, model: nativeEvent.model };
      break;
    case 'tool_called':
      eventType = 'hook:after_tool_call';
      data = { toolName: nativeEvent.toolName, args: nativeEvent.args, result: nativeEvent.result ?? null };
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
 * Map Limen AgentEventPayload back to LlamaIndex native event.
 */
export function mapLimenEvent(limenEvent: AgentEventPayload): LlamaIndexHookEvent | null {
  if (!limenEvent) return null;

  if (limenEvent.event === 'hook:after_tool_call') {
    return {
      type: 'tool_called',
      toolName: (limenEvent.data.toolName as string) || '',
      args: (limenEvent.data.args as Readonly<Record<string, unknown>>) || {},
      result: limenEvent.data.result ?? undefined,
    };
  }

  if (limenEvent.event === 'llamaindex:query_end') {
    return {
      type: 'query_end',
      query: (limenEvent.data.query as string) || '',
      responseLength: (limenEvent.data.responseLength as number) || 0,
      nodesUsed: (limenEvent.data.nodesUsed as number) || 0,
    };
  }

  if (limenEvent.event === 'llamaindex:retrieval_end') {
    return {
      type: 'retrieval_end',
      query: (limenEvent.data.query as string) || '',
      nodesRetrieved: (limenEvent.data.nodesRetrieved as number) || 0,
      scoreRange: (limenEvent.data.scoreRange as { min: number; max: number }) || { min: 0, max: 0 },
    };
  }

  return null;
}
