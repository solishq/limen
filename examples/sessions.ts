/**
 * Sessions — Conversation state management with context windows
 *
 * Demonstrates: session creation, multi-turn conversation, history,
 * fork, structured inference within session context.
 *
 * Sessions bind conversations to a tenant+agent pair. Within a session,
 * conversation history is maintained automatically — including summarization
 * when the context window fills.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/sessions.ts
 */

import { createLimen, type TenantId } from '@solishq/limen';
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

// Create a session scoped to a tenant and agent
const session = await limen.session({
  agentName: 'researcher',
  tenantId: 'acme-corp' as TenantId,
  user: { id: 'analyst-1', role: 'analyst' },
});

// Multi-turn conversation — history is maintained automatically
const r1 = session.chat('What were the major AI infrastructure trends in 2025?');
console.log('Turn 1:', await r1.text);

const r2 = session.chat('Which of those has the strongest moat?');
console.log('\nTurn 2:', await r2.text);

const r3 = session.chat('Compare that to the cloud infrastructure market in 2020.');
console.log('\nTurn 3:', await r3.text);

// Review conversation history
const turns = await session.history();
console.log(`\n[Session has ${turns.length} turns]`);

// Structured inference within the same conversation context
const summary = await session.infer({
  input: 'Summarize our conversation in structured form',
  outputSchema: {
    type: 'object',
    properties: {
      topicsCovered: { type: 'array', items: { type: 'string' } },
      keyInsight: { type: 'string' },
      turnCount: { type: 'number' },
    },
    required: ['topicsCovered', 'keyInsight', 'turnCount'],
  },
});
console.log('\nStructured summary:', JSON.stringify(summary.data, null, 2));

await session.close();
await limen.shutdown();
