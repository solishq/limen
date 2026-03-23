/**
 * Transport layer re-exports.
 * S ref: §25.4 (LLM Gateway), I-04 (provider independence)
 *
 * Phase: 5A (Sprint 5A — Shared Transport Infrastructure)
 */

// Types
export type {
  TransportErrorCode,
  SSEEvent,
  TransportHttpRequest,
  TransportHttpResponse,
  DeliberationMetrics,
  TransportResult,
  TransportStreamResult,
  ProviderAdapter,
  TransportExecuteOptions,
  TransportEngine,
  UpdateProviderHealthFn,
  IsCircuitOpenFn,
  TransportEngineOptions,
} from './transport_types.js';

// Stream parsers
export { parseSSEStream, parseNDJSONStream } from './stream_parser.js';

// Transport engine
export { createTransportEngine } from './transport_engine.js';

// Anthropic adapter
export { createAnthropicAdapter, createAnthropicAdapterFromEnv } from './adapters/anthropic_adapter.js';

// OpenAI compat (shared functions for OpenAI-compatible providers)
export { buildOpenAICompatRequest, parseOpenAICompatResponse } from './adapters/openai_compat.js';

// OpenAI adapter
export { createOpenAIAdapter, createOpenAIAdapterFromEnv } from './adapters/openai_adapter.js';

// Gemini adapter
export { createGeminiAdapter, createGeminiAdapterFromEnv, scrubUrl } from './adapters/gemini_adapter.js';

// Groq adapter (Sprint 5C)
export { createGroqAdapter, createGroqAdapterFromEnv } from './adapters/groq_adapter.js';

// Mistral adapter (Sprint 5C)
export { createMistralAdapter, createMistralAdapterFromEnv } from './adapters/mistral_adapter.js';

// Ollama adapter (Sprint 5C)
export { createOllamaAdapter } from './adapters/ollama_adapter.js';
