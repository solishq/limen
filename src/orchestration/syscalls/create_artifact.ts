/**
 * SC-4: create_artifact -- Creates an immutable artifact version.
 * S ref: S18, I-19 (immutability), I-20 (artifact limits), I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Delegates to: ArtifactStore.create
 * Side effects: Event ARTIFACT_CREATED emitted (S18)
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, CreateArtifactInput, CreateArtifactOutput, ArtifactStore, EventPropagator } from '../interfaces/orchestration.js';

/** SC-4: create_artifact system call */
export function createArtifact(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: CreateArtifactInput,
  artifacts: ArtifactStore,
  events: EventPropagator,
): Result<CreateArtifactOutput> {
  const result = artifacts.create(deps, ctx, input);
  if (!result.ok) return result;

  // CQ-03 fix: S18 Side Effect -- "Event ARTIFACT_CREATED emitted."
  events.emitLifecycle(deps, 'ARTIFACT_CREATED', input.missionId, {
    artifactId: result.value.artifactId,
    version: result.value.version,
    name: input.name,
    type: input.type,
  });

  return result;
}
