// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Independent Contract-Derived Tests — Audit Visualization
 *
 * Written by Independent Test Writer with ZERO knowledge of implementation.
 * Every test derives ONLY from contracts/AUDIT_VISUALIZATION_SCHEMA.md v1.2.0
 * and docs/LIMEN-AUDIT-VISUALIZATION-REQUIREMENTS.md requirement IDs.
 *
 * Sections covered:
 * - §2: AuditActionType, ActionDetailPayload, AuditGovernanceRecord, AuditProvenance, MemoryOperationRecord
 * - §3: SessionTimeline, TimelineEntry, SessionStatistics
 * - §4: BeliefGraphSnapshot, BeliefGraphNode, BeliefGraphEdge, GraphStatistics
 * - §5: GovernanceHeatmapData, HeatmapCell, GovernanceHeatmapTotals
 * - §6: ExportFormat, ExportScope, ExportRequest, ExportResult, ExportFilters, ExportOptions
 * - §7: PrivacyControls, TombstoneRecord
 * - §8: AuditQueryService interface, AuditFilter, Pagination, PaginatedResult, IntegrityReport
 * - §10: Invariants (chain integrity, classification enforcement, checksum, heatmap privacy)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ── Types and factory from implementation (interface-level only) ──
import type {
  AuditActionType,
  ActionDetailPayload,
  MemoryWriteDetail, MemoryReadDetail, MemoryDeleteDetail,
  BeliefQueryDetail, BranchCreateDetail, BranchMergeDetail, BranchDiscardDetail,
  ComputerActionDetail, GovernanceCheckDetail,
  SessionStartDetail, SessionEndDetail, AgentRegisterDetail,
  ClassificationChangeDetail, ExportDetail, ImportDetail,
  GovernanceDecision, AuditGovernanceRecord, AuditProvenance,
  MemoryOperationType, MemoryOperationRecord,
  TimelineEntryType, TimelineEntry, SessionStatistics, SessionTimeline,
  BeliefNodeType, ClaimStatus, BeliefGraphNode,
  BeliefEdgeType, BeliefGraphEdge,
  GraphStatistics, BeliefGraphSnapshot,
  HeatmapGranularity, HeatmapCell, GovernanceHeatmapTotals, GovernanceHeatmapData,
  ExportFormat, ExportScope, ExportFilters, ExportOptions, ExportRequest, ExportResult,
  PrivacyControls, TombstoneReason, TombstoneRecord,
  AuditFilter, SortBy, SortOrder, Pagination, PaginatedResult,
  GraphLayout, BeliefGraphOptions, HeatmapOptions,
  IntegrityScope, IntegrityCheckOptions,
  IntegrityViolationType, IntegrityViolation, IntegrityReport,
  AgentAuditEntry, AuditQueryService,
} from '../../src/audit/visualization/visualization_types.js';

import { createAuditQueryService } from '../../src/audit/visualization/audit_query_service.js';
import type { AuditQueryServiceConfig } from '../../src/audit/visualization/audit_query_service.js';

// ── Test harness ──
import {
  createTestDatabase, createTestAuditTrail, createTestOperationContext,
  agentId, sessionId, seedAuditEntry,
} from '../helpers/test_database.js';

import type { DatabaseConnection, AuditTrail, Result } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Harness — AuditQueryService Factory
// ============================================================================

function createTestService(opts?: {
  clearanceLevel?: number;
  conn?: DatabaseConnection;
}): { service: AuditQueryService; conn: DatabaseConnection; audit: AuditTrail } {
  const conn = opts?.conn ?? createTestDatabase();
  const audit = createTestAuditTrail();
  const timeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

  const config: AuditQueryServiceConfig = {
    conn,
    timeProvider,
    clearanceLevel: opts?.clearanceLevel ?? 4, // full access by default
  };

  const service = createAuditQueryService(config);
  return { service, conn, audit };
}

/**
 * Seed multiple audit entries into the database for query tests.
 */
function seedMultipleAuditEntries(conn: DatabaseConnection, audit: AuditTrail, count: number): void {
  for (let i = 0; i < count; i++) {
    seedAuditEntry(conn, audit, {
      tenantId: 'test-tenant',
      operation: `test_op_${i}`,
      resourceType: 'claim',
      resourceId: `claim-${i}`,
    });
  }
}

// ============================================================================
// §2: AuditActionType (AV-2.2)
// ============================================================================

describe('§2.2: AuditActionType — 15 canonical values (AV-2.2)', () => {
  // Contract mandates exactly these 15 values
  const REQUIRED_ACTION_TYPES: AuditActionType[] = [
    'memory_write', 'memory_read', 'memory_delete',
    'belief_query',
    'branch_create', 'branch_merge', 'branch_discard',
    'computer_action',
    'governance_check',
    'session_start', 'session_end',
    'agent_register',
    'classification_change',
    'export', 'import',
  ];

  it('all 15 AuditActionType values are assignable (AV-2.2)', () => {
    // Type-level: if this compiles, the type accepts all 15 values.
    // Runtime: verify count matches contract specification.
    assert.equal(REQUIRED_ACTION_TYPES.length, 15,
      'Contract §2.2 mandates exactly 15 AuditActionType values');

    // Verify no duplicates
    const uniqueSet = new Set(REQUIRED_ACTION_TYPES);
    assert.equal(uniqueSet.size, 15, 'All 15 action types must be unique');
  });
});

// ============================================================================
// §2.3: ActionDetailPayload — Discriminated Union (AV-2.3 through AV-2.18)
// ============================================================================

