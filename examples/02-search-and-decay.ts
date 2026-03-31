/**
 * Example 02: Search and Decay
 *
 * Demonstrates full-text search (FTS5 + BM25) and how beliefs decay over time.
 * Older beliefs rank lower because effective confidence decreases.
 * No LLM provider needed — knowledge operations are local.
 *
 * Run: npx tsx examples/02-search-and-decay.ts
 */

import { createLimen, resolveMasterKey } from '../src/api/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dataDir = mkdtempSync(join(tmpdir(), 'limen-ex02-'));

const limen = await createLimen({
  dataDir,
  masterKey: resolveMasterKey(),
});

// Store several beliefs across different subjects
limen.remember('entity:project:alpha', 'finding.performance', 'API latency under 50ms at P99');
limen.remember('entity:project:alpha', 'finding.architecture', 'microservices cause deployment complexity');
limen.remember('entity:project:beta', 'finding.performance', 'database queries averaging 200ms');
limen.remember('entity:market:saas', 'observation.note', 'enterprise SaaS buyers prioritize API latency');

// Search across all knowledge
console.log('--- Search: "latency" ---\n');
const results = limen.search('latency');
if (results.ok) {
  console.log(`  Found ${results.value.length} matching beliefs:\n`);
  for (const r of results.value) {
    console.log(`  ${r.belief.subject} — ${r.belief.predicate}`);
    console.log(`    "${r.belief.value}"`);
    console.log(`    confidence: ${r.belief.confidence}, effective: ${r.belief.effectiveConfidence.toFixed(2)}\n`);
  }
}

// Store a belief with temporal anchoring (as if it was known in the past)
limen.remember('entity:project:alpha', 'decision.stack', 'chose PostgreSQL over MongoDB', {
  validAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
});

// Search for architecture-related beliefs
// A belief stored 90 days ago shows decay
console.log('--- Search: "PostgreSQL" (old belief shows decay) ---\n');
const archResults = limen.search('PostgreSQL');
if (archResults.ok) {
  for (const r of archResults.value) {
    console.log(`  "${r.belief.value}"`);
    console.log(`    confidence: ${r.belief.confidence} -> effective: ${r.belief.effectiveConfidence.toFixed(2)} (decayed over 90 days)`);
    console.log(`    freshness: ${r.belief.freshness}\n`);
  }
}

// Show how recall filters by effective (decayed) confidence
console.log('--- Recall with minConfidence: 0.6 ---\n');
const highConf = limen.recall(undefined, undefined, { minConfidence: 0.6 });
if (highConf.ok) {
  console.log(`  ${highConf.value.length} beliefs above 0.6 effective confidence`);
}

await limen.shutdown();
rmSync(dataDir, { recursive: true, force: true });
