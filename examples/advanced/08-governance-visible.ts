import { createLimen, resolveDefaults } from 'limen-ai';
import type { LimenLogEvent } from 'limen-ai';

// ─── Making Governance Visible ───
//
// Governance runs silently by default — even with zero-config.
// Every operation flows through: RBAC, audit trail, budget enforcement,
// encryption, circuit breakers — all transparent to the consumer.
//
// To observe the governance layer, add a logger callback.
// Zero-config handles providers, master key, and data directory.
// We just layer on the logger.

const events: LimenLogEvent[] = [];

const limen = await createLimen({
  ...resolveDefaults(),
  logger: (event: LimenLogEvent) => {
    events.push(event);
    const prefix = `[${event.level.toUpperCase()}] [${event.category}]`;
    console.log(`${prefix} ${event.message}`);
  },
});

// A simple chat — but governance runs underneath
const result = limen.chat('What are the benefits of renewable energy?');
await result.text;

// Show what the governance layer did
const meta = await result.metadata;
console.log('\n--- Governance Report ---');
console.log(`Trace ID:   ${meta.traceId}`);
console.log(`Provider:   ${meta.provider.id} / ${meta.provider.model}`);
console.log(`Tokens:     ${meta.tokens.input} in / ${meta.tokens.output} out`);
console.log(`Cost:       $${meta.tokens.cost.toFixed(4)}`);
console.log(`TTFT:       ${meta.ttftMs}ms`);
console.log(`Total:      ${meta.totalMs}ms`);
console.log(`Pipeline:   ${meta.phases.map(p => p.phase).join(' -> ')}`);
console.log(`Safety:     ${meta.safetyGates.map(g => `${g.gate}:${g.result}`).join(', ')}`);
console.log(`Events:     ${events.length} log events captured`);

await limen.shutdown();
