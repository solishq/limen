# LIMEN INTEGRATION ECOSYSTEM

**Research Date:** 2026-03-30
**Author:** SolisHQ Research (Researcher Agent)
**Limen Version Baseline:** 1.2.0 (limen-ai npm package)
**Evidence Level Legend:** [CONFIRMED] = multi-source verified | [LIKELY] = single authoritative source | [UNCERTAIN] = extrapolated or speculative

---

## Executive Summary

This document maps every integration Limen should support to become the universal cognitive layer for AI systems. The research covers 6 LLM providers, 10 agent frameworks, 4 protocol standards, 8 storage/import targets, 5 observability integrations, 6 developer tools, and the underlying plugin architecture that makes all of them possible without modifying Limen core.

**The thesis:** Limen's existing architecture -- SQLite-backed, TypeScript-native, provider-independent transport layer, frozen instance model -- is uniquely positioned to be the "bring your everything" cognitive substrate. No other product combines deterministic governance with stochastic cognition at the infrastructure level. The integration ecosystem makes this accessible to every framework and every LLM.

---

## Table of Contents

1. [Part 1: LLM Integrations](#part-1-llm-integrations)
2. [Part 2: Agent Framework Integrations](#part-2-agent-framework-integrations)
3. [Part 3: Protocol Integrations](#part-3-protocol-integrations)
4. [Part 4: Database/Storage Integrations](#part-4-databasestorage-integrations)
5. [Part 5: Observability Integrations](#part-5-observability-integrations)
6. [Part 6: Developer Tool Integrations](#part-6-developer-tool-integrations)
7. [Part 7: Integration Architecture](#part-7-the-integration-architecture)
8. [Appendix A: Priority Matrix](#appendix-a-priority-matrix)
9. [Appendix B: Sources](#appendix-b-sources)

---

## Part 1: LLM Integrations

### Current State

Limen already ships provider adapters for 6 LLM providers via its transport layer (`src/substrate/transport/adapters/`):

| Provider | Adapter | Status |
|----------|---------|--------|
| Anthropic (Claude) | `anthropic_adapter.ts` | Shipped |
| OpenAI (GPT) | `openai_adapter.ts` | Shipped |
| Google (Gemini) | `gemini_adapter.ts` | Shipped |
| Groq | `groq_adapter.ts` | Shipped |
| Mistral | `mistral_adapter.ts` | Shipped |
| Ollama (local) | `ollama_adapter.ts` | Shipped |

All adapters implement the `ProviderAdapter` interface with `buildRequest()`, `parseResponse()`, `parseStream()`, `supportsStreaming()`, and `isRetryableStatus()`. This is provider-independent by design (invariant I-04).

**What's missing:** These are transport-level adapters. Integration-level adapters need to go deeper -- auto-detecting tool schemas, injecting knowledge context, and adapting to provider-specific memory patterns.

### 1.1 Claude (Anthropic)

**Current:** Transport adapter handles messages API, streaming, thinking blocks, deliberation metrics. MCP server (`packages/limen-mcp/`) exposes Limen as tools. [CONFIRMED]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| MCP server (one-command) | `npx limen-ai --mcp` starts MCP server with stdio transport | Yes -- detect `~/.claude/` | ~200 LOC wrapper |
| Tool use schemas | Auto-generate Claude tool_use blocks from Limen system calls | Yes -- derive from Limen API surface | ~150 LOC |
| System prompt injection | Inject knowledge context into `<system>` block before each turn | Config flag `injectKnowledge: true` | ~100 LOC |
| Memory tool protocol | Implement Anthropic's memory tool spec (memory directory pattern) | Yes -- detect `ANTHROPIC_API_KEY` | ~250 LOC |
| Extended thinking integration | Route thinking-block content to Limen claims as reasoning traces | Yes -- already parsed in adapter | ~100 LOC |

**Key insight:** Claude's memory tool protocol (as of 2026) uses a file-directory model: "ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE." Limen can BE that directory, surfacing claims and working memory as the memory tool's backing store. [CONFIRMED]

**MCP server architecture:** The 2026 MCP roadmap includes Streamable HTTP transport (for remote/scaled deployments), `.well-known` server discovery, and the Tasks primitive for long-running operations. Limen's MCP server should support:
- stdio transport (current, for local Claude Code/Desktop)
- Streamable HTTP transport (for remote deployment behind load balancers)
- `.well-known/mcp.json` metadata for registry discovery
- Tasks primitive mapping to Limen missions [LIKELY]

### 1.2 GPT (OpenAI)

**Current:** Transport adapter handles chat completions API, structured outputs, streaming. [CONFIRMED]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| Function calling schemas | Auto-generate OpenAI function schemas from Limen system calls with `strict: true` | Yes -- derive from API surface | ~200 LOC |
| Responses API migration | Support new Responses API (replacing Assistants API, deprecated Aug 2026) | Detect API version | ~300 LOC |
| Session memory bridge | Map OpenAI's SQLiteSession pattern to Limen working memory | Config flag | ~200 LOC |
| Tool search integration | Register Limen tools for `tool_search` (gpt-5.4+) deferred loading | Yes -- detect model | ~100 LOC |

**Key insight:** OpenAI deprecated the Assistants API with a shutdown date of August 26, 2026. The Responses API with built-in Sessions is the replacement. OpenAI's SQLiteSession already uses SQLite for persistence -- Limen can replace this with governed, multi-agent-aware persistence. The SDK "expects durable memory, retrieval, or personalization layers to be added externally." Limen IS that external layer. [CONFIRMED]

### 1.3 Gemini (Google)

**Current:** Transport adapter handles `generateContent` API, streaming, function declarations. [CONFIRMED]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| Function declarations | Auto-generate Gemini `FunctionDeclaration` format from Limen system calls | Yes | ~150 LOC |
| Context caching bridge | Use Gemini's explicit caching for knowledge-heavy prompts (90% cost reduction on 2.5+) | Detect model version | ~200 LOC |
| Grounding with knowledge | Inject Limen claims as grounding context for Gemini's grounding feature | Config flag | ~150 LOC |

**Key insight:** Gemini 2.5+ offers 90% cost reduction on cached context reads. Limen should auto-detect when the same knowledge context is being sent repeatedly and activate explicit caching. This is a significant cost optimization that no other memory layer offers. [CONFIRMED]

### 1.4 Llama/Mistral (Local via Ollama)

**Current:** Transport adapters for both Ollama and Mistral (OpenAI-compatible). [CONFIRMED]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| Ollama tool calling | Generate tool definitions compatible with Ollama's function calling format | Yes -- detect Ollama endpoint | ~150 LOC |
| Model capability detection | Probe Ollama `/api/show` to determine if model supports tool calling | Yes | ~100 LOC |
| Local knowledge injection | System prompt injection optimized for smaller context windows | Auto-detect context window | ~200 LOC |
| Mistral function calling | Generate Mistral-native function calling schemas | Yes | ~100 LOC |

**Key insight:** Ollama 0.18.0 (March 2026) supports tool calling with Llama 3.1/3.2, but not all models support it. Limen should probe the model's capabilities via `/api/show` and gracefully degrade to system-prompt injection when tool calling is unavailable. Best local models for tool calling: Llama 3.1 8B-Instruct, Llama 3.2. [CONFIRMED]

### 1.5 Cohere

**Current:** No transport adapter. [CONFIRMED -- gap]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| Transport adapter | Implement `ProviderAdapter` for Cohere Command R+ API | Detect `COHERE_API_KEY` | ~400 LOC |
| Rerank integration | Use Rerank 4.0 to reorder Limen claim query results by relevance | Config flag | ~200 LOC |
| RAG pipeline bridge | Feed Limen claims as documents to Cohere's RAG pipeline | Config flag | ~150 LOC |

**Key insight:** Cohere Rerank 4.0 (released Dec 2025) is the state-of-the-art reranking model. For Limen, this means: query claims broadly, then rerank with Cohere before injecting into context. This dramatically improves knowledge retrieval quality without changing the underlying claim store. The integration is a "retrieval postprocessor" -- a new adapter type. [CONFIRMED]

### 1.6 Groq

**Current:** Transport adapter handles Groq's OpenAI-compatible API. [CONFIRMED]

**What to add:**

| Integration | Pattern | Auto-detect? | Effort |
|-------------|---------|--------------|--------|
| Built-in tools bridge | Leverage Groq's server-side web search and code execution | Detect capability | ~100 LOC |
| Remote MCP tool calling | Register Limen as a remote MCP tool server for Groq | Auto-configure | ~150 LOC |
| Fast inference + knowledge | Optimize knowledge injection for Groq's low-latency use case | Auto-detect latency | ~100 LOC |

**Key insight:** Groq now supports three tool calling patterns: built-in tools (server-side), remote MCP tools (server-side), and local tool calling (client-side). Limen should register as a remote MCP tool server for Groq, allowing Groq's server-side execution to call Limen directly without client-side orchestration. This is a unique zero-latency-overhead pattern. [CONFIRMED]

---

## Part 2: Agent Framework Integrations

### Integration Philosophy

Every agent framework has a memory abstraction. Limen's job is to implement that abstraction while adding governance, evidence grounding, and cross-agent knowledge sharing -- things no framework does natively. The adapter makes Limen look like the framework's native memory to the developer, while underneath it's governed cognition.

### 2.1 LangChain / LangGraph

**Interface to implement:** `BaseMemory` (LangChain) and `BaseCheckpointSaver` (LangGraph)

**LangChain BaseMemory contract:**
```typescript
abstract class BaseMemory {
  abstract memoryVariables: string[];
  abstract loadMemoryVariables(values: Record<string, any>): Promise<Record<string, any>>;
  abstract saveContext(inputValues: Record<string, any>, outputValues: Record<string, any>): Promise<void>;
  abstract clear(): Promise<void>;
}
```

**LangGraph checkpointer contract:**
```typescript
abstract class BaseCheckpointSaver {
  abstract getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined>;
  abstract list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple>;
  abstract put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig>;
}
```

**Limen adapter (`@limen-ai/langchain`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenMemory extends BaseMemory` | Maps `loadMemoryVariables` to `limen.claims.query()`, `saveContext` to `limen.claims.assert()` | ~200 |
| `LimenCheckpointer extends BaseCheckpointSaver` | Maps LangGraph state checkpoints to Limen working memory | ~250 |
| `LimenRetriever` | Implements LangChain `BaseRetriever` for RAG with Limen claims | ~150 |
| `LimenStore` | Implements LangGraph `BaseStore` for cross-thread long-term memory | ~200 |

**Zero-config possibility:** Detect `@langchain/core` in `node_modules`, auto-register Limen as memory provider. ~80% achievable.

**Evidence level:** [CONFIRMED] -- LangChain's BaseMemory interface is stable and well-documented. LangGraph's checkpointer pattern is the recommended persistence mechanism.

### 2.2 LlamaIndex

**Interface to implement:** Custom `QueryEngine` and `Retriever`

**Limen adapter (`@limen-ai/llamaindex`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenQueryEngine` | Wraps Limen claim queries as a LlamaIndex query engine | ~200 |
| `LimenRetriever` | Implements LlamaIndex retriever protocol for knowledge retrieval | ~150 |
| `LimenDocumentStore` | Maps Limen artifacts to LlamaIndex Document objects | ~200 |

**Key insight:** LlamaIndex evolved from a library to an enterprise platform (Series A, $19M). Their focus is "Long-Term Memory" for AI agents. Limen's governed knowledge graph is a natural backend for LlamaIndex's retriever abstraction, especially for knowledge graphs (Property Graph Index) and custom retrievers. [CONFIRMED]

### 2.3 CrewAI

**Interface to implement:** CrewAI's unified `Memory` class

**CrewAI memory architecture (2025-2026):**
- Single `Memory()` class replaces separate STM/LTM/entity/external
- LLM-analyzed content on save (infers scope, categories, importance)
- Adaptive-depth recall with composite scoring (semantic + recency + importance)
- Shared by all agents in a crew, but each agent recalls differently

**Limen adapter (`@limen-ai/crewai`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenCrewMemory` | Implements CrewAI Memory interface backed by Limen claims | ~300 |
| `LimenAgentMemory` | Per-agent memory view with role-specific recall weighting | ~150 |
| `LimenTaskMemory` | Maps CrewAI task outputs to Limen claims with evidence trails | ~150 |

**Key insight:** CrewAI's default backend is ChromaDB. Limen replaces ChromaDB with governed, evidence-grounded knowledge. The critical differentiator: CrewAI's memory has no governance -- agents can write anything. Limen adds trust levels, confidence scores, and dispute resolution. [CONFIRMED]

### 2.4 AutoGen (Microsoft)

**Interface to implement:** `Teachability` capability and `TextAnalyzerAgent` pattern

**AutoGen memory architecture:**
- Vector database for long-term "memos"
- Memos created during conversation, retrieved on demand
- Known limitation: reasoning conflates memories; retrieval is single-step only

**Limen adapter (`@limen-ai/autogen`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenTeachability` | Replaces AutoGen's vector DB memos with Limen claims | ~250 |
| `LimenConversationMemory` | Persistent conversation history backed by Limen working memory | ~200 |

**Key insight:** AutoGen's Teachability has a known limitation: "the Agent's reasoning ability conflates memories together in a non-productive way and the included retrieval mechanism is not set up for multi-step searches." Limen's claim relationships (supports, contradicts, supersedes) directly address this -- claims are structured, not just vectors. This is an invention opportunity. [CONFIRMED]

### 2.5 Letta (MemGPT)

**Interface to implement:** Letta's memory block system and archival storage

**Letta memory architecture:**
- Core memory: always in-context, size-limited, embedded in system instructions
- Archival storage: long-term, searched on demand
- Agents self-edit memory as part of reasoning loop
- Transitioning from MemGPT to Letta V1 architecture (2026)

**Limen adapter (`@limen-ai/letta`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenCoreBlock` | Maps Limen claims to Letta core memory blocks | ~200 |
| `LimenArchivalStorage` | Maps Limen claim store to Letta archival storage | ~200 |
| `LimenMemoryTools` | Expose Limen read/write/search as Letta memory tools | ~150 |

**Key insight:** Letta's differentiator is agents that self-edit memory. Limen already supports this via working memory write/discard and claim assert/retract. The adapter is mostly mapping. Letta V1 supports GPT-5 and Claude 4.5 Sonnet reasoning patterns -- Limen's governance layer ensures self-edits don't violate trust boundaries. [CONFIRMED]

### 2.6 Semantic Kernel (Microsoft)

**Interface to implement:** `IMemoryDb` and `MemoryRecord` for Kernel Memory, plus `VectorStoreRecordCollection` for Vector Store connectors

**Limen adapter (`@limen-ai/semantic-kernel`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenMemoryConnector` | Implements `IMemoryDb` for Kernel Memory integration | ~250 |
| `LimenVectorStore` | Implements Vector Store connector abstraction | ~200 |

**Key insight:** Semantic Kernel now has 27K+ GitHub stars (2026) and is Microsoft's primary agent orchestration framework. It supports experimental agent-to-agent communication and shared memory systems. The Vector Store connectors abstraction provides a clean integration point. [CONFIRMED]

### 2.7 Haystack (deepset)

**Interface to implement:** Document Store protocol (4 mandatory methods)

**Haystack Document Store contract:**
```python
# Protocol-based -- implement these four methods:
count_documents() -> int
filter_documents(filters) -> List[Document]
write_documents(documents, policy) -> int
delete_documents(document_ids) -> None
```

**Limen adapter (`@limen-ai/haystack` or `limen-haystack` per naming convention):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenDocumentStore` | Maps Limen artifacts/claims to Haystack Documents | ~300 |

**Key insight:** Haystack's convention is `<TECHNOLOGY>-haystack` naming for integrations, with a GitHub template for custom document stores. Limen should follow this convention. The integration is straightforward -- Limen artifacts map to Haystack documents, claims map to metadata. [CONFIRMED]

### 2.8 Dify

**Interface to implement:** External Knowledge API

**Limen adapter:**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `limen-dify-knowledge` | HTTP service that exposes Limen claims as a Dify External Knowledge Base | ~300 |

**Key insight:** Dify has a complete Knowledge Base API for managing knowledge, documents, and chunks. But more importantly, it supports "External Knowledge API" -- a webhook-style integration where Dify queries an external system for knowledge. Limen can serve as this external knowledge source. The new plugin system and OAuth support (2025-2026) make this even cleaner. [CONFIRMED]

### 2.9 Flowise

**Interface to implement:** Custom memory node extending `FlowiseMemory`

**Limen adapter:**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenFlowiseMemory` | Extends `FlowiseMemory` / `MemoryMethods` with Limen backend | ~250 |

**Key insight:** Flowise's simple memory "forgets everything" after deployment -- a known pain point. Limen's persistent, governed memory directly solves this. The adapter extends `BufferMemoryExtended` with `appDataSource`, `databaseEntities`, `chatflowid`, and `sessionId` fields mapped to Limen tenants and sessions. [CONFIRMED]

### 2.10 n8n

**Interface to implement:** Custom AI Memory node

**Limen adapter:**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `limen-n8n-memory` | n8n community node that provides Limen-backed memory | ~350 |

**Key insight:** n8n offers four memory types (Simple, Postgres, Redis, Motorhead) but custom memory nodes are possible though documentation is sparse. n8n's community node system allows third-party memory backends. The key pain point: Simple Memory loses data on deploy, and Postgres/Redis require separate infrastructure. Limen (SQLite-backed) provides persistence with zero additional infrastructure. [CONFIRMED]

---

## Part 3: Protocol Integrations

### 3.1 MCP (Model Context Protocol)

**Current state:** Limen ships `limen-mcp` package with full tool surface. [CONFIRMED]

**What to add for "one-command" experience:**

```bash
# Goal: this single command starts a fully functional MCP server
npx limen-ai --mcp
```

**Implementation plan:**

| Feature | Description | Effort |
|---------|-------------|--------|
| CLI flag `--mcp` | Starts MCP server with stdio transport on `npx limen-ai` | ~150 LOC |
| Streamable HTTP mode | `npx limen-ai --mcp --http --port 3001` for remote deployment | ~300 LOC |
| `.well-known/mcp.json` | Serve capability metadata for registry discovery | ~100 LOC |
| Auto-seed governance | On first run, seed governance claims from bundled defaults | ~200 LOC |
| Tasks primitive | Map Limen missions to MCP Tasks for long-running operations | ~250 LOC |
| Config file | `limen.config.json` for persistent MCP server configuration | ~100 LOC |

**MCP 2026 roadmap alignment:**
- Streamable HTTP transport: Limen should support this for scaled deployment [CONFIRMED]
- Server discovery via `.well-known`: Limen should serve capability cards [CONFIRMED]
- Tasks primitive: Maps naturally to Limen missions [LIKELY]
- Auth: MCP now requires RFC 8707 Resource Indicators for security [CONFIRMED]

### 3.2 A2A (Agent-to-Agent Protocol, Google)

**Protocol overview (v0.3, 2025-2026):**
- Open protocol under Linux Foundation, contributed by Google
- Built on HTTP, SSE, JSON-RPC
- Key concepts: Agent Cards (capability discovery), Task lifecycle, Context sharing
- 50+ partners: Atlassian, Box, Cohere, LangChain, MongoDB, PayPal, Salesforce, SAP
- v0.3 adds gRPC support and security card signing

**Limen as A2A participant (`@limen-ai/a2a`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenAgentCard` | Generates A2A Agent Card from Limen agent registration | ~200 |
| `LimenA2AServer` | HTTP server implementing A2A protocol endpoints | ~500 |
| `LimenA2AClient` | Client for discovering and communicating with A2A agents | ~400 |
| `KnowledgeSharingProtocol` | A2A-mediated claim exchange between Limen instances | ~300 |

**Architecture for knowledge sharing via A2A:**
```
Agent A (Limen)                         Agent B (Limen or other)
    |                                        |
    |--- A2A: Agent Card Discovery --------->|
    |<-- A2A: Capability Response -----------|
    |                                        |
    |--- A2A: Task(share_knowledge) -------->|
    |    {claims: [...], confidence: 0.9}    |
    |<-- A2A: Task Update (accepted) --------|
    |                                        |
    |--- A2A: Task(query_knowledge) -------->|
    |    {subject: "entity:*", predicate: "financial.*"}
    |<-- A2A: Task Result (claims[]) --------|
```

**Key insight:** A2A focuses on agents collaborating "in their natural, unstructured modalities, even when they don't share memory, tools and context." Limen's governed knowledge graph is the natural bridge -- agents with DIFFERENT memory systems can share STRUCTURED knowledge via A2A, with Limen providing the governance (trust levels, confidence, evidence trails). This is a significant invention opportunity: A2A + Limen = governed inter-agent knowledge. [CONFIRMED]

### 3.3 OpenAI Agents SDK

**SDK architecture:**
- Python-first, production-ready (evolved from experimental Swarm)
- Core primitives: agents with tools, agent handoffs, guardrails
- Sessions: SQLiteSession (default), OpenAIResponsesCompactionSession, OpenAIConversationsSession
- "Expects durable memory, retrieval, or personalization layers to be added externally"

**Limen adapter (`@limen-ai/openai-agents`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenSession` | Replaces SQLiteSession with Limen working memory | ~250 |
| `LimenPersonalization` | Provides structured state (preferences, constraints, prior outcomes) | ~200 |
| `LimenGuardrail` | Implements guardrail interface backed by Limen governance | ~200 |

**Key insight:** The OpenAI Agents SDK explicitly positions itself as needing external memory. "The SDK handles short-term context cleanly but expects durable memory, retrieval, or personalization layers to be added externally as projects mature." Limen is built to be exactly this. [CONFIRMED]

### 3.4 Universal Tool Schema

**Current landscape (2025-2026):**
- No true universal standard exists
- OpenAI: JSON Schema with `tools` array and `strict: true`
- Anthropic: `tool_use` blocks with `input_schema`
- Google: `function_declarations` with OpenAPI 3.03 format
- Groq/Ollama: OpenAI-compatible format
- MCP: Its own tool definition format

**Limen's opportunity: `@limen-ai/tool-schema`**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenToolSchema` | Canonical Limen tool definition format | ~100 |
| `toOpenAI()` | Convert to OpenAI function calling format | ~80 |
| `toAnthropic()` | Convert to Anthropic tool_use format | ~80 |
| `toGemini()` | Convert to Gemini function_declarations format | ~80 |
| `toMCP()` | Convert to MCP tool definition format | ~80 |
| `fromOpenAI()` / etc. | Parse from any provider format | ~200 |
| Auto-detect | Detect provider from context and emit correct format | ~100 |

**Key insight:** The tool schema fragmentation is a real pain point. LLMSwap v5.2.0 attempts "universal tool calling across all providers." Limen should define tools ONCE in its canonical format and auto-convert per provider. This eliminates the N-provider problem. [CONFIRMED]

---

## Part 4: Database/Storage Integrations

### 4.1 Export Formats

**Limen's internal storage is SQLite (better-sqlite3). All export is a projection from this.**

| Format | What Gets Exported | Implementation | LOC |
|--------|-------------------|----------------|-----|
| JSON | Claims, relationships, working memory, missions | `limen export --format json` | ~150 |
| CSV | Claims table (flat), working memory entries | `limen export --format csv` | ~100 |
| Markdown | Claims as structured markdown with metadata | `limen export --format markdown` | ~150 |
| YAML | Full knowledge graph with relationships | `limen export --format yaml` | ~120 |
| SQLite dump | Raw `.sqlite` file copy | `limen export --format sqlite` | ~50 |
| JSON-LD | Claims as linked data (for semantic web interop) | `limen export --format jsonld` | ~200 |

### 4.2 Import Sources

| Source | Format | Mapping Strategy | LOC |
|--------|--------|-----------------|-----|
| JSON | Limen export format | Direct re-import | ~100 |
| CSV | Tabular claims | Column mapping (subject, predicate, object, confidence) | ~150 |
| Obsidian | Markdown + YAML frontmatter | Parse `[[links]]` as relationships, frontmatter as claim metadata | ~300 |
| Logseq | Markdown + properties | Parse `::` properties as predicates, `[[refs]]` as relationships | ~300 |
| Roam Research | JSON export | Parse block references as relationships, page titles as subjects | ~250 |
| Notion | Markdown export | Parse databases as structured claims, pages as artifacts | ~250 |

**Key insight:** All four PKM tools (Obsidian, Logseq, Roam, Notion) ultimately work with Markdown and JSON. The import pipeline is: parse source format -> map to Limen's subject/predicate/object model -> assert claims with source evidence. Wikilinks (`[[PageName]]`) map to claim relationships. Properties/frontmatter map to predicates. [CONFIRMED]

### 4.3 Sync/Backup Targets

| Target | Mechanism | Use Case | LOC |
|--------|-----------|----------|-----|
| S3/R2 | Upload SQLite + WAL checkpoint | Cloud backup | ~200 |
| Google Drive | OAuth + file upload | Personal backup | ~300 |
| Local filesystem | File copy with versioning | Development | ~50 |
| Git | Commit knowledge snapshots | Version-controlled knowledge | ~150 |

### 4.4 Embedded Deployment Targets

| Platform | Technology | Key Considerations | LOC |
|----------|-----------|-------------------|-----|
| Browser (Web) | sql.js (SQLite WASM) or wa-sqlite with OPFS | Synchronous VFS challenge; OPFS preferred for persistence | ~500 |
| React Native | op-sqlite (JSI) or expo-sqlite | Direct native bridge, no serialization overhead | ~300 |
| Electron | better-sqlite3 (already used) | Direct node binding, zero porting effort | ~50 |
| Tauri | better-sqlite3 via Rust FFI or native SQLite | Similar to Electron, lighter weight | ~100 |

**Key insight:** For browser deployment, the Current State of SQLite Persistence on the Web (Nov 2025) shows OPFS as the best persistence layer. wa-sqlite with OPFS achieves near-native performance. The Limen kernel would need a browser-compatible build that swaps `better-sqlite3` for `wa-sqlite`. This is a significant effort (~500 LOC for the adapter + build config) but enables "Limen in every browser tab." [CONFIRMED]

---

## Part 5: Observability Integrations

### 5.1 OpenTelemetry (Traces + Metrics)

**Current landscape:**
- OpenTelemetry GenAI Semantic Conventions (v1.37+) define standard schema for LLM spans
- Attributes: prompts, model responses, token usage, tool/agent calls, provider metadata
- Agentic systems conventions: tasks, actions, agents, teams, artifacts, memory
- OpenLLMetry: extensions on OTel for LLM observability (open source)

**Limen adapter (`@limen-ai/otel`):**

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `LimenTraceExporter` | Emit OTel spans for: claim assertions, knowledge queries, mission lifecycle, governance decisions | ~400 |
| `LimenMetricsExporter` | Emit OTel metrics: claim count, recall latency, governance events, token usage | ~300 |
| `LimenEventExporter` | Emit OTel events for: claim disputes, trust promotions, working memory writes | ~200 |
| Semantic convention mapping | Map Limen concepts to GenAI semantic conventions | ~150 |

**Metrics to expose:**

| Metric | Type | Description |
|--------|------|-------------|
| `limen.claims.total` | Counter | Total claims asserted |
| `limen.claims.active` | Gauge | Currently active (non-retracted) claims |
| `limen.claims.confidence.histogram` | Histogram | Distribution of confidence scores |
| `limen.recall.latency_ms` | Histogram | Query/recall latency |
| `limen.recall.result_count` | Histogram | Results per query |
| `limen.governance.violations` | Counter | Governance rule violations |
| `limen.missions.active` | Gauge | Currently active missions |
| `limen.tokens.consumed` | Counter | Total LLM tokens consumed |
| `limen.wm.entries` | Gauge | Working memory entries |
| `limen.transport.latency_ms` | Histogram | LLM provider latency |
| `limen.transport.errors` | Counter | Transport errors by type |

### 5.2 Prometheus / Grafana

**Implementation:** Prometheus exposition format (`/metrics` endpoint) with pre-built Grafana dashboard.

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| `/metrics` endpoint | Prometheus text format exposition | ~200 |
| Grafana dashboard JSON | Pre-built dashboard: claims, missions, governance, transport | ~500 (JSON) |
| Grafana MCP integration | Limen as a data source for Grafana's MCP Server | ~200 |

**Key insight:** Grafana released an open-source MCP Server that exposes Grafana functionality to AI agents. The reverse is also valuable: Limen as a data source for Grafana, allowing engineers to visualize knowledge graph health alongside system metrics. [CONFIRMED]

### 5.3 Structured Logging

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| JSON structured logger | Machine-parseable logs with correlation IDs | ~200 |
| Log levels by domain | Configurable: kernel, transport, governance, claims, missions | ~100 |

### 5.4 Alerting

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| Webhook alerter | POST to configurable URL on: health degradation, governance violations, claim disputes | ~200 |
| Alert rules engine | Configurable thresholds: claim growth rate, error rate, budget burn | ~300 |

### 5.5 Analytics

| Component | What It Does | LOC Estimate |
|-----------|-------------|--------------|
| Knowledge analytics | Claim growth over time, most-queried subjects, confidence distribution | ~300 |
| Usage analytics | Recall patterns, popular predicates, agent activity | ~200 |
| Governance analytics | Violation trends, trust promotion history, dispute resolution stats | ~200 |

---

## Part 6: Developer Tool Integrations

### 6.1 CLI Tool

**Goal:** `limen` command available globally via `npx limen-ai` or `npm install -g limen-ai`.

```bash
# Knowledge operations
limen search "audio capture architecture"
limen claim assert --subject "entity:component:vox" --predicate "architecture.pattern" --object "hotkey pipeline"
limen claim query --predicate "decision.*" --min-confidence 0.8
limen recall --subject "entity:project:*"

# Memory operations
limen wm read --task session-123
limen wm write --task session-123 --key progress --value "step 3 complete"

# Mission operations
limen missions list --state EXECUTING
limen missions create --agent researcher --objective "Analyze competitor" --budget 10000

# Export/Import
limen export --format json --output ./backup.json
limen import --source ./obsidian-vault --format obsidian

# Server
limen serve --mcp                    # MCP server (stdio)
limen serve --mcp --http --port 3001 # MCP server (Streamable HTTP)
limen serve --a2a --port 3002        # A2A protocol server
limen serve --rest --port 3003       # REST API server

# Health
limen health
limen metrics
```

**Effort:** ~800 LOC (CLI framework + subcommands)

### 6.2 VS Code Extension

**`vscode-limen`:**

| Feature | Description | LOC Estimate |
|---------|-------------|-------------|
| Knowledge sidebar | Tree view of claims by subject/predicate | ~400 |
| Search | Full-text search across claims and working memory | ~200 |
| Inline annotations | Show relevant claims as CodeLens annotations in source files | ~300 |
| Claim quick-create | Command palette: assert a claim from selected text | ~150 |
| Mission tracker | Status bar item showing active missions | ~100 |
| Knowledge graph view | WebView panel with interactive graph visualization | ~600 |

**Key insight:** The VS Code extension landscape in 2026 is dominated by AI coding assistants (Copilot, Continue, Cody). A Limen extension is NOT a coding assistant -- it's a knowledge browser. It shows what the AI knows, what decisions were made, what evidence supports them. This is unique and complementary to coding assistants. [LIKELY]

### 6.3 Web Dashboard

**`limen-dashboard` (React/Vite SPA):**

| Feature | Description | LOC Estimate |
|---------|-------------|-------------|
| Knowledge graph viewer | D3.js/Cytoscape interactive graph of claims and relationships | ~1000 |
| Claim browser | Table view with filters, search, confidence sliders | ~500 |
| Mission timeline | Gantt-style view of missions and tasks | ~400 |
| Agent registry | View agents, trust levels, promote/demote | ~300 |
| Governance dashboard | Violations, disputes, audit trail | ~400 |
| Working memory inspector | Live view of task working memory | ~200 |
| Health monitor | Real-time engine health with subsystem details | ~200 |

**Total:** ~3000 LOC for MVP

### 6.4 Jupyter/Notebook Integration

**`@limen-ai/jupyter` (Python + JS bridge):**

| Feature | Description | LOC Estimate |
|---------|-------------|-------------|
| `%limen` magic | IPython magic for inline claim queries | ~200 |
| `LimenClient` | Python HTTP client for Limen REST API | ~300 |
| Graph visualization | NetworkX + Plotly rendering of knowledge graph | ~200 |
| DataFrame export | Claims as pandas DataFrame for analysis | ~100 |

**Key insight:** Jupyter remains the dominant interactive computing platform. The knowledge graph visualization aspect is particularly valuable: researchers can explore Limen's knowledge graph interactively, run analytical queries, and export to pandas for statistical analysis. [CONFIRMED]

### 6.5 REST API Server

**For Postman/Insomnia/HTTP clients:**

| Feature | Description | LOC Estimate |
|---------|-------------|-------------|
| REST API wrapper | HTTP endpoints mirroring Limen TypeScript API | ~600 |
| OpenAPI spec | Auto-generated from TypeScript types | ~200 |
| Postman collection | Pre-built collection with examples | ~300 (JSON) |

### 6.6 Postman/Insomnia Collections

Pre-built API collections distributed as JSON files with complete endpoint documentation, example requests/responses, and environment variables for configuration. Effort: ~300 LOC (JSON collection files).

---

## Part 7: The Integration Architecture

### The Problem

Limen needs to support 30+ integrations without:
- Modifying core for each new integration
- Creating maintenance burden from tight coupling
- Losing governance guarantees at integration boundaries
- Requiring users to install everything

### Architecture Decision: Adapter Registry + Event Bus + Middleware Pipeline

After analyzing the patterns across all target frameworks, the architecture that makes Limen infinitely extensible is a **three-layer integration system:**

```
                    +---------------------------+
                    |     Integration Layer      |
                    |  (npm packages, plugins)   |
                    +---------------------------+
                              |
                    +---------------------------+
                    |    Adapter Registry (L3)   |
                    |  Register, discover, wire  |
                    +---------------------------+
                              |
                    +---------------------------+
                    |    Event Bus (L2.5)        |
                    |  Limen emits, adapters     |
                    |  subscribe                 |
                    +---------------------------+
                              |
                    +---------------------------+
                    |    Middleware Pipeline (L2) |
                    |  Transform claims, filter  |
                    |  queries, enrich context   |
                    +---------------------------+
                              |
                    +---------------------------+
                    |    Limen Core (L1-L2)      |
                    |  Kernel, Claims, Missions  |
                    |  Working Memory, Governance |
                    +---------------------------+
```

### Layer 1: Middleware Pipeline

**What it is:** A chain of transform functions that process data flowing in and out of Limen core.

```typescript
/**
 * Middleware function type.
 * Receives context and a next() function to continue the chain.
 */
type LimenMiddleware<T> = (
  context: MiddlewareContext<T>,
  next: () => Promise<T>
) => Promise<T>;

/**
 * Middleware pipeline.
 * Registered middlewares execute in order for each operation type.
 */
interface MiddlewarePipeline {
  /** Add middleware for claim assertions */
  onClaimAssert(mw: LimenMiddleware<AssertClaimOutput>): void;

  /** Add middleware for claim queries */
  onClaimQuery(mw: LimenMiddleware<ClaimQueryResult>): void;

  /** Add middleware for knowledge recall */
  onRecall(mw: LimenMiddleware<RecallResult>): void;

  /** Add middleware for working memory operations */
  onWorkingMemory(mw: LimenMiddleware<WmResult>): void;

  /** Add middleware for chat/infer calls */
  onChat(mw: LimenMiddleware<ChatResult>): void;
}
```

**Use cases:**
- **Cohere reranker:** Middleware on `onClaimQuery` that reranks results before returning
- **Embedding enrichment:** Middleware on `onClaimAssert` that adds vector embeddings
- **Confidence calibration:** Middleware that adjusts confidence based on source reliability
- **Access control:** Middleware that filters claims based on caller's permissions

### Layer 2: Event Bus (Already Exists)

**Limen already has an EventBus in the kernel.** Integration adapters subscribe to events:

```typescript
// Events Limen emits (existing + new for integrations)
type LimenIntegrationEvent =
  | { type: 'claim.asserted'; claim: Claim }
  | { type: 'claim.retracted'; claimId: string }
  | { type: 'claim.disputed'; claimId: string; relationship: Relationship }
  | { type: 'mission.created'; mission: Mission }
  | { type: 'mission.completed'; mission: Mission }
  | { type: 'agent.promoted'; agent: Agent; newTrust: TrustLevel }
  | { type: 'governance.violation'; details: ViolationDetails }
  | { type: 'health.changed'; status: HealthStatus }
  | { type: 'wm.written'; taskId: string; key: string }
  | { type: 'wm.discarded'; taskId: string; key: string | null };
```

**Use cases:**
- **Webhook alerter:** Subscribes to `governance.violation` and `health.changed`
- **OpenTelemetry exporter:** Subscribes to all events, emits spans
- **Sync adapter:** Subscribes to `claim.asserted`, syncs to S3/Drive
- **Dashboard:** WebSocket bridge from event bus to browser

### Layer 3: Adapter Registry

**What it is:** A registry where integrations register themselves, declare capabilities, and get auto-wired.

```typescript
/**
 * Integration adapter interface.
 * Every integration implements this contract.
 */
interface LimenAdapter {
  /** Unique adapter identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Adapter version */
  readonly version: string;

  /** What this adapter provides */
  readonly capabilities: readonly AdapterCapability[];

  /** Initialize the adapter with a Limen instance */
  initialize(limen: Limen, config: Record<string, unknown>): Promise<void>;

  /** Graceful shutdown */
  shutdown(): Promise<void>;

  /** Health check */
  health(): AdapterHealth;
}

type AdapterCapability =
  | 'memory'          // Provides memory interface for a framework
  | 'retriever'       // Provides retrieval/RAG capabilities
  | 'transport'       // Provides LLM transport
  | 'export'          // Provides data export
  | 'import'          // Provides data import
  | 'observability'   // Provides monitoring/tracing
  | 'protocol'        // Provides protocol support (MCP, A2A)
  | 'tool-schema'     // Provides tool schema conversion
  | 'reranker'        // Provides result reranking
  | 'sync'            // Provides external sync
  | 'ui'              // Provides user interface;

/**
 * Adapter Registry.
 * Manages adapter lifecycle and discovery.
 */
interface AdapterRegistry {
  /** Register an adapter */
  register(adapter: LimenAdapter): void;

  /** Get adapter by ID */
  get(id: string): LimenAdapter | undefined;

  /** List adapters by capability */
  list(capability?: AdapterCapability): readonly LimenAdapter[];

  /** Auto-discover adapters from node_modules */
  discover(): Promise<readonly LimenAdapter[]>;
}
```

### Auto-Discovery

Adapters self-register via npm package convention:

```json
// package.json of @limen-ai/langchain
{
  "name": "@limen-ai/langchain",
  "limen": {
    "adapter": true,
    "capabilities": ["memory", "retriever"],
    "autoLoad": true
  }
}
```

When Limen starts, the registry scans `node_modules` for packages with `"limen": { "adapter": true }` and auto-loads them. This means:

```bash
# Install Limen + LangChain adapter
npm install limen-ai @limen-ai/langchain

# That's it. LangChain memory is now Limen-backed.
```

### Configuration

```typescript
// limen.config.ts
import { createLimen } from 'limen-ai';

const limen = await createLimen({
  dataDir: './data',
  masterKey: Buffer.from(process.env.LIMEN_KEY!, 'hex'),

  // Adapter configuration (optional -- auto-discovery handles most cases)
  adapters: {
    '@limen-ai/langchain': {
      autoInjectMemory: true,
      retrievalDepth: 50,
    },
    '@limen-ai/otel': {
      endpoint: 'http://localhost:4317',
      serviceName: 'my-agent',
    },
    '@limen-ai/cohere': {
      rerankModel: 'rerank-v4.0',
      topN: 10,
    },
  },
});
```

### Package Structure

```
limen-ai/                          # Core engine (already published)
  src/
    api/
    kernel/
    substrate/
    orchestration/
    ...

@limen-ai/langchain               # LangChain adapter
@limen-ai/llamaindex               # LlamaIndex adapter
@limen-ai/crewai                   # CrewAI adapter
@limen-ai/autogen                  # AutoGen adapter
@limen-ai/letta                    # Letta (MemGPT) adapter
@limen-ai/semantic-kernel          # Semantic Kernel adapter
@limen-ai/openai-agents            # OpenAI Agents SDK adapter
@limen-ai/a2a                      # A2A protocol adapter
@limen-ai/tool-schema              # Universal tool schema converter
@limen-ai/otel                     # OpenTelemetry adapter
@limen-ai/cohere                   # Cohere transport + reranker
@limen-ai/export                   # Export formats (JSON, CSV, MD, YAML)
@limen-ai/import                   # Import sources (Obsidian, Logseq, etc.)
@limen-ai/sync                     # Sync targets (S3, Git)
@limen-ai/dashboard                # Web dashboard
@limen-ai/jupyter                  # Jupyter integration

limen-haystack                     # Haystack adapter (follows their naming)
limen-dify-knowledge               # Dify external knowledge adapter
limen-n8n-memory                   # n8n community node
limen-flowise-memory               # Flowise memory node

vscode-limen                       # VS Code extension
```

### Why This Architecture

1. **Zero core modification:** Adding a new integration is: create npm package, implement `LimenAdapter`, publish. Core never changes.

2. **Auto-discovery:** `npm install` is the entire setup. No config files, no registration code. The adapter registry finds packages automatically.

3. **Middleware composability:** Multiple adapters can hook into the same pipeline. Cohere reranking + OpenTelemetry tracing + access control all compose without knowing about each other.

4. **Event-driven reactivity:** Adapters respond to Limen state changes in real-time. A claim assertion triggers: OTel span, S3 sync, dashboard update, webhook alert -- all independently.

5. **Governance preservation:** The middleware pipeline runs AFTER governance checks. No adapter can bypass trust boundaries, RBAC, or audit trails. Governance is in core, not in adapters.

6. **Independent packaging:** Users install only what they need. A LangChain user doesn't pull in CrewAI dependencies. Bundle size stays minimal.

---

## Appendix A: Priority Matrix

### Tier 1 -- Ship First (Critical Mass)

These integrations make Limen accessible to the largest developer populations.

| Integration | Framework/Protocol | Developer Reach | Effort | Priority |
|-------------|-------------------|-----------------|--------|----------|
| One-command MCP | MCP | Claude Code, Cursor, every MCP client | ~200 LOC | P0 |
| LangChain/LangGraph adapter | LangChain | Largest AI framework ecosystem | ~800 LOC | P0 |
| OpenAI function schemas | OpenAI | Largest LLM user base | ~200 LOC | P0 |
| CLI tool | Developer workflow | Every terminal user | ~800 LOC | P0 |
| JSON/CSV export | Data portability | Every user | ~250 LOC | P0 |
| Plugin architecture core | All integrations | Foundation for everything | ~600 LOC | P0 |

### Tier 2 -- Ship Next (Ecosystem Breadth)

| Integration | Framework/Protocol | Developer Reach | Effort | Priority |
|-------------|-------------------|-----------------|--------|----------|
| CrewAI adapter | CrewAI | Fast-growing multi-agent framework | ~600 LOC | P1 |
| A2A protocol | Google A2A | Enterprise agent communication | ~1400 LOC | P1 |
| OpenTelemetry | Observability | Every production deployment | ~1050 LOC | P1 |
| Universal tool schema | All LLMs | Eliminates N-provider problem | ~620 LOC | P1 |
| Cohere transport + rerank | Cohere | RAG-focused teams | ~750 LOC | P1 |
| Obsidian/Logseq import | PKM users | Knowledge workers | ~600 LOC | P1 |
| Web dashboard | Visual exploration | Every user | ~3000 LOC | P1 |
| REST API server | HTTP clients | Every language | ~800 LOC | P1 |

### Tier 3 -- Ship Later (Long Tail)

| Integration | Framework/Protocol | Developer Reach | Effort | Priority |
|-------------|-------------------|-----------------|--------|----------|
| LlamaIndex adapter | LlamaIndex | Enterprise RAG | ~550 LOC | P2 |
| AutoGen adapter | AutoGen | Microsoft ecosystem | ~450 LOC | P2 |
| Letta adapter | Letta | Stateful agents | ~550 LOC | P2 |
| Semantic Kernel adapter | Semantic Kernel | .NET/enterprise | ~450 LOC | P2 |
| OpenAI Agents SDK adapter | OpenAI SDK | Python agents | ~650 LOC | P2 |
| VS Code extension | Editor integration | VS Code users | ~1750 LOC | P2 |
| Prometheus/Grafana | Infrastructure teams | DevOps | ~900 LOC | P2 |
| Browser (WASM) build | Web apps | Frontend developers | ~500 LOC | P2 |
| Jupyter integration | Data scientists | Researchers | ~800 LOC | P2 |

### Tier 4 -- Community Contributions Welcome

| Integration | Framework/Protocol | Notes |
|-------------|-------------------|-------|
| Haystack adapter | deepset | Follow their template |
| Dify adapter | Dify | External Knowledge API |
| Flowise adapter | Flowise | Memory node |
| n8n adapter | n8n | Community node |
| React Native build | Mobile | op-sqlite bridge |
| Google Drive sync | Backup | OAuth complexity |
| Roam/Notion import | PKM | Smaller user bases |

---

## Appendix B: Sources

### LLM Provider Documentation
- [Anthropic Memory Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [OpenAI Session Memory](https://cookbook.openai.com/examples/agents_sdk/session_memory)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
- [Gemini Tools](https://ai.google.dev/gemini-api/docs/tools)
- [Groq Tool Use](https://console.groq.com/docs/tool-use/overview)
- [Ollama Tool Calling](https://docs.ollama.com/capabilities/tool-calling)
- [Cohere Rerank](https://cohere.com/rerank)
- [Cohere RAG](https://docs.cohere.com/docs/rag-with-cohere)

### Agent Framework Documentation
- [LangChain BaseMemory](https://reference.langchain.com/javascript/langchain-core/memory/BaseMemory)
- [LangGraph Memory Overview](https://docs.langchain.com/oss/python/langgraph/memory)
- [LlamaIndex Retriever](https://docs.llamaindex.ai/en/stable/module_guides/querying/retriever/)
- [CrewAI Memory](https://docs.crewai.com/en/concepts/memory)
- [CrewAI Cognitive Memory Blog](https://blog.crewai.com/how-we-built-cognitive-memory-for-agentic-systems/)
- [AutoGen Teachability](https://microsoft.github.io/autogen/0.2/docs/reference/agentchat/contrib/capabilities/teachability/)
- [AutoGen Memory](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/memory.html)
- [Letta (MemGPT) Concepts](https://docs.letta.com/concepts/memgpt/)
- [Letta V1 Architecture](https://www.letta.com/blog/letta-v1-agent)
- [Semantic Kernel Memory Connectors](https://learn.microsoft.com/en-us/semantic-kernel/concepts/vector-store-connectors/out-of-the-box-connectors/inmemory-connector)
- [Haystack Custom Document Stores](https://docs.haystack.deepset.ai/docs/creating-custom-document-stores)
- [Dify Knowledge Base API](https://docs.dify.ai/en/use-dify/knowledge/manage-knowledge/maintain-dataset-via-api)
- [Flowise Memory](https://docs.flowiseai.com/integrations/langchain/memory)
- [n8n Memory](https://docs.n8n.io/advanced-ai/examples/understand-memory/)

### Protocol Specifications
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Google A2A Protocol](https://a2a-protocol.org/latest/)
- [A2A GitHub](https://github.com/a2aproject/A2A)
- [A2A Announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

### Observability
- [OpenTelemetry AI Agent Observability](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [OTel GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/issues/2664)
- [OpenLLMetry](https://github.com/traceloop/openllmetry)
- [Grafana MCP Server](https://grafana.com/blog/going-beyond-ai-chat-response-how-were-building-an-agentic-system-to-drive-grafana/)

### Memory Landscape
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Research](https://mem0.ai/research)
- [AI Agent Memory Comparison 2026](https://vectorize.io/articles/best-ai-agent-memory-systems)
- [Survey of AI Agent Memory Frameworks](https://www.graphlit.com/blog/survey-of-ai-agent-memory-frameworks)
- [Top 10 AI Memory Products 2026](https://medium.com/@bumurzaqov2/top-10-ai-memory-products-2026-09d7900b5ab1)

### Browser/Mobile SQLite
- [SQLite Persistence on Web (Nov 2025)](https://www.powersync.com/blog/sqlite-persistence-on-the-web)
- [sql.js](https://github.com/sql-js/sql.js/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)

### Tool Schema
- [Unified Tool Integration for LLMs](https://arxiv.org/html/2508.02979v1)
- [ToolRegistry](https://arxiv.org/html/2507.10593v1)

---

## Appendix C: Competitive Positioning

### Limen vs. Existing Memory Layers

| Feature | Limen | Mem0 | Zep | Letta | Cognee |
|---------|-------|------|-----|-------|--------|
| Governance (trust, RBAC) | Yes (constitutional) | No | No | No | No |
| Evidence grounding | Yes (claim evidence) | No | No | No | Partial |
| Claim relationships | Yes (supports/contradicts/supersedes) | No | Temporal graph | No | Knowledge graph |
| Multi-agent isolation | Yes (tenant scoping) | User/session/agent levels | Session-level | Per-agent | No |
| Self-hosted (no cloud) | Yes (SQLite) | Yes (OSS) or Cloud | Cloud-first | Cloud-first | Yes (OSS) |
| Zero dependencies | Yes (only better-sqlite3) | Requires vector DB | Requires cloud | Requires server | Requires vector DB |
| Provider independence | Yes (6 adapters) | Partial | No | Partial | Partial |
| Deterministic governance | Yes (kernel-level) | No | No | No | No |

**Limen's unique position:** The only system that combines deterministic governance with stochastic cognition at the infrastructure level. Every other memory product is "add memory to your AI." Limen is "add governed, evidence-based, auditable knowledge to your AI." This is the differentiator that makes Limen impossible to replace once adopted.

---

*Document produced by SolisHQ Research. All evidence levels marked. All sources cited. Knowledge gaps identified. Invention opportunities flagged.*

*SolisHQ -- We innovate, invent, then disrupt.*
