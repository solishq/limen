/**
 * Governed LangGraph + Limen adapter usage (governed: true).
 *
 * Governed mode requires Verified projection state for all reads.
 * Lagging state throws a retryable LimenGovernanceError.
 * Unverified/Divergent throws a non-retryable error requiring manual intervention.
 */
import {
  LimenCheckpointSaver,
  LimenStore,
  LimenGovernanceError,
} from '@limen-ai/langgraph';
import type {
  ChainStorage,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
  LimenCheckpointerConfig,
} from '@limen-ai/langgraph';

declare const chain: ChainStorage;
declare const projection: ProjectionStorage;
declare const projector: Projector;
declare const validity: ValidityStateMachine;

const config: LimenCheckpointerConfig = {
  chain,
  projection,
  projector,
  validity,
  governed: true,          // Reads require Verified state only
  tenantScope: 'prod-org', // Multi-tenant isolation key
};

async function main() {
  const checkpointer = new LimenCheckpointSaver(config);
  const store = new LimenStore(config);

  await checkpointer.start();
  await store.start();

  // Retry wrapper for governed reads -- fail-closed design.
  // Writes always succeed regardless of governance state (Claim 4.8).
  // Only reads are gated. If the projection is not Verified, the adapter
  // refuses to serve potentially stale or tampered data.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 100;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const tuple = await checkpointer.getTuple({
        configurable: { thread_id: 'thread-1' },
      });
      console.log('Checkpoint retrieved:', tuple?.checkpoint.id);
      break;
    } catch (err) {
      if (err instanceof LimenGovernanceError) {
        if (err.retryable && attempt < MAX_RETRIES - 1) {
          // Lagging or Rebuilding -- projector is catching up
          console.warn(`Retrying (${err.state}): ${err.guidance}`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        // Divergent or Unverified -- projection integrity compromised
        // Non-retryable: requires rebuild or investigation
        console.error(`Fatal governance rejection: state=${err.state}`);
        throw err;
      }
      throw err; // Non-governance error, propagate
    }
  }

  await store.stop();
  await checkpointer.stop();
}

main();
