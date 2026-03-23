/**
 * SC-10: respond_checkpoint -- Agent responds to system-initiated checkpoint.
 * S ref: S24, I-17 (governance boundary), I-24 (goal anchoring), I-25 (replay)
 *
 * Phase: 3 (Orchestration)
 * Delegates to: CheckpointCoordinator.processResponse
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, RespondCheckpointInput, RespondCheckpointOutput,
  CheckpointCoordinator,
} from '../interfaces/orchestration.js';

/** SC-10: respond_checkpoint system call */
export function respondCheckpoint(
  deps: OrchestrationDeps,
  _ctx: OperationContext,
  input: RespondCheckpointInput,
  checkpoints: CheckpointCoordinator,
): Result<RespondCheckpointOutput> {
  return checkpoints.processResponse(deps, input);
}
