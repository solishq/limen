/**
 * Transport Standalone — Use Limen's LLM transport layer independently
 *
 * Demonstrates: transport engine, provider adapters, streaming, circuit breakers.
 * The transport layer is a zero-dependency LLM client that works without
 * the full Limen engine. Useful when you need reliable provider communication
 * with retry, backoff, stall detection, and circuit breaking — but not the
 * full cognitive OS.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/transport-standalone.ts
 */

import {
  createTransportEngine,
  createAnthropicAdapterFromEnv,
  createOpenAIAdapterFromEnv,
} from 'limen-ai/transport';

const engine = createTransportEngine();
const anthropic = createAnthropicAdapterFromEnv();

// --- Non-streaming request with automatic retry ---
console.log('--- Non-streaming ---\n');
const result = await engine.execute(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'What is a threshold?' }] }],
    maxTokens: 256,
  },
});
console.log(result.response.content);
console.log(`[${result.response.usage.inputTokens} in / ${result.response.usage.outputTokens} out]`);

// --- Streaming with stall detection ---
console.log('\n--- Streaming ---\n');
const stream = await engine.executeStream(anthropic, {
  request: {
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Count from 1 to 10.' }] }],
    maxTokens: 256,
  },
});
for await (const chunk of stream.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
}
console.log('\n');

// Graceful shutdown — aborts in-flight requests, rejects new ones
engine.shutdown();
