/**
 * Governance test helpers — branded ID constructors and common fixtures.
 * Phase: 0A (Foundation)
 *
 * Provides typed constructors for all governance branded IDs
 * defined in src/kernel/interfaces/governance_ids.ts.
 * Follows the same pattern as test_database.ts for kernel branded IDs.
 */

import type {
  RunId, AttemptId, TraceEventId, CorrelationId,
  MissionContractId, SupervisorDecisionId, SuspensionRecordId,
  HandoffId, EvalCaseId, CapabilityManifestId,
  CheckpointId, ArtifactLineageId,
} from '../../src/kernel/interfaces/governance_ids.js';
import type { ResumeTokenHash } from '../../src/kernel/interfaces/supervisor.js';

// ─── Governance branded ID constructors ───

export function runId(id: string): RunId { return id as RunId; }
export function attemptId(id: string): AttemptId { return id as AttemptId; }
export function traceEventId(id: string): TraceEventId { return id as TraceEventId; }
export function correlationId(id: string): CorrelationId { return id as CorrelationId; }
export function missionContractId(id: string): MissionContractId { return id as MissionContractId; }
export function supervisorDecisionId(id: string): SupervisorDecisionId { return id as SupervisorDecisionId; }
export function suspensionRecordId(id: string): SuspensionRecordId { return id as SuspensionRecordId; }
export function handoffId(id: string): HandoffId { return id as HandoffId; }
export function evalCaseId(id: string): EvalCaseId { return id as EvalCaseId; }
export function capabilityManifestId(id: string): CapabilityManifestId { return id as CapabilityManifestId; }
export function checkpointId(id: string): CheckpointId { return id as CheckpointId; }
export function artifactLineageId(id: string): ArtifactLineageId { return id as ArtifactLineageId; }
export function resumeTokenHash(hash: string): ResumeTokenHash { return hash as ResumeTokenHash; }

// ─── Common test timestamp ───

export function testTimestamp(): string {
  return new Date().toISOString();
}
