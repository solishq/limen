/**
 * Structured Output — Schema-validated inference with auto-retry
 *
 * Demonstrates: limen.infer() with JSON Schema, typed results, retry count.
 * On validation failure, Limen appends the error to the prompt and retries
 * up to maxRetries times. The result is typed and guaranteed to match the schema.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/structured-output.ts
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

// Define the output schema (JSON Schema draft-07)
const CompetitorAnalysis = {
  type: 'object',
  properties: {
    market: { type: 'string' },
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          strength: { type: 'string' },
          weakness: { type: 'string' },
          threatLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['name', 'strength', 'weakness', 'threatLevel'],
      },
      minItems: 3,
      maxItems: 5,
    },
    summary: { type: 'string' },
  },
  required: ['market', 'competitors', 'summary'],
} as const;

const result = await limen.infer({
  input: 'Analyze the competitive landscape for AI infrastructure platforms in 2025',
  outputSchema: CompetitorAnalysis,
  maxRetries: 2,
});

console.log(`Market: ${result.data.market}\n`);
for (const c of result.data.competitors) {
  console.log(`  ${c.name} [${c.threatLevel}]`);
  console.log(`    Strength: ${c.strength}`);
  console.log(`    Weakness: ${c.weakness}\n`);
}
console.log(`Summary: ${result.data.summary}`);
console.log(`\n[Retries: ${result.retryCount} | Tokens: ${result.usage.totalTokens} | Cost: $${result.usage.estimatedCostUsd.toFixed(4)}]`);

await limen.shutdown();
