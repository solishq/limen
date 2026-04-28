/**
 * Example 01: Remember and Recall
 *
 * Demonstrates the core loop: store beliefs, recall them, see confidence and decay.
 * No LLM provider needed — knowledge operations are local.
 *
 * Run: npx tsx examples/knowledge/01-remember-recall.ts
 */

import { createLimen, resolveMasterKey } from 'limen-ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dataDir = mkdtempSync(join(tmpdir(), 'limen-ex01-'));

const limen = await createLimen({
  dataDir,
  masterKey: resolveMasterKey(),
});

// Store beliefs about a user
limen.remember('entity:user:alice', 'preference.food', 'loves Thai food');
limen.remember('entity:user:alice', 'preference.editor', 'uses Neovim');
limen.remember('entity:user:alice', 'role.team', 'backend engineer');

// Recall everything about alice
const beliefs = limen.recall('entity:user:alice');
if (beliefs.ok) {
  console.log(`Found ${beliefs.value.length} beliefs about alice:\n`);
  for (const b of beliefs.value) {
    console.log(`  ${b.predicate}: ${b.value}`);
    console.log(`    confidence: ${b.confidence} (effective: ${b.effectiveConfidence.toFixed(2)})`);
    console.log(`    freshness: ${b.freshness}\n`);
  }
}

// Recall with a specific predicate filter
const food = limen.recall('entity:user:alice', 'preference.food');
if (food.ok && food.value.length > 0) {
  console.log(`Alice's food preference: ${food.value[0].value}`);
}

await limen.shutdown();
rmSync(dataDir, { recursive: true, force: true });
