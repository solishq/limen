// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * LlamaIndex Adapter Types
 *
 * Types specific to the LlamaIndex framework adapter.
 * LlamaIndex patterns: Query engines, Data connectors, Index management, Retrievers.
 *
 * Architecture: AGENT_ADAPTER_ARCHITECTURE.md v2.3.0
 * Shared Types: SHARED_TYPES.md v1.4.1 (AgentFramework: 'llama_index')
 */

import type { SessionId } from '../shared/types.js';
import type { BaseAdapterConfig } from '../shared/types.js';

// ── LlamaIndex Session Types ──

/** LlamaIndex session start */
export interface LlamaIndexSessionStart {
  /** Index identifier */
  readonly indexId: string;
  /** Index type (vector, keyword, tree, list, knowledge_graph) */
  readonly indexType: 'vector' | 'keyword' | 'tree' | 'list' | 'knowledge_graph';
  /** Data connectors loaded */
  readonly connectors: readonly string[];
  /** Query engine type */
  readonly queryEngineType?: 'retriever' | 'router' | 'sub_question' | 'transform' | 'custom';
  /** Optional metadata */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** LlamaIndex session end */
export interface LlamaIndexSessionEnd {
  readonly sessionId: SessionId;
  readonly indexId: string;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'timeout';
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ── LlamaIndex Config ──

/** LlamaIndex adapter configuration */
export interface LlamaIndexAdapterConfig extends BaseAdapterConfig {
  /** Index ID */
  readonly indexId: string;
  /** Index type */
  readonly indexType: 'vector' | 'keyword' | 'tree' | 'list' | 'knowledge_graph';
  /** Whether to intercept LlamaIndex retrievals and route to Limen */
  readonly interceptRetrieval: boolean;
  /** Maximum number of documents per ingestion batch */
  readonly maxIngestionBatchSize: number;
  /** Top-k limit for retrieval queries */
  readonly retrievalTopK: number;
}

// ── LlamaIndex Hook Events ──

/** LlamaIndex native events */
export type LlamaIndexHookEvent =
  | { readonly type: 'query_start'; readonly query: string; readonly engineType: string }
  | { readonly type: 'query_end'; readonly query: string; readonly responseLength: number; readonly nodesUsed: number }
  | { readonly type: 'retrieval_start'; readonly query: string; readonly topK: number }
  | { readonly type: 'retrieval_end'; readonly query: string; readonly nodesRetrieved: number; readonly scoreRange: { min: number; max: number } }
  | { readonly type: 'ingestion_start'; readonly documentCount: number; readonly connectorType: string }
  | { readonly type: 'ingestion_end'; readonly documentCount: number; readonly nodesCreated: number; readonly connectorType: string }
  | { readonly type: 'index_refresh'; readonly indexId: string; readonly nodesAdded: number; readonly nodesDeleted: number }
  | { readonly type: 'embedding_generated'; readonly text: string; readonly dimensions: number; readonly model: string }
  | { readonly type: 'tool_called'; readonly toolName: string; readonly args: Readonly<Record<string, unknown>>; readonly result?: unknown };

// ── LlamaIndex Audit Details ──

/** LlamaIndex-specific audit detail fields */
export interface LlamaIndexAuditDetails {
  readonly indexId: string;
  readonly indexType: string;
  readonly queryEngineType?: string;
}