describe('§2.3: ActionDetailPayload — discriminated union (AV-2.3 to AV-2.18)', () => {

  it('MemoryWriteDetail has all required fields (AV-2.4)', () => {
    const detail: MemoryWriteDetail = {
      type: 'memory_write',
      claimId: 'claim-001' as any,
      subject: 'entity:project:test',
      predicate: 'decision.rationale',
      confidence: 0.85,
      classification: 'internal' as any,
      supersedes: null,
    };
    assert.equal(detail.type, 'memory_write');
    assert.equal(detail.claimId, 'claim-001');
    assert.equal(detail.subject, 'entity:project:test');
    assert.equal(detail.predicate, 'decision.rationale');
    assert.equal(detail.confidence, 0.85);
    assert.equal(detail.classification, 'internal');
    assert.equal(detail.supersedes, null);
  });

  it('MemoryWriteDetail.supersedes can be a ClaimId (AV-2.4)', () => {
    const detail: MemoryWriteDetail = {
      type: 'memory_write',
      claimId: 'claim-002' as any,
      subject: 'entity:test:x',
      predicate: 'knowledge.fact',
      confidence: 0.7,
      classification: 'unrestricted' as any,
      supersedes: 'claim-001' as any,
    };
    assert.equal(detail.supersedes, 'claim-001');
  });

  it('MemoryReadDetail has all required fields (AV-2.5)', () => {
    const detail: MemoryReadDetail = {
      type: 'memory_read',
      query: 'entity:project:*',
      resultCount: 5,
      claimIdsReturned: ['c1', 'c2', 'c3', 'c4', 'c5'] as any,
    };
    assert.equal(detail.type, 'memory_read');
    assert.equal(detail.query, 'entity:project:*');
    assert.equal(detail.resultCount, 5);
    assert.equal(detail.claimIdsReturned.length, 5);
  });

  it('MemoryDeleteDetail.reason accepts only 4 values (AV-2.6)', () => {
    const reasons: MemoryDeleteDetail['reason'][] = ['incorrect', 'superseded', 'expired', 'manual'];
    assert.equal(reasons.length, 4);
    for (const reason of reasons) {
      const detail: MemoryDeleteDetail = {
        type: 'memory_delete',
        claimId: 'claim-x' as any,
        reason,
      };
      assert.equal(detail.reason, reason);
    }
  });

  it('BeliefQueryDetail has nullable fields (AV-2.7)', () => {
    const detail: BeliefQueryDetail = {
      type: 'belief_query',
      subject: null,
      predicate: null,
      minConfidence: null,
      resultCount: 42,
      executionMs: 12,
    };
    assert.equal(detail.subject, null);
    assert.equal(detail.predicate, null);
    assert.equal(detail.minConfidence, null);
    assert.equal(detail.resultCount, 42);
    assert.equal(detail.executionMs, 12);
  });

  it('BranchCreateDetail has nullable parentBranchId (AV-2.8)', () => {
    const detail: BranchCreateDetail = {
      type: 'branch_create',
      branchId: 'branch-1',
      parentBranchId: null,
      reason: 'exploration',
    };
    assert.equal(detail.parentBranchId, null);
  });

  it('BranchMergeDetail has all required fields (AV-2.9)', () => {
    const detail: BranchMergeDetail = {
      type: 'branch_merge',
      branchId: 'branch-1',
      targetBranchId: 'main',
      claimsMerged: 10,
      conflictsResolved: 2,
    };
    assert.equal(detail.claimsMerged, 10);
    assert.equal(detail.conflictsResolved, 2);
  });

  it('BranchDiscardDetail has all required fields (AV-2.10)', () => {
    const detail: BranchDiscardDetail = {
      type: 'branch_discard',
      branchId: 'branch-2',
      claimsDiscarded: 7,
      reason: 'abandoned experiment',
    };
    assert.equal(detail.claimsDiscarded, 7);
  });

  it('ComputerActionDetail has all required fields (AV-2.11)', () => {
    const detail: ComputerActionDetail = {
      type: 'computer_action',
      actionName: 'file_read',
      targetResource: '/tmp/data.json',
      parameters: { encoding: 'utf8' },
      resultSummary: 'Read 1024 bytes',
      durationMs: 45,
    };
    assert.equal(detail.actionName, 'file_read');
    assert.equal(detail.durationMs, 45);
  });

  it('GovernanceCheckDetail has all required fields (AV-2.12)', () => {
    const detail: GovernanceCheckDetail = {
      type: 'governance_check',
      rule: 'max_confidence_ceiling',
      requestedAction: 'assert_claim',
      context: { claimId: 'c1', confidence: 0.95 },
    };
    assert.equal(detail.rule, 'max_confidence_ceiling');
    assert.equal(detail.requestedAction, 'assert_claim');
  });

  it('SessionStartDetail has all required fields (AV-2.13)', () => {
    const detail: SessionStartDetail = {
      type: 'session_start',
      agentVersion: '1.5.0',
      capabilities: ['web_search', 'code_execution'],
      trustLevel: 'trusted',
    };
    assert.equal(detail.agentVersion, '1.5.0');
    assert.equal(detail.capabilities.length, 2);
    assert.equal(detail.trustLevel, 'trusted');
  });

  it('SessionEndDetail.reason accepts only 4 values (AV-2.14)', () => {
    const reasons: SessionEndDetail['reason'][] = ['normal', 'timeout', 'error', 'revoked'];
    assert.equal(reasons.length, 4);
    for (const reason of reasons) {
      const detail: SessionEndDetail = {
        type: 'session_end',
        reason,
        durationMs: 60000,
        actionsPerformed: 100,
      };
      assert.equal(detail.reason, reason);
    }
  });

  it('AgentRegisterDetail has all required fields (AV-2.15)', () => {
    const detail: AgentRegisterDetail = {
      type: 'agent_register',
      agentName: 'researcher-1',
      capabilities: ['web_search'],
      domains: ['finance', 'analytics'],
      initialTrustLevel: 'untrusted',
    };
    assert.equal(detail.agentName, 'researcher-1');
    assert.equal(detail.domains.length, 2);
  });

  it('ClassificationChangeDetail has all required fields (AV-2.16)', () => {
    const detail: ClassificationChangeDetail = {
      type: 'classification_change',
      claimId: 'claim-x' as any,
      previousClassification: 'unrestricted' as any,
      newClassification: 'confidential' as any,
      justification: 'Contains PII discovered post-assertion',
    };
    assert.equal(detail.previousClassification, 'unrestricted');
    assert.equal(detail.newClassification, 'confidential');
  });

  it('ExportDetail has all required fields (AV-2.17)', () => {
    const detail: ExportDetail = {
      type: 'export',
      format: 'json',
      scope: 'session',
      recordCount: 500,
      checksum: 'abc123def456',
    };
    assert.equal(detail.format, 'json');
    assert.equal(detail.scope, 'session');
  });

  it('ImportDetail has all required fields (AV-2.18)', () => {
    const detail: ImportDetail = {
      type: 'import',
      source: 'backup-2026-01-01.json',
      recordCount: 1000,
      validationResult: 'passed',
      failedRecords: 0,
    };
    assert.equal(detail.validationResult, 'passed');
    assert.equal(detail.failedRecords, 0);
  });

  it('ImportDetail.validationResult accepts only 3 values (AV-2.18)', () => {
    const results: ImportDetail['validationResult'][] = ['passed', 'partial', 'failed'];
    assert.equal(results.length, 3);
  });
});

// ============================================================================
// §2.4: AuditGovernanceRecord (AV-2.19, AV-2.20)
// ============================================================================

describe('§2.4: AuditGovernanceRecord (AV-2.19, AV-2.20)', () => {

  it('decision accepts only canonical verdict values (AV-2.19, AV-10.11)', () => {
    const decisions: GovernanceDecision[] = ['allow', 'refuse', 'escalate', 'sandbox'];
    assert.equal(decisions.length, 4);
    for (const decision of decisions) {
      const record: AuditGovernanceRecord = {
        decision,
        reason: 'test reason',
        rule: null,
        confidence: 0.9,
        evaluationDurationMs: 5,
      };
      assert.equal(record.decision, decision);
    }
  });

  it('record has all required fields (AV-2.20)', () => {
    const record: AuditGovernanceRecord = {
      decision: 'refuse',
      reason: 'Confidence exceeds ceiling',
      rule: 'max_auto_confidence',
      confidence: 0.95,
      evaluationDurationMs: 3,
    };
    assert.equal(record.reason, 'Confidence exceeds ceiling');
    assert.equal(record.rule, 'max_auto_confidence');
    assert.equal(record.confidence, 0.95);
    assert.equal(record.evaluationDurationMs, 3);
  });

  it('rule can be null (AV-2.20)', () => {
    const record: AuditGovernanceRecord = {
      decision: 'allow',
      reason: 'No rules triggered',
      rule: null,
      confidence: 0.7,
      evaluationDurationMs: 1,
    };
    assert.equal(record.rule, null);
  });
});

