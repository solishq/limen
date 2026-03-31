/**
 * Example 03: Governance
 *
 * Demonstrates conflict detection, cascade retraction, batch reflection,
 * and the cognitive health report.
 * No LLM provider needed — knowledge operations are local.
 *
 * Run: npx tsx examples/03-governance.ts
 */

import { createLimen, resolveMasterKey } from '../src/api/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dataDir = mkdtempSync(join(tmpdir(), 'limen-ex03-'));

const limen = await createLimen({
  dataDir,
  masterKey: resolveMasterKey(),
});

// --- Wrongness Containment ---
// Auto-extracted claims are capped at maxAutoConfidence (0.7 by default)
const r1 = limen.remember('entity:market:ev', 'size.2025', '$45 billion', { confidence: 0.95 });
if (r1.ok) {
  console.log(`Stored with confidence: ${r1.value.confidence}`); // 0.7, not 0.95
  console.log('(Capped by maxAutoConfidence — wrongness containment)\n');
}

// --- Conflict Detection ---
// Asserting a different value for the same subject+predicate triggers conflict detection
const r2 = limen.remember('entity:market:ev', 'size.2025', '$52 billion');
if (r2.ok) {
  console.log(`Second claim stored: ${r2.value.claimId}`);
  console.log('Conflict detected automatically — contradicts relationship created\n');
}

// --- Batch Reflection ---
// Store multiple learnings in a single transaction
const reflection = limen.reflect([
  { category: 'decision', statement: 'Chose FTS5 over Elasticsearch for search — single dependency constraint' },
  { category: 'pattern', statement: 'Subject URNs with entity:type:id enable precise recall filtering' },
  { category: 'warning', statement: 'Claims older than 90 days without access should be reviewed' },
  { category: 'finding', statement: 'BM25 ranking combined with confidence produces better results than either alone' },
]);
if (reflection.ok) {
  console.log(`Reflected ${reflection.value.stored} learnings\n`);
}

// --- Relationships ---
// Connect related beliefs
if (r1.ok && r2.ok) {
  // The newer estimate supersedes the older one
  const conn = limen.connect(r2.value.claimId, r1.value.claimId, 'supersedes');
  if (conn.ok) {
    console.log('Connected: $52B supersedes $45B\n');
  }
}

// --- Cognitive Health ---
// Get a full health report of the knowledge base
const health = limen.cognitive.health();
if (health.ok) {
  const h = health.value;
  console.log('--- Cognitive Health Report ---');
  console.log(`  Total active claims: ${h.totalClaims}`);
  console.log(`  Unresolved conflicts: ${h.conflicts.unresolved}`);
  console.log(`  Freshness: fresh=${h.freshness.fresh}, aging=${h.freshness.aging}, stale=${h.freshness.stale}`);
  console.log(`  Confidence: mean=${h.confidence.mean.toFixed(2)}, median=${h.confidence.median.toFixed(2)}`);
  if (h.gaps.length > 0) {
    console.log(`  Gaps detected: ${h.gaps.map(g => g.predicate).join(', ')}`);
  }
  if (h.staleDomains.length > 0) {
    console.log(`  Stale domains: ${h.staleDomains.map(d => d.predicate).join(', ')}`);
  }
}

await limen.shutdown();
rmSync(dataDir, { recursive: true, force: true });
