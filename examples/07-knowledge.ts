import { createLimen } from '../src/api/index.js';
import type { TenantId, AgentId, MissionId, TaskId } from '../src/api/index.js';

const limen = await createLimen();

// The Claim Protocol: structured knowledge with provenance.
// Every claim is tied to a mission, task, and evidence chain.

// ─── Note on IDs ───
// This demo uses `null as unknown as TenantId` (and similar casts) for
// simplicity. In production, these typed IDs come from the session/mission
// context — e.g., the TenantId from your authenticated user, the MissionId
// from limen.missions.create(), the TaskId from the mission's task graph.
// The branded types (TenantId, AgentId, etc.) enforce that you cannot
// accidentally pass a raw string where a validated ID is expected.

const claim1 = limen.claims.assertClaim({
  tenantId: null as unknown as TenantId,
  agentId: 'analyst' as AgentId,
  missionId: 'mission-1' as MissionId,
  taskId: 'task-1' as TaskId,
  subject: 'European EV Market',
  predicate: 'market_size_2025',
  object: '$45.3 billion',
  confidence: 0.87,
  evidence: {
    type: 'artifact',
    artifactId: 'report-001',
    artifactVersion: 1,
    excerpt: 'Market analysis report Section 3.2',
  },
});
console.log('Claim 1:', claim1.ok ? claim1.value.claimId : 'failed');

const claim2 = limen.claims.assertClaim({
  tenantId: null as unknown as TenantId,
  agentId: 'analyst' as AgentId,
  missionId: 'mission-1' as MissionId,
  taskId: 'task-1' as TaskId,
  subject: 'European EV Market',
  predicate: 'growth_rate_2025',
  object: '23% YoY',
  confidence: 0.82,
  evidence: {
    type: 'artifact',
    artifactId: 'report-001',
    artifactVersion: 1,
    excerpt: 'Market analysis report Section 3.4',
  },
});

// Relate claims: market size supports growth rate
if (claim1.ok && claim2.ok) {
  limen.claims.relateClaims({
    tenantId: null as unknown as TenantId,
    agentId: 'analyst' as AgentId,
    missionId: 'mission-1' as MissionId,
    sourceClaimId: claim1.value.claimId,
    targetClaimId: claim2.value.claimId,
    relationship: 'supports',
  });
}

// Query claims by subject
const results = limen.claims.queryClaims({
  tenantId: null as unknown as TenantId,
  subject: 'European EV Market',
});
if (results.ok) {
  console.log(`Found ${results.value.claims.length} claims about European EV Market`);
}

await limen.shutdown();