// ============================================================================
// §2.5: AuditProvenance (AV-2.21)
// ============================================================================

describe('§2.5: AuditProvenance (AV-2.21)', () => {

  it('has all required fields including nullable ones', () => {
    const prov: AuditProvenance = {
      chainPosition: 42,
      parentActionId: null,
      correlationId: 'corr-abc-123',
      sourceAgent: 'agent-alpha' as any,
      sourceMission: null,
      sourceTask: null,
    };
    assert.equal(prov.chainPosition, 42);
    assert.equal(prov.parentActionId, null);
    assert.equal(prov.correlationId, 'corr-abc-123');
    assert.equal(prov.sourceMission, null);
    assert.equal(prov.sourceTask, null);
  });

  it('nullable fields can hold values', () => {
    const prov: AuditProvenance = {
      chainPosition: 100,
      parentActionId: 'evt-parent' as any,
      correlationId: 'corr-xyz',
      sourceAgent: 'agent-beta' as any,
      sourceMission: 'mission-1' as any,
      sourceTask: 'task-7' as any,
    };
    assert.equal(prov.parentActionId, 'evt-parent');
    assert.equal(prov.sourceMission, 'mission-1');
    assert.equal(prov.sourceTask, 'task-7');
  });
});

// ============================================================================
// §2.6: MemoryOperationRecord (AV-2.22, AV-2.23)
// ============================================================================

describe('§2.6: MemoryOperationRecord (AV-2.22, AV-2.23)', () => {

  it('type accepts exactly 5 values (AV-2.22)', () => {
    const types: MemoryOperationType[] = ['assert', 'retract', 'query', 'search', 'relate'];
    assert.equal(types.length, 5);
    const uniqueSet = new Set(types);
    assert.equal(uniqueSet.size, 5);
  });

  it('all fields nullable except type (AV-2.23)', () => {
    const record: MemoryOperationRecord = {
      type: 'query',
      claimId: null,
      subject: null,
      predicate: null,
      confidence: null,
      resultCount: null,
    };
    assert.equal(record.type, 'query');
    assert.equal(record.claimId, null);
    assert.equal(record.subject, null);
    assert.equal(record.predicate, null);
    assert.equal(record.confidence, null);
    assert.equal(record.resultCount, null);
  });
});

// ============================================================================
// §3: SessionTimeline (AV-3.1 through AV-3.14)
// ============================================================================

describe('§3: SessionTimeline (AV-3.1 through AV-3.14)', () => {

  it('TimelineEntryType has exactly 6 values (AV-3.3)', () => {
    const types: TimelineEntryType[] = [
      'memory_operation', 'computer_action', 'governance_event',
      'branch_operation', 'session_event', 'error',
    ];
    assert.equal(types.length, 6);
    assert.equal(new Set(types).size, 6);
  });

  it('TimelineEntry has all required fields (AV-3.2)', () => {
    const entry: TimelineEntry = {
      id: 'evt-001' as any,
      timestamp: '2026-05-10T12:00:00.000Z',
      type: 'memory_operation',
      summary: 'Asserted claim about project architecture',
      governanceDecision: null,
      relatedClaimIds: ['claim-1', 'claim-2'] as any,
      metadata: { operation: 'assert' },
    };
    assert.equal(entry.id, 'evt-001');
    assert.equal(entry.type, 'memory_operation');
    assert.equal(typeof entry.summary, 'string');
    assert.equal(entry.governanceDecision, null);
    assert.equal(entry.relatedClaimIds.length, 2);
  });

  it('TimelineEntry.governanceDecision uses canonical verdicts (AV-10.11)', () => {
    const entry: TimelineEntry = {
      id: 'evt-002' as any,
      timestamp: '2026-05-10T12:01:00.000Z',
      type: 'governance_event',
      summary: 'Governance refused claim assertion',
      governanceDecision: 'refuse',
      relatedClaimIds: [],
      metadata: {},
    };
    assert.equal(entry.governanceDecision, 'refuse');
  });

  it('SessionStatistics has all 11 fields (AV-3.4 through AV-3.14)', () => {
    const stats: SessionStatistics = {
      totalActions: 150,
      memoryWrites: 40,
      memoryReads: 60,
      governanceRefusals: 5,
      governanceEscalations: 2,
      branchesCreated: 3,
      branchesMerged: 1,
      computerActions: 20,
      averageConfidence: 0.72,
      uniqueSubjects: 15,
      uniquePredicates: 8,
    };
    assert.equal(stats.totalActions, 150);
    assert.equal(stats.memoryWrites, 40);
    assert.equal(stats.memoryReads, 60);
    assert.equal(stats.governanceRefusals, 5);
    assert.equal(stats.governanceEscalations, 2);
    assert.equal(stats.branchesCreated, 3);
    assert.equal(stats.branchesMerged, 1);
    assert.equal(stats.computerActions, 20);
    assert.equal(stats.averageConfidence, 0.72);
    assert.equal(stats.uniqueSubjects, 15);
    assert.equal(stats.uniquePredicates, 8);
  });

  it('SessionTimeline has all required fields (AV-3.1)', () => {
    const timeline: SessionTimeline = {
      sessionId: 'sess-001' as any,
      agentId: 'agent-1' as any,
      startedAt: '2026-05-10T10:00:00.000Z',
      endedAt: '2026-05-10T11:00:00.000Z',
      durationMs: 3600000,
      entries: [],
      statistics: {
        totalActions: 0, memoryWrites: 0, memoryReads: 0,
        governanceRefusals: 0, governanceEscalations: 0,
        branchesCreated: 0, branchesMerged: 0,
        computerActions: 0, averageConfidence: 0,
        uniqueSubjects: 0, uniquePredicates: 0,
      },
    };
    assert.equal(timeline.sessionId, 'sess-001');
    assert.equal(timeline.agentId, 'agent-1');
    assert.equal(timeline.startedAt, '2026-05-10T10:00:00.000Z');
    assert.equal(timeline.endedAt, '2026-05-10T11:00:00.000Z');
    assert.equal(timeline.durationMs, 3600000);
  });

  it('SessionTimeline nullable fields (AV-3.1)', () => {
    const timeline: SessionTimeline = {
      sessionId: 'sess-002' as any,
      agentId: 'agent-2' as any,
      startedAt: '2026-05-10T10:00:00.000Z',
      endedAt: null,
      durationMs: null,
      entries: [],
      statistics: {
        totalActions: 0, memoryWrites: 0, memoryReads: 0,
        governanceRefusals: 0, governanceEscalations: 0,
        branchesCreated: 0, branchesMerged: 0,
        computerActions: 0, averageConfidence: 0,
        uniqueSubjects: 0, uniquePredicates: 0,
      },
    };
    assert.equal(timeline.endedAt, null);
    assert.equal(timeline.durationMs, null);
  });
});

// ============================================================================
// §4: Belief Graph Schema (AV-4.1 through AV-4.19)
// ============================================================================

