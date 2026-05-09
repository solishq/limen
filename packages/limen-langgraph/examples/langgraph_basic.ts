// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Basic LangGraph + Limen adapter usage (governed: false).
 *
 * Non-governed mode accepts Lagging projection state with a WARN log,
 * suitable for development and non-critical workloads.
 */
import { LimenCheckpointSaver, LimenStore } from '@limen-ai/langgraph';
import type {
  ChainStorage,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
} from '@limen-ai/langgraph';

// Assume these come from your Limen engine initialization
declare const chain: ChainStorage;
declare const projection: ProjectionStorage;
declare const projector: Projector;
declare const validity: ValidityStateMachine;

async function main() {
  // Both classes accept the same LimenCheckpointerConfig shape
  const checkpointer = new LimenCheckpointSaver({ chain, projection, projector, validity });
  const store = new LimenStore({ chain, projection, projector, validity });

  // Start order matters: checkpointer creates the lg_* schema tables
  await checkpointer.start();
  await store.start();

  // Wire into any LangGraph graph via compile()
  // const graph = builder.compile({ checkpointer, store });
  // await graph.invoke({ input: 'hello' }, { configurable: { thread_id: 'thread-1' } });

  // Cleanup (terminal -- create new instances to restart)
  await store.stop();
  await checkpointer.stop();
}

main();
