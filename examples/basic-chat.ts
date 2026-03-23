/**
 * Basic Chat — Limen quick start
 *
 * Demonstrates: createLimen, chat (streaming + non-streaming), shutdown.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/basic-chat.ts
 */

import { createLimen } from 'limen-ai';
import crypto from 'node:crypto';

const limen = await createLimen({
  dataDir: './example-data',
  masterKey: crypto.randomBytes(32),
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514'],
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  }],
});

// --- Non-streaming chat ---
const response = limen.chat('What is the threshold between order and chaos?', {
  stream: false,
});
const text = await response.text;
const metadata = await response.metadata;
console.log(text);
console.log(`\n[${metadata.tokens.input} in / ${metadata.tokens.output} out — ${metadata.totalMs}ms]`);

// --- Streaming chat ---
console.log('\n--- Streaming ---\n');
const streamed = limen.chat('Explain emergence in three sentences.');
for await (const chunk of streamed.stream) {
  if (chunk.type === 'content_delta') process.stdout.write(chunk.delta);
  if (chunk.type === 'done') console.log(`\n\n[Finished: ${chunk.finishReason}]`);
}

await limen.shutdown();