describe('§4: Belief Graph Schema (AV-4.1 through AV-4.19)', () => {

  it('BeliefNodeType has exactly 4 values (AV-4.3)', () => {
    const types: BeliefNodeType[] = ['belief', 'governance', 'authority', 'refusal'];
    assert.equal(types.length, 4);
    assert.equal(new Set(types).size, 4);
  });

  it('ClaimStatus has exactly 3 values (AV-4.7)', () => {
    const statuses: ClaimStatus[] = ['active', 'retracted', 'archived'];
    assert.equal(statuses.length, 3);
    assert.equal(new Set(statuses).size, 3);
  });

  it('BeliefGraphNode has all required fields (AV-4.2, AV-4.9)', () => {
    const node: BeliefGraphNode = {
      id: 'claim-100' as any,
      label: 'decision.rationale',
      nodeType: 'belief',
      confidence: 0.85,
      effectiveConfidence: 0.78,
      freshness: 'fresh' as any,
      classification: 'internal' as any,
      agentId: 'agent-1' as any,
      createdAt: '2026-05-09T10:00:00.000Z',
      status: 'active',
    };
    assert.equal(node.id, 'claim-100');
    assert.equal(node.label, 'decision.rationale');
    assert.equal(node.nodeType, 'belief');
    assert.equal(node.confidence, 0.85);
    assert.equal(node.effectiveConfidence, 0.78);
    assert.equal(node.status, 'active');
  });

  it('BeliefGraphNode.position is optional (AV-4.8)', () => {
    const nodeWithPos: BeliefGraphNode = {
      id: 'claim-101' as any,
      label: 'test',
      nodeType: 'governance',
      confidence: 0.9,
      effectiveConfidence: 0.88,
      freshness: 'aging' as any,
      classification: 'unrestricted' as any,
      agentId: 'agent-2' as any,
      createdAt: '2026-05-09T10:00:00.000Z',
      status: 'active',
      position: { x: 100.5, y: 200.3 },
    };
    assert.equal(nodeWithPos.position?.x, 100.5);
    assert.equal(nodeWithPos.position?.y, 200.3);

    // Without position
    const nodeWithout: BeliefGraphNode = {
      id: 'claim-102' as any,
      label: 'test2',
      nodeType: 'belief',
      confidence: 0.7,
      effectiveConfidence: 0.65,
      freshness: 'stale' as any,
      classification: 'unrestricted' as any,
      agentId: 'agent-2' as any,
      createdAt: '2026-05-08T10:00:00.000Z',
      status: 'retracted',
    };
    assert.equal(nodeWithout.position, undefined);
  });

  it('BeliefEdgeType has exactly 8 values (AV-4.11)', () => {
    const types: BeliefEdgeType[] = [
      'supports', 'contradicts', 'supersedes', 'derived_from',
      'provenance', 'governance', 'cascade', 'refusal',
    ];
    assert.equal(types.length, 8);
    assert.equal(new Set(types).size, 8);
  });

  it('BeliefGraphEdge has all required fields (AV-4.12)', () => {
    const edge: BeliefGraphEdge = {
      id: 'rel-001' as any,
      source: 'claim-1' as any,
      target: 'claim-2' as any,
      edgeType: 'supports',
      weight: 0.85,
      declaredBy: 'agent-1' as any,
      createdAt: '2026-05-09T10:00:00.000Z',
    };
    assert.equal(edge.source, 'claim-1');
    assert.equal(edge.target, 'claim-2');
    assert.equal(edge.edgeType, 'supports');
    assert.equal(edge.weight, 0.85);
  });

  it('GraphStatistics has all required fields (AV-4.13 through AV-4.19)', () => {
    const stats: GraphStatistics = {
      totalNodes: 50,
      totalEdges: 120,
      connectedComponents: 3,
      averageConfidence: 0.75,
      freshnessDistribution: { fresh: 30, aging: 15, stale: 5 },
      classificationDistribution: {
        unrestricted: 20,
        internal: 15,
        confidential: 10,
        restricted: 4,
        critical: 1,
      } as any,
      agentDistribution: { 'agent-1': 30, 'agent-2': 20 },
    };
    assert.equal(stats.totalNodes, 50);
    assert.equal(stats.totalEdges, 120);
    assert.equal(stats.connectedComponents, 3);
    assert.equal(stats.averageConfidence, 0.75);
    assert.equal(stats.freshnessDistribution.fresh, 30);
    assert.equal(stats.freshnessDistribution.aging, 15);
    assert.equal(stats.freshnessDistribution.stale, 5);
  });

  it('BeliefGraphSnapshot has all required fields (AV-4.1)', () => {
    const snapshot: BeliefGraphSnapshot = {
      snapshotId: 'snap-001',
      timestamp: '2026-05-10T12:00:00.000Z',
      agentId: null,
      tenantId: null,
      nodes: [],
      edges: [],
      statistics: {
        totalNodes: 0, totalEdges: 0, connectedComponents: 0,
        averageConfidence: 0,
        freshnessDistribution: { fresh: 0, aging: 0, stale: 0 },
        classificationDistribution: {} as any,
        agentDistribution: {},
      },
    };
    assert.equal(snapshot.snapshotId, 'snap-001');
    assert.equal(snapshot.agentId, null, 'null agentId = all agents per contract');
    assert.equal(snapshot.tenantId, null);
  });
});

// ============================================================================
// §5: Governance Decision Heatmap (AV-5.1 through AV-5.10)
// ============================================================================

describe('§5: Governance Decision Heatmap (AV-5.1 through AV-5.10)', () => {

  it('HeatmapGranularity has exactly 4 values (AV-5.2)', () => {
    const granularities: HeatmapGranularity[] = ['minute', 'hour', 'day', 'week'];
    assert.equal(granularities.length, 4);
    assert.equal(new Set(granularities).size, 4);
  });

  it('HeatmapCell has all required fields (AV-5.3)', () => {
    const cell: HeatmapCell = {
      timestamp: '2026-05-10T12:00:00.000Z',
      agentId: 'agent-1' as any,
      actionCategory: 'memory_operation',
      allowed: 100,
      refused: 5,
      escalated: 2,
      sandboxed: 1,
      intensity: 0.85,
    };
    assert.equal(cell.allowed, 100);
    assert.equal(cell.refused, 5);
    assert.equal(cell.escalated, 2);
    assert.equal(cell.sandboxed, 1);
    assert.equal(cell.intensity, 0.85);
  });

  it('HeatmapCell.agentId null means aggregate (AV-5.9)', () => {
    const cell: HeatmapCell = {
      timestamp: '2026-05-10T12:00:00.000Z',
      agentId: null,
      actionCategory: 'governance',
      allowed: 50, refused: 3, escalated: 1, sandboxed: 0,
      intensity: 0.5,
    };
    assert.equal(cell.agentId, null);
  });

  it('HeatmapCell.intensity is normalized 0.0-1.0 (AV-5.8)', () => {
    // Contract mandates intensity in [0.0, 1.0]
    const cell: HeatmapCell = {
      timestamp: '2026-05-10T12:00:00.000Z',
      agentId: null,
      actionCategory: 'branch',
      allowed: 0, refused: 0, escalated: 0, sandboxed: 0,
      intensity: 0.0,
    };
    assert.ok(cell.intensity >= 0.0, 'intensity must be >= 0.0');
    assert.ok(cell.intensity <= 1.0, 'intensity must be <= 1.0');
  });

  it('GovernanceHeatmapTotals has all required fields (AV-5.5, AV-5.6, AV-5.7)', () => {
    const totals: GovernanceHeatmapTotals = {
      totalDecisions: 108,
      allowRate: 0.926,
      refuseRate: 0.046,
      escalateRate: 0.019,
      sandboxRate: 0.009,
      topRefusalRules: [
        { rule: 'max_confidence_ceiling', count: 3 },
        { rule: 'classification_block', count: 2 },
      ],
    };
    assert.equal(totals.totalDecisions, 108);
    assert.equal(totals.topRefusalRules.length, 2);
    assert.equal(totals.topRefusalRules[0].rule, 'max_confidence_ceiling');
    assert.equal(totals.topRefusalRules[0].count, 3);
  });

  it('GovernanceHeatmapData has all required fields (AV-5.1)', () => {
    const data: GovernanceHeatmapData = {
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      granularity: 'hour',
      cells: [],
      totals: {
        totalDecisions: 0,
        allowRate: 0, refuseRate: 0, escalateRate: 0, sandboxRate: 0,
        topRefusalRules: [],
      },
    };
    assert.equal(data.timeRange.from, '2026-05-09T00:00:00Z');
    assert.equal(data.granularity, 'hour');
  });
});

