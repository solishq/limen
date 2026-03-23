/**
 * Multi-Provider — Configure multiple LLM providers with routing
 *
 * Demonstrates: multiple providers, routing strategies, model selection.
 * Limen communicates with all providers via raw HTTP — no SDKs installed.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... npx tsx examples/multi-provider.ts
 */

import { createLimen } from '@solishq/limen';
import crypto from 'node:crypto';

const limen = await createLimen({
  dataDir: './example-data',
  masterKey: crypto.randomBytes(32),
  providers: [
    {
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: ['claude-sonnet-4-20250514'],
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      maxConcurrent: 5,
    },
    {
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      models: ['gpt-4o'],
      apiKeyEnvVar: 'OPENAI_API_KEY',
    },
    {
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      models: ['llama3.2'],
      // No API key — Ollama runs locally
    },
  ],
});

// Auto routing — Limen selects the best available provider
const auto = limen.chat('What is 2 + 2?', { routing: 'auto' });
const autoMeta = await auto.metadata;
console.log(`Auto routing chose: ${autoMeta.provider.id}/${autoMeta.provider.model}`);
console.log(`Answer: ${await auto.text}\n`);

// Explicit model selection
const explicit = limen.chat('Explain recursion in one sentence.', {
  routing: 'explicit',
  model: 'claude-sonnet-4-20250514',
});
const explicitMeta = await explicit.metadata;
console.log(`Explicit routing: ${explicitMeta.provider.id}/${explicitMeta.provider.model}`);
console.log(`Answer: ${await explicit.text}\n`);

// Quality routing — prefers the highest-capability model
const quality = limen.chat('Write a haiku about determinism.', { routing: 'quality' });
const qualityMeta = await quality.metadata;
console.log(`Quality routing chose: ${qualityMeta.provider.id}/${qualityMeta.provider.model}`);
console.log(`Answer: ${await quality.text}`);

await limen.shutdown();
