/**
 * SC-5: read_artifact -- Reads an artifact with dependency tracking.
 * S ref: S19, I-23 (dependency tracking), I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Delegates to: ArtifactStore.read + ArtifactStore.trackDependency
 * Side effects: Dependency edge created (I-23), relevanceDecay reset to 0 (S19),
 *               Event ARTIFACT_READ emitted (local scope) (S19)
 */

import type { Result, OperationContext, MissionId } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, ReadArtifactInput, ReadArtifactOutput, ArtifactStore, EventPropagator } from '../interfaces/orchestration.js';

/** SC-5: read_artifact system call */
export function readArtifact(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: ReadArtifactInput,
  artifacts: ArtifactStore,
  events: EventPropagator,
  readingMissionId?: MissionId,
): Result<ReadArtifactOutput> {
  const result = artifacts.read(deps, ctx, input);
  if (!result.ok) return result;

  const artifact = result.value.artifact;

  // CQ-04 fix: S19 Side Effect -- "Artifact relevanceDecay reset to 0."
  deps.conn.run(
    'UPDATE core_artifacts SET relevance_decay = 0 WHERE id = ? AND version = ?',
    [artifact.id, artifact.version],
  );

  // I-23: Track dependency edge if reading mission is specified
  if (readingMissionId) {
    const isCrossMission = readingMissionId !== artifact.missionId;
    artifacts.trackDependency(deps, readingMissionId, artifact.id, artifact.version, isCrossMission);
  }

  // CQ-04 fix: S19 Side Effect -- "Event ARTIFACT_READ emitted (local scope)."
  events.emitLifecycle(deps, 'ARTIFACT_READ', artifact.missionId, {
    artifactId: artifact.id,
    version: artifact.version,
    readingMissionId: readingMissionId ?? null,
  });

  return result;
}