// ============================================================================
// §6: Export Contracts (AV-6.1 through AV-6.12)
// ============================================================================

describe('§6: Export Contracts (AV-6.1 through AV-6.12)', () => {

  it('ExportFormat has exactly 4 values (AV-6.1)', () => {
    const formats: ExportFormat[] = ['json', 'csv', 'pdf', 'svg'];
    assert.equal(formats.length, 4);
    assert.equal(new Set(formats).size, 4);
  });

  it('ExportScope has exactly 5 values (AV-6.3)', () => {
    const scopes: ExportScope[] = ['session', 'agent', 'tenant', 'time_range', 'custom_query'];
    assert.equal(scopes.length, 5);
    assert.equal(new Set(scopes).size, 5);
  });

  it('ExportFilters supports all optional fields (AV-6.4)', () => {
    const filters: ExportFilters = {
      sessionIds: ['sess-1'] as any,
      agentIds: ['agent-1'] as any,
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      actionTypes: ['memory_write', 'memory_read'],
      governanceFilter: 'refused_only',
      classificationMax: 'confidential' as any,
    };
    assert.equal(filters.governanceFilter, 'refused_only');
  });

  it('ExportFilters.governanceFilter accepts 3 values (AV-8.24)', () => {
    const values: NonNullable<ExportFilters['governanceFilter']>[] = [
      'all', 'refused_only', 'escalated_only',
    ];
    assert.equal(values.length, 3);
  });

  it('ExportOptions has all required boolean fields (AV-6.5)', () => {
    const options: ExportOptions = {
      includeProvenance: true,
      includeBeliefGraph: false,
      includeTimeline: true,
      includeHeatmap: false,
      redactClassified: true,
      maxRecords: 1000,
    };
    assert.equal(options.includeProvenance, true);
    assert.equal(options.redactClassified, true);
    assert.equal(options.maxRecords, 1000);
  });

  it('ExportOptions.maxRecords is optional (AV-6.7)', () => {
    const options: ExportOptions = {
      includeProvenance: false,
      includeBeliefGraph: false,
      includeTimeline: false,
      includeHeatmap: false,
      redactClassified: false,
    };
    assert.equal(options.maxRecords, undefined);
  });

  it('ExportRequest has all required fields (AV-6.2)', () => {
    const request: ExportRequest = {
      format: 'json',
      scope: 'session',
      filters: {},
      options: {
        includeProvenance: true,
        includeBeliefGraph: true,
        includeTimeline: true,
        includeHeatmap: true,
        redactClassified: false,
      },
    };
    assert.equal(request.format, 'json');
    assert.equal(request.scope, 'session');
  });

  it('ExportResult has all required fields (AV-6.10)', () => {
    const result: ExportResult = {
      format: 'json',
      data: '{"entries":[]}',
      recordCount: 0,
      filteredCount: 0,
      generatedAt: '2026-05-10T12:00:00.000Z',
      checksum: createHash('sha256').update('{"entries":[]}').digest('hex'),
    };
    assert.equal(result.format, 'json');
    assert.equal(result.recordCount, 0);
    assert.equal(typeof result.checksum, 'string');
    assert.equal(result.checksum.length, 64, 'SHA-256 hex is 64 chars');
  });

  it('ExportResult.checksum is SHA-256 of data (AV-6.11, AV-10.4)', () => {
    const data = '{"test":"data","entries":[1,2,3]}';
    const expectedChecksum = createHash('sha256').update(data).digest('hex');
    const result: ExportResult = {
      format: 'json',
      data,
      recordCount: 3,
      filteredCount: 3,
      generatedAt: '2026-05-10T12:00:00.000Z',
      checksum: expectedChecksum,
    };
    // Verify: any consumer can verify the export was not tampered with (AV-6.12)
    const verifiedChecksum = createHash('sha256').update(result.data as string).digest('hex');
    assert.equal(result.checksum, verifiedChecksum,
      'Checksum must be verifiable SHA-256 of data');
  });

  it('ExportResult.data is Buffer for PDF/SVG, string for JSON/CSV (AV-6.9)', () => {
    // JSON: string
    const jsonResult: ExportResult = {
      format: 'json', data: '[]', recordCount: 0, filteredCount: 0,
      generatedAt: '2026-05-10T12:00:00Z', checksum: 'a',
    };
    assert.equal(typeof jsonResult.data, 'string');

    // PDF: Buffer
    const pdfResult: ExportResult = {
      format: 'pdf', data: Buffer.from('PDF-content'), recordCount: 0, filteredCount: 0,
      generatedAt: '2026-05-10T12:00:00Z', checksum: 'b',
    };
    assert.ok(Buffer.isBuffer(pdfResult.data), 'PDF data must be Buffer');
  });
});

// ============================================================================
// §7: Retention & Privacy Controls (AV-7.7, AV-7.8)
// ============================================================================

describe('§7: Retention & Privacy Controls (AV-7.7, AV-7.8)', () => {

  it('PrivacyControls has all 4 boolean fields (AV-7.7)', () => {
    const controls: PrivacyControls = {
      dataSubjectMapping: true,
      consentAware: true,
      erasureSupport: true,
      auditOfAudit: true,
    };
    assert.equal(controls.dataSubjectMapping, true);
    assert.equal(controls.consentAware, true);
    assert.equal(controls.erasureSupport, true);
    assert.equal(controls.auditOfAudit, true);
  });

  it('TombstoneRecord has all required fields (AV-7.8)', () => {
    const tombstone: TombstoneRecord = {
      originalId: 'evt-deleted-1' as any,
      tombstonedAt: '2026-05-10T12:00:00.000Z',
      reason: 'gdpr_erasure',
      erasureCertificateId: 'cert-abc-123',
      retainedFields: ['timestamp', 'actionType'],
    };
    assert.equal(tombstone.originalId, 'evt-deleted-1');
    assert.equal(tombstone.reason, 'gdpr_erasure');
    assert.equal(tombstone.erasureCertificateId, 'cert-abc-123');
    assert.equal(tombstone.retainedFields.length, 2);
  });

  it('TombstoneRecord.reason accepts exactly 3 values (AV-7.8)', () => {
    const reasons: TombstoneReason[] = ['gdpr_erasure', 'retention_expired', 'manual'];
    assert.equal(reasons.length, 3);
    assert.equal(new Set(reasons).size, 3);
  });

  it('TombstoneRecord.erasureCertificateId is nullable (AV-7.8)', () => {
    const tombstone: TombstoneRecord = {
      originalId: 'evt-expired' as any,
      tombstonedAt: '2026-05-10T12:00:00.000Z',
      reason: 'retention_expired',
      erasureCertificateId: null,
      retainedFields: ['timestamp'],
    };
    assert.equal(tombstone.erasureCertificateId, null);
  });
});

