/**
 * @limen-ai/langgraph — Governed LangGraph adapter for Limen
 *
 * Bridges LangGraph's checkpoint and store interfaces to Limen's
 * append-only chain + projection architecture with governance gates.
 */

// Core adapters
export { LimenCheckpointSaver } from './checkpoint.js';
export { LimenStore } from './store.js';

// Error types
export {
  LimenGovernanceError,
  LimenStorageError,
  LimenSerdeError,
  LimenNotStartedError,
} from './errors.js';

// Serializer
export { JsonPlusSerializer, defaultSerializer } from './serde.js';

// Types
export type {
  // Limen core interfaces
  ChainStorage,
  ChainEntryInput,
  CommittedEntry,
  ProjectionStorage,
  Projector,
  ValidityStateMachine,
  ValidityState,
  NonAuthoritative,
  SerializerProtocol,

  // Adapter config
  LimenCheckpointerConfig,

  // LangGraph checkpoint types
  RunnableConfig,
  RunnableConfigurable,
  Checkpoint,
  CheckpointMetadata,
  ChannelVersions,
  CheckpointTuple,
  CheckpointPendingWrite,
  PendingWrite,
  CheckpointListOptions,

  // LangGraph store types
  Item,
  SearchItem,
  GetOperation,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
  MatchCondition,
  Operation,
  OperationResults,

  // Projection row types
  LgCheckpointRow,
  LgPendingWriteRow,
  LgStoreItemRow,
} from './types.js';

// Constants
export {
  WRITES_IDX_MAP,
  TASKS,
  MAX_SCAN_ROWS,
  VALID_FILTER_OPS,
  DEFAULT_TENANT_SCOPE,
  ADAPTER_SCHEMA_VERSION,
} from './types.js';
