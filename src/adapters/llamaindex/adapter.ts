/**
 * LimenLlamaIndexAdapter -- LlamaIndex Framework Adapter for Limen Governance Substrate
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'llama_index')
 *
 * LlamaIndex-specific capabilities:
 * - Query engine integration (queries -> governed recall operations)
 * - Data connector hooks (ingestion -> governed remember operations)
 * - Index management (create/update/delete with governance)
 * - Retriever integration
 * - LlamaIndex-native event translation
 *
 * Extends BaseGovernedAdapter with LlamaIndex-specific hook translation and type mapping.
 */

import { BaseGovernedAdapter } from '../shared/base-adapter.js';
import { serdeError } from '../crewai/errors.js';
import type { CrewAIAdapterError } from '../crewai/errors.js';
import type {
  AdapterId,
  AgentId,
  AgentCapability,
  AgentFramework,
  AgentToolCall,
  AgentEventPayload,
  LimenOperation,
  SessionId,
} from '../shared/types.js';
import type { LlamaIndexAdapterConfig, LlamaIndexSessionStart, LlamaIndexSessionEnd } from './types.js';
import type { LlamaIndexHookEvent } from './types.js';
import {
  translateToolToOperations,
  mapNativeEvent,
  mapLimenEvent,
  KNOWN_TOOLS,
} from './hooks.js';

/**
 * AGENT_ADAPTER_ARCHITECTURE.md S7 -- LlamaIndex adapter.
 *
 * Translates LlamaIndex query engine calls, data ingestion, index operations,
 * and session boundaries into canonical Limen types.
 *
 * readonly #governed = true (inherited from BaseGovernedAdapter)
 */
export class LimenLlamaIndexAdapter extends BaseGovernedAdapter<
  LlamaIndexAdapterConfig,
  LlamaIndexSessionStart,
  LlamaIndexSessionEnd
> {
  /** SHARED_TYPES.md S21 -- Framework: llama_index */
  get agentFramework(): AgentFramework {
    return 'llama_index';
  }

  constructor(adapterId: AdapterId, capabilities: ReadonlySet<AgentCapability>) {
    super(adapterId, capabilities);
  }

  // ── Abstract implementations ──

  /** @override Build working memory namespace for LlamaIndex session */
  protected getWorkingMemoryNamespace(nativeSession: LlamaIndexSessionStart): string {
    return `llamaindex/${nativeSession.indexId}/${nativeSession.indexType}`;
  }

  /** @override Build LlamaIndex-specific session metadata */
  protected getSessionMetadata(nativeSession: LlamaIndexSessionStart): Readonly<Record<string, unknown>> {
    return {
      indexId: nativeSession.indexId,
      indexType: nativeSession.indexType,
      connectors: nativeSession.connectors,
      queryEngineType: nativeSession.queryEngineType ?? null,
      ...nativeSession.metadata,
    };
  }

  /** @override Translate LlamaIndex tool call to LimenOperations */
  protected translateFrameworkToolCall(toolCall: AgentToolCall): LimenOperation[] | null {
    return translateToolToOperations(toolCall);
  }

  /** @override Map LlamaIndex native event to Limen event */
  protected mapNativeEventImpl(
    nativeEvent: unknown,
    adapterId: AdapterId,
    agentId: AgentId,
    sessionId: SessionId | null,
  ): AgentEventPayload | null {
    return mapNativeEvent(nativeEvent as LlamaIndexHookEvent, adapterId, agentId, sessionId);
  }

  /** @override Map Limen event back to LlamaIndex native event */
  protected mapLimenEventImpl(limenEvent: AgentEventPayload): unknown | null {
    return mapLimenEvent(limenEvent);
  }

  /** @override Map native action type to canonical ComputerActionType */
  protected mapNativeTypeToComputerActionType(nativeType: string): string {
    const map: Record<string, string> = {
      'query': 'memory:read',
      'retrieve': 'memory:read',
      'ingest': 'memory:write',
      'index_insert': 'memory:write',
      'index_delete': 'memory:delete',
      'index_refresh': 'memory:write',
      'embedding': 'code:execute',
      'file_read': 'file:read',
      'file_write': 'file:write',
      'api_call': 'network:request',
    };
    return map[nativeType] || `native:${nativeType}`;
  }

  /** @override Native action type to required capability mapping */
  protected getNativeTypeCapabilityMap(): Readonly<Record<string, AgentCapability>> {
    return {
      'query': 'memory_read',
      'retrieve': 'memory_read',
      'ingest': 'memory_write',
      'index_insert': 'memory_write',
      'index_delete': 'memory_write',
      'index_refresh': 'memory_write',
      'embedding': 'code_execution',
      'file_read': 'file_access',
      'file_write': 'file_access',
      'api_call': 'api_calls',
    };
  }

  /** @override Known tool names for UNKNOWN_TOOL error */
  protected getKnownTools(): readonly string[] {
    return KNOWN_TOOLS;
  }

  /** @override LlamaIndex-specific audit context */
  protected getAuditContext(): Readonly<Record<string, unknown>> {
    return {
      indexId: this._config?.indexId || '',
      indexType: this._config?.indexType || '',
    };
  }

  /** @override Validate LlamaIndex-specific config fields */
  protected validateFrameworkConfig(config: LlamaIndexAdapterConfig): CrewAIAdapterError | null {
    if (!config.indexId || config.indexId.length === 0) {
      return serdeError(this.adapterId, 'indexId is required and must be non-empty');
    }
    if (config.maxIngestionBatchSize < 1 || config.maxIngestionBatchSize > 10000) {
      return serdeError(this.adapterId, `maxIngestionBatchSize must be in [1, 10000], got ${config.maxIngestionBatchSize}`);
    }
    if (config.retrievalTopK < 1 || config.retrievalTopK > 1000) {
      return serdeError(this.adapterId, `retrievalTopK must be in [1, 1000], got ${config.retrievalTopK}`);
    }
    return null;
  }
}