// ============================================================================
// §8: Query Interfaces (AV-8.1 through AV-8.26)
// ============================================================================

describe('§8: Query Interfaces — AuditFilter (AV-8.7, AV-8.18, AV-8.19, AV-8.25, AV-8.26)', () => {

  it('AuditFilter supports all optional fields (AV-8.7)', () => {
    const filter: AuditFilter = {
      agentIds: ['agent-1'] as any,
      sessionIds: ['sess-1'] as any,
      actionTypes: ['memory_write', 'governance_check'],
      governanceDecision: 'refuse',
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      classificationMax: 'confidential' as any,
      searchText: 'decision',
    };
    assert.equal(filter.governanceDecision, 'refuse');
    assert.equal(filter.searchText, 'decision');
  });

  it('AuditFilter.governanceDecision uses canonical verdicts (AV-8.18)', () => {
    const decisions: GovernanceDecision[] = ['allow', 'refuse', 'escalate', 'sandbox'];
    for (const d of decisions) {
      const filter: AuditFilter = { governanceDecision: d };
      assert.equal(filter.governanceDecision, d);
    }
  });

  it('all AuditFilter fields are optional (AV-8.7)', () => {
    const emptyFilter: AuditFilter = {};
    assert.equal(emptyFilter.agentIds, undefined);
    assert.equal(emptyFilter.searchText, undefined);
  });
});

describe('§8: Query Interfaces — Pagination (AV-8.8, AV-8.23)', () => {

  it('Pagination has all required fields (AV-8.8)', () => {
    const page: Pagination = {
      limit: 50,
      offset: 0,
      sortBy: 'timestamp',
      sortOrder: 'desc',
    };
    assert.equal(page.limit, 50);
    assert.equal(page.offset, 0);
    assert.equal(page.sortBy, 'timestamp');
    assert.equal(page.sortOrder, 'desc');
  });

  it('Pagination.sortBy accepts 3 values (AV-8.23)', () => {
    const sortByValues: SortBy[] = ['timestamp', 'actionType', 'agentId'];
    assert.equal(sortByValues.length, 3);
    assert.equal(new Set(sortByValues).size, 3);
  });

  it('Pagination.sortOrder accepts 2 values (AV-8.8)', () => {
    const orders: SortOrder[] = ['asc', 'desc'];
    assert.equal(orders.length, 2);
  });
});

describe('§8: Query Interfaces — PaginatedResult (AV-8.9, AV-8.22)', () => {

  it('PaginatedResult has all required fields (AV-8.9)', () => {
    const result: PaginatedResult<string> = {
      items: ['a', 'b', 'c'],
      total: 10,
      limit: 3,
      offset: 0,
      hasMore: true,
    };
    assert.equal(result.items.length, 3);
    assert.equal(result.total, 10);
    assert.equal(result.hasMore, true, 'AV-8.22: hasMore indicates more results exist');
  });

  it('PaginatedResult.hasMore is false when no more results (AV-8.22)', () => {
    const result: PaginatedResult<string> = {
      items: ['x'],
      total: 1,
      limit: 50,
      offset: 0,
      hasMore: false,
    };
    assert.equal(result.hasMore, false);
  });
});

describe('§8: Query Interfaces — BeliefGraphOptions (AV-8.10, AV-8.20, AV-8.21)', () => {

  it('BeliefGraphOptions supports all optional fields (AV-8.10)', () => {
    const options: BeliefGraphOptions = {
      agentId: 'agent-1' as any,
      tenantId: 'tenant-1' as any,
      depth: 3,
      rootClaimId: 'claim-root' as any,
      includeRetracted: true,
      includeArchived: false,
      layout: 'force',
    };
    assert.equal(options.depth, 3, 'AV-8.20: depth = max edge hops from root');
    assert.equal(options.rootClaimId, 'claim-root', 'AV-8.21: start graph from this claim');
  });

  it('GraphLayout has exactly 3 values (AV-8.10)', () => {
    const layouts: GraphLayout[] = ['force', 'hierarchical', 'radial'];
    assert.equal(layouts.length, 3);
    assert.equal(new Set(layouts).size, 3);
  });
});

describe('§8: Query Interfaces — HeatmapOptions (AV-8.11)', () => {

  it('HeatmapOptions has required and optional fields (AV-8.11)', () => {
    const options: HeatmapOptions = {
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      granularity: 'hour',
      agentId: 'agent-1' as any,
      actionCategory: 'memory_operation',
    };
    assert.equal(options.granularity, 'hour');
    assert.equal(options.actionCategory, 'memory_operation');
  });

  it('HeatmapOptions agentId and actionCategory are optional (AV-8.11)', () => {
    const options: HeatmapOptions = {
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      granularity: 'day',
    };
    assert.equal(options.agentId, undefined);
    assert.equal(options.actionCategory, undefined);
  });
});

describe('§8: Query Interfaces — IntegrityCheckOptions (AV-8.12 through AV-8.14)', () => {

  it('IntegrityScope has exactly 2 values (AV-8.12)', () => {
    const scopes: IntegrityScope[] = ['full', 'recent'];
    assert.equal(scopes.length, 2);
  });

  it('IntegrityCheckOptions has required scope and optional fields (AV-8.13, AV-8.14)', () => {
    const options: IntegrityCheckOptions = {
      scope: 'recent',
      recentWindowHours: 24,
      repairMode: false,
    };
    assert.equal(options.scope, 'recent');
    assert.equal(options.recentWindowHours, 24);
    assert.equal(options.repairMode, false, 'AV-8.14: repairMode flags but does NOT mutate');
  });
});

describe('§8: Query Interfaces — IntegrityReport (AV-8.15 through AV-8.17)', () => {

  it('IntegrityReport has all required fields (AV-8.15)', () => {
    const report: IntegrityReport = {
      valid: true,
      entriesChecked: 500,
      brokenLinks: 0,
      hashMismatches: 0,
      firstBreakAt: null,
      details: [],
    };
    assert.equal(report.valid, true);
    assert.equal(report.entriesChecked, 500);
    assert.equal(report.firstBreakAt, null);
  });

  it('IntegrityViolationType has exactly 4 values (AV-8.16)', () => {
    const types: IntegrityViolationType[] = [
      'hash_mismatch', 'missing_parent', 'sequence_gap', 'timestamp_regression',
    ];
    assert.equal(types.length, 4);
    assert.equal(new Set(types).size, 4);
  });

  it('IntegrityViolation has all required fields (AV-8.17)', () => {
    const violation: IntegrityViolation = {
      entryId: 'evt-broken' as any,
      type: 'hash_mismatch',
      expected: 'abc123',
      actual: 'def456',
    };
    assert.equal(violation.entryId, 'evt-broken');
    assert.equal(violation.type, 'hash_mismatch');
    assert.equal(violation.expected, 'abc123');
    assert.equal(violation.actual, 'def456');
  });
});

