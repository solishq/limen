/**
 * SC-6: emit_event -- Agent signals something happened.
 * S ref: S20, S10 (Event), FM-13 (unbounded autonomy)
 *
 * Phase: 3 (Orchestration)
 * Delegates to: EventPropagator.emit
 * Restriction: Lifecycle events are orchestrator-emitted only.
 */

import type { Result, OperationContext } from '../../kernel/interfaces/index.js';
import type { OrchestrationDeps, EmitEventInput, EmitEventOutput, EventPropagator } from '../interfaces/orchestration.js';

/** SC-6: emit_event system call */
export function emitEvent(
  deps: OrchestrationDeps,
  ctx: OperationContext,
  input: EmitEventInput,
  events: EventPropagator,
): Result<EmitEventOutput> {
  return events.emit(deps, ctx, input);
}
