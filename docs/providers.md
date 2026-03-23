# Provider Cookbook

Limen communicates with LLM providers over raw HTTP. No provider SDKs are imported — ever. This means zero transitive dependencies, no version conflicts, and full control over every request.

---

## Configuring Providers

Pass providers to `createLimen()`. Each provider specifies a type, base URL, supported models, and authentication.

```typescript
import { createLimen } from '@solishq/limen';
import crypto from 'node:crypto';

const limen = await createLimen({
  dataDir: './data',
  masterKey: Buffer.from(process.env.LIMEN_MASTER_KEY!, 'hex'),
  providers: [
    {
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      maxConcurrent: 5,
    },
    {
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      models: ['gpt-4o', 'gpt-4o-mini'],
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    {
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      models: ['gemini-2.0-flash'],
      apiKeyEnvVar: 'GEMINI_API_KEY',
    },
    {
      type: 'groq',
      baseUrl: 'https://api.groq.com',
      models: ['llama-3.3-70b-versatile'],
      apiKeyEnvVar: 'GROQ_API_KEY',
    },
    {
      type: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      models: ['mistral-large-latest'],
      apiKeyEnvVar: 'MISTRAL_API_KEY',
    },
    {
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      models: ['llama3.2', 'codellama'],
      // No API key — Ollama runs locally
    },
  ],
});
```

---

## Provider Reference

### Anthropic

| Field | Value |
|---|---|
| `type` | `'anthropic'` |
| `baseUrl` | `https://api.anthropic.com` |
| `apiKeyEnvVar` | `ANTHROPIC_API_KEY` |
| Auth method | `x-api-key` header |
| Streaming | SSE |
| Retryable status codes | 429, 500, 502, 503, 529 (overloaded) |

### OpenAI

| Field | Value |
|---|---|
| `type` | `'openai'` |
| `baseUrl` | `https://api.openai.com` |
| `apiKeyEnvVar` | `OPENAI_API_KEY` |
| Auth method | `Authorization: Bearer` header |
| Streaming | SSE |
| Retryable status codes | 429, 500, 502, 503 |

Works with any OpenAI-compatible endpoint (Azure OpenAI, Together, Fireworks, etc.) by changing `baseUrl`.

### Google Gemini

| Field | Value |
|---|---|
| `type` | `'gemini'` |
| `baseUrl` | `https://generativelanguage.googleapis.com` |
| `apiKeyEnvVar` | `GEMINI_API_KEY` |
| Auth method | `key` query parameter |
| Streaming | SSE |
| Retryable status codes | 429, 500, 502, 503 |

### Groq

| Field | Value |
|---|---|
| `type` | `'groq'` |
| `baseUrl` | `https://api.groq.com` |
| `apiKeyEnvVar` | `GROQ_API_KEY` |
| Auth method | `Authorization: Bearer` header |
| Streaming | SSE |
| Retryable status codes | 429, 500, 502, 503 |

### Mistral

| Field | Value |
|---|---|
| `type` | `'mistral'` |
| `baseUrl` | `https://api.mistral.ai` |
| `apiKeyEnvVar` | `MISTRAL_API_KEY` |
| Auth method | `Authorization: Bearer` header |
| Streaming | SSE |
| Retryable status codes | 429, 500, 502, 503 |

### Ollama

| Field | Value |
|---|---|
| `type` | `'ollama'` |
| `baseUrl` | `http://localhost:11434` |
| `apiKeyEnvVar` | None |
| Auth method | None (local) |
| Streaming | NDJSON |
| Retryable status codes | 429, 500, 502, 503 |

Ollama runs locally. TLS is not required for `localhost` / `127.0.0.1` endpoints.

---

## Routing Strategies

When multiple providers are configured, Limen can route requests automatically.

```typescript
// Auto — Limen selects the best available provider
limen.chat('Hello', { routing: 'auto' });

// Explicit — specify a model, Limen finds the provider
limen.chat('Hello', { routing: 'explicit', model: 'claude-sonnet-4-20250514' });

// Quality — prefers the highest-capability model
limen.chat('Hello', { routing: 'quality' });
```

---

## Standalone Transport

The transport layer works independently of the Limen engine. Import from `@solishq/limen/transport`.

```typescript
import {
  createTransportEngine,
  createAnthropicAdapterFromEnv,
  createOpenAIAdapterFromEnv,
  createGeminiAdapterFromEnv,
  createGroqAdapterFromEnv,
  createMistralAdapterFromEnv,
  createOllamaAdapter,
} from '@solishq/limen/transport';

const engine = createTransportEngine();
const adapter = createAnthropicAdapterFromEnv();

// Non-streaming
const result = await engine.execute(adapter, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});

// Streaming
const stream = await engine.executeStream(adapter, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    maxTokens: 1024,
  },
});
for await (const chunk of stream.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}

engine.shutdown();
```

---

## Transport Safety Features

The transport layer enforces these protections automatically:

| Feature | Default | Description |
|---|---|---|
| Retry | 3 attempts, 120s total cap | Exponential backoff on retryable status codes |
| Circuit breaker | Per-model | Opens after repeated failures, half-opens after cooldown |
| Stall detection | 30s | Aborts streaming if no data received for 30 seconds |
| First-byte timeout | 30s | Aborts streaming if no first byte within 30 seconds |
| Total stream timeout | 10 minutes | Maximum total streaming duration |
| Response size limit | 10 MB | Rejects oversized responses |
| TLS enforcement | Required | Non-TLS URLs rejected (except localhost) |
| Retry-After cap | 60s | Rejects Retry-After headers exceeding 60 seconds |
| SSE line limit | 1 MB | Rejects individual SSE lines exceeding 1 MB |
| SSE event limit | 100,000 | Rejects streams exceeding 100K events |