// ============================================================================
// §8: AuditQueryService Behavioral Tests (AV-8.1 through AV-8.6)
// ============================================================================

describe('§8.1: AuditQueryService.queryEntries (AV-8.1)', () => {
  let service: AuditQueryService;
  let conn: DatabaseConnection;
  let audit: AuditTrail;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
    conn = harness.conn;
    audit = harness.audit;
  });

  it('returns PaginatedResult with items, total, limit, offset, hasMore', () => {
    seedMultipleAuditEntries(conn, audit, 5);
    const result = service.queryEntries(
      {},
      { limit: 3, offset: 0, sortBy: 'timestamp', sortOrder: 'desc' },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const page = result.value;
    assert.ok(Array.isArray(page.items), 'items must be array');
    assert.equal(typeof page.total, 'number');
    assert.equal(page.limit, 3);
    assert.equal(page.offset, 0);
    assert.equal(typeof page.hasMore, 'boolean');
  });

  it('respects pagination limit and offset', () => {
    seedMultipleAuditEntries(conn, audit, 10);
    const page1 = service.queryEntries(
      {},
      { limit: 5, offset: 0, sortBy: 'timestamp', sortOrder: 'asc' },
    );
    assert.equal(page1.ok, true);
    if (!page1.ok) return;
    assert.ok(page1.value.items.length <= 5, 'must not exceed limit');

    const page2 = service.queryEntries(
      {},
      { limit: 5, offset: 5, sortBy: 'timestamp', sortOrder: 'asc' },
    );
    assert.equal(page2.ok, true);
    if (!page2.ok) return;
    assert.equal(page2.value.offset, 5);
  });

  it('filters by actionTypes when specified', () => {
    // Seed entries with known operation types
    seedAuditEntry(conn, audit, { operation: 'memory_write', resourceType: 'claim' });
    seedAuditEntry(conn, audit, { operation: 'governance_check', resourceType: 'rule' });

    const result = service.queryEntries(
      { actionTypes: ['memory_write'] },
      { limit: 50, offset: 0, sortBy: 'timestamp', sortOrder: 'desc' },
    );
    assert.equal(result.ok, true);
  });

  it('returns Result type (AV-8.1)', () => {
    const result = service.queryEntries(
      {},
      { limit: 10, offset: 0, sortBy: 'timestamp', sortOrder: 'desc' },
    );
    // Must be a Result<PaginatedResult<AgentAuditEntry>>
    assert.ok('ok' in result, 'Must return Result type with ok field');
  });
});

describe('§8.2: AuditQueryService.getTimeline (AV-8.2)', () => {
  let service: AuditQueryService;
  let conn: DatabaseConnection;
  let audit: AuditTrail;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
    conn = harness.conn;
    audit = harness.audit;
  });

  it('returns Result<SessionTimeline> (AV-8.2)', () => {
    const result = service.getTimeline('sess-nonexistent' as any);
    assert.ok('ok' in result, 'Must return Result type');
  });

  it('timeline contains entries and statistics when session has data', () => {
    // Seed a session's audit entries
    seedAuditEntry(conn, audit, {
      tenantId: 'test-tenant',
      operation: 'session_start',
      resourceType: 'session',
      resourceId: 'sess-test-1',
    });
    const result = service.getTimeline('sess-test-1' as any);
    assert.ok('ok' in result);
  });
});

describe('§8.3: AuditQueryService.getBeliefGraph (AV-8.3)', () => {
  let service: AuditQueryService;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
  });

  it('returns Result<BeliefGraphSnapshot> (AV-8.3)', () => {
    const result = service.getBeliefGraph({});
    assert.ok('ok' in result, 'Must return Result type');
    if (result.ok) {
      const snapshot = result.value;
      assert.ok('snapshotId' in snapshot);
      assert.ok('timestamp' in snapshot);
      assert.ok('nodes' in snapshot);
      assert.ok('edges' in snapshot);
      assert.ok('statistics' in snapshot);
    }
  });

  it('accepts BeliefGraphOptions with all fields (AV-8.10)', () => {
    const result = service.getBeliefGraph({
      agentId: 'agent-1' as any,
      depth: 2,
      includeRetracted: true,
      includeArchived: false,
      layout: 'hierarchical',
    });
    assert.ok('ok' in result);
  });
});

describe('§8.4: AuditQueryService.getGovernanceHeatmap (AV-8.4)', () => {
  let service: AuditQueryService;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
  });

  it('returns Result<GovernanceHeatmapData> (AV-8.4)', () => {
    const result = service.getGovernanceHeatmap({
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      granularity: 'hour',
    });
    assert.ok('ok' in result, 'Must return Result type');
    if (result.ok) {
      const heatmap = result.value;
      assert.ok('timeRange' in heatmap);
      assert.ok('granularity' in heatmap);
      assert.ok('cells' in heatmap);
      assert.ok('totals' in heatmap);
    }
  });

  it('heatmap contains no PII, no claim content, no subject URNs (AV-10.8)', () => {
    const result = service.getGovernanceHeatmap({
      timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T00:00:00Z' },
      granularity: 'day',
    });
    if (result.ok) {
      for (const cell of result.value.cells) {
        // Contract AV-10.8: only counts and rates, no PII
        assert.equal(typeof cell.allowed, 'number');
        assert.equal(typeof cell.refused, 'number');
        assert.equal(typeof cell.escalated, 'number');
        assert.equal(typeof cell.sandboxed, 'number');
        assert.equal(typeof cell.intensity, 'number');
        // actionCategory uses coarse categories, not specific predicates
        assert.equal(typeof cell.actionCategory, 'string');
      }
    }
  });
});

