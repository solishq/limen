//! Consensus-specific error types for Profile 3 chain storage.

use limen_foundation_contract::chain::ChainReadError;

/// Errors from consensus operations.
///
/// These are consensus-protocol-level errors distinct from `ChainReadError`.
/// At the `ChainReadContext` trait boundary, `ConsensusError` maps to
/// `ChainReadError::StorageError(description)` via the `From` impl below.
#[derive(Debug, thiserror::Error)]
pub enum ConsensusError {
    /// This node is not the Raft leader. Writes must be forwarded.
    #[error("not leader: current leader is node {leader_id:?}")]
    NotLeader {
        /// The node ID of the current leader, if known.
        leader_id: Option<u64>,
    },

    /// Raft log compaction in progress. Retry after compaction completes.
    #[error("log compaction in progress")]
    LogCompaction,

    /// Quorum not available. Fewer than N/2+1 nodes reachable.
    #[error("quorum unavailable: {available}/{required} nodes reachable")]
    QuorumUnavailable {
        available: u32,
        required: u32,
    },

    /// Internal Raft protocol error.
    #[error("raft protocol error: {0}")]
    RaftProtocol(String),

    /// Snapshot transfer failed.
    #[error("snapshot transfer failed: {0}")]
    SnapshotFailed(String),

    /// Node membership change rejected.
    #[error("membership change rejected: {0}")]
    MembershipRejected(String),

    /// Storage backend error (wraps underlying storage failures).
    #[error("storage backend: {0}")]
    StorageBackend(String),
}

/// Maps consensus-specific errors to the `ChainReadContext` trait's error type.
///
/// All `ConsensusError` variants map to `ChainReadError::StorageError` with
/// the Display representation as the description. This is the boundary mapping
/// documented in the evaluation doc (Section 5.4).
impl From<ConsensusError> for ChainReadError {
    fn from(err: ConsensusError) -> Self {
        ChainReadError::StorageError(err.to_string())
    }
}