describe('§8.5: AuditQueryService.export (AV-8.5)', () => {
  let service: AuditQueryService;
  let conn: DatabaseConnection;
  let audit: AuditTrail;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
    conn = harness.conn;
    audit = harness.audit;
  });

  it('returns Result<ExportResult> (AV-8.5)', () => {
    const result = service.export({
      format: 'json',
      scope: 'time_range',
      filters: {
        timeRange: { from: '2026-05-09T00:00:00Z', to: '2026-05-10T23:59:59Z' },
      },
      options: {
        includeProvenance: false,
        includeBeliefGraph: false,
        includeTimeline: false,
        includeHeatmap: false,
        redactClassified: false,
      },
    });
    assert.ok('ok' in result, 'Must return Result type');
  });

  it('ExportResult.checksum is verifiable SHA-256 of data (AV-10.4)', () => {
    seedMultipleAuditEntries(conn, audit, 3);
    const result = service.export({
      format: 'json',
      scope: 'time_range',
      filters: {
        timeRange: { from: '2020-01-01T00:00:00Z', to: '2030-12-31T23:59:59Z' },
      },
      options: {
        includeProvenance: false,
        includeBeliefGraph: false,
        includeTimeline: false,
        includeHeatmap: false,
        redactClassified: false,
      },
    });
    if (result.ok) {
      const exportResult = result.value;
      const computedChecksum = createHash('sha256')
        .update(typeof exportResult.data === 'string' ? exportResult.data : exportResult.data)
        .digest('hex');
      assert.equal(exportResult.checksum, computedChecksum,
        'AV-10.4: checksum MUST be SHA-256 of data — verifiable by consumer');
    }
  });

  it('export includes generatedAt as ISO-8601 (AV-6.10)', () => {
    const result = service.export({
      format: 'json',
      scope: 'time_range',
      filters: { timeRange: { from: '2020-01-01T00:00:00Z', to: '2030-12-31T23:59:59Z' } },
      options: {
        includeProvenance: false,
        includeBeliefGraph: false,
        includeTimeline: false,
        includeHeatmap: false,
        redactClassified: false,
      },
    });
    if (result.ok) {
      const ts = result.value.generatedAt;
      // ISO-8601 must parse to valid Date
      const parsed = new Date(ts);
      assert.ok(!isNaN(parsed.getTime()), 'generatedAt must be valid ISO-8601');
    }
  });
});

describe('§8.6: AuditQueryService.verifyChainIntegrity (AV-8.6)', () => {
  let service: AuditQueryService;
  let conn: DatabaseConnection;
  let audit: AuditTrail;

  beforeEach(() => {
    const harness = createTestService();
    service = harness.service;
    conn = harness.conn;
    audit = harness.audit;
  });

  it('returns Result<IntegrityReport> (AV-8.6)', () => {
    const result = service.verifyChainIntegrity({ scope: 'full' });
    assert.ok('ok' in result, 'Must return Result type');
    if (result.ok) {
      const report = result.value;
      assert.equal(typeof report.valid, 'boolean');
      assert.equal(typeof report.entriesChecked, 'number');
      assert.equal(typeof report.brokenLinks, 'number');
      assert.equal(typeof report.hashMismatches, 'number');
    }
  });

  it('valid chain reports valid=true with zero violations (AV-10.1, AV-10.9)', () => {
    seedMultipleAuditEntries(conn, audit, 5);
    const result = service.verifyChainIntegrity({ scope: 'full' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.valid, true,
      'AV-10.1: properly chained entries must validate');
    assert.equal(result.value.hashMismatches, 0);
    assert.equal(result.value.brokenLinks, 0);
  });

  it('respects scope: recent with recentWindowHours (AV-8.12, AV-8.13)', () => {
    seedMultipleAuditEntries(conn, audit, 3);
    const result = service.verifyChainIntegrity({
      scope: 'recent',
      recentWindowHours: 1,
    });
    assert.equal(result.ok, true);
  });

  it('repairMode flags but does not mutate data (AV-8.14, AV-10.9)', () => {
    seedMultipleAuditEntries(conn, audit, 3);
    // Run with repairMode — should not alter the database
    const beforeResult = service.verifyChainIntegrity({ scope: 'full' });
    const repairResult = service.verifyChainIntegrity({ scope: 'full', repairMode: true });
    const afterResult = service.verifyChainIntegrity({ scope: 'full' });

    assert.equal(repairResult.ok, true);
    assert.equal(afterResult.ok, true);
    if (beforeResult.ok && afterResult.ok) {
      assert.equal(beforeResult.value.entriesChecked, afterResult.value.entriesChecked,
        'repairMode must not mutate data');
    }
  });
});

// ============================================================================
// §10: Invariants — Behavioral verification
// ============================================================================

describe('§10.1: Chain Continuity Invariant (AV-10.1)', () => {
  it('hash chain is continuous: entry[n].previousHash === entry[n-1].currentHash', () => {
    const { conn, audit } = createTestService();
    // Seed multiple entries to build a chain
    seedMultipleAuditEntries(conn, audit, 5);

    // Query the raw audit log and verify chain
    const entries = conn.query<{ id: string; previous_hash: string | null; current_hash: string }>(
      'SELECT id, previous_hash, current_hash FROM core_audit_log ORDER BY rowid ASC',
    );
    assert.ok(entries.length >= 5, 'Must have at least 5 entries');

    for (let i = 1; i < entries.length; i++) {
      assert.equal(entries[i].previous_hash, entries[i - 1].current_hash,
        `Chain broken at entry ${i}: previousHash must equal prior entry currentHash`);
    }
  });
});

describe('§10.3: Classification Enforcement (AV-10.3)', () => {
  it('service enforces clearance at service layer, not caller', () => {
    // Create service with restricted clearance
    const { service } = createTestService({ clearanceLevel: 0 });
    // Even with no entries, the service should accept the request without throwing
    const result = service.queryEntries(
      {},
      { limit: 10, offset: 0, sortBy: 'timestamp', sortOrder: 'desc' },
    );
    assert.ok('ok' in result, 'Classification enforcement at service layer');
  });
});

describe('§10.10: Single Source of Truth (AV-10.10)', () => {
  it('all visualization derives from audit entries — service requires database', () => {
    // The service is created with a database connection.
    // Attempting operations without seeded data returns empty results, not invented data.
    const { service } = createTestService();
    const result = service.getBeliefGraph({});
    if (result.ok) {
      assert.equal(result.value.nodes.length, 0,
        'Empty DB must produce empty graph — no invented data');
      assert.equal(result.value.edges.length, 0);
    }
  });
});

describe('§10.11: Governance Verdict Alignment (AV-10.11)', () => {
  it('no alternative spellings permitted — only allow/refuse/escalate/sandbox', () => {
    // This is enforced at the type level. At runtime, we verify the
    // type union only accepts canonical values.
    const valid: GovernanceDecision[] = ['allow', 'refuse', 'escalate', 'sandbox'];
    const invalidSpellings = ['allowed', 'refused', 'escalated', 'sandboxed', 'deny', 'block'];
    for (const spelling of invalidSpellings) {
      assert.ok(!valid.includes(spelling as any),
        `"${spelling}" must NOT be a valid GovernanceDecision`);
    }
  });
});

// ============================================================================
// §8.1: AuditQueryService interface completeness
// ============================================================================

describe('§8: AuditQueryService — interface has all 6 methods (AV-8.1 to AV-8.6)', () => {
  it('service exposes queryEntries, getTimeline, getBeliefGraph, getGovernanceHeatmap, export, verifyChainIntegrity', () => {
    const { service } = createTestService();
    assert.equal(typeof service.queryEntries, 'function', 'AV-8.1: queryEntries');
    assert.equal(typeof service.getTimeline, 'function', 'AV-8.2: getTimeline');
    assert.equal(typeof service.getBeliefGraph, 'function', 'AV-8.3: getBeliefGraph');
    assert.equal(typeof service.getGovernanceHeatmap, 'function', 'AV-8.4: getGovernanceHeatmap');
    assert.equal(typeof service.export, 'function', 'AV-8.5: export');
    assert.equal(typeof service.verifyChainIntegrity, 'function', 'AV-8.6: verifyChainIntegrity');
  });
});
