//! `SqliteTransactionReadContext<'tx>` — implements `ChainReadContext` from
//! `limen_foundation_contract` for Profile 1/2 SQLite backend (v1.3 §2.1).
//!
//! All reads go through the same SQLite IMMEDIATE transaction, eliminating TOCTOU.

use rusqlite::Transaction;
use limen_types::*;
use limen_foundation_contract::capabilities::ChainReadContext;
use limen_foundation_contract::chain::*;

/// SQLite-backed chain read context. Holds a reference to the active
/// IMMEDIATE transaction. All reads see the same snapshot.
pub struct SqliteTransactionReadContext<'tx> {
    tx: &'tx Transaction<'tx>,
}

impl<'tx> SqliteTransactionReadContext<'tx> {
    /// Create a read context bound to an active IMMEDIATE transaction.
    pub fn new(tx: &'tx Transaction<'tx>) -> Self {
        Self { tx }
    }
}

impl<'tx> ChainReadContext for SqliteTransactionReadContext<'tx> {
    fn read_entry(&self, sequence: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> {
        let mut stmt = self.tx.prepare_cached(
            "SELECT entry_kind, payload FROM chain_entries WHERE global_sequence = ?1"
        ).map_err(|e| ChainReadError::StorageError(e.to_string()))?;

        let result = stmt.query_row([sequence.0 as i64], |row| {
            let kind: String = row.get(0)?;
            let payload: Vec<u8> = row.get(1)?;
            Ok((kind, payload))
        });

        match result {
            Ok((kind, payload)) => {
                let entry = deserialize_chain_entry(&kind, &payload)
                    .map_err(|e| ChainReadError::StorageError(e))?;
                Ok(Some(entry))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(ChainReadError::StorageError(e.to_string())),
        }
    }

    fn read_tenant_state(&self, scope: &TenantScope) -> Result<TenantChainState, ChainReadError> {
        let mut stmt = self.tx.prepare_cached(
            "SELECT next_tenant_sequence, last_hash FROM tenant_chain_state WHERE tenant_scope = ?1"
        ).map_err(|e| ChainReadError::StorageError(e.to_string()))?;

        match stmt.query_row([&scope.0], |row| {
            let next_seq: i64 = row.get(0)?;
            let last_hash: Option<Vec<u8>> = row.get(1)?;
            Ok(TenantChainState {
                tenant_scope: scope.clone(),
                next_tenant_sequence: ChainSequence(next_seq as u64),
                last_hash: last_hash.map(|h| {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&h[..32]);
                    Blake3Hash(arr)
                }),
            })
        }) {
            Ok(state) => Ok(state),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(TenantChainState {
                tenant_scope: scope.clone(),
                next_tenant_sequence: ChainSequence(0),
                last_hash: None,
            }),
            Err(e) => Err(ChainReadError::StorageError(e.to_string())),
        }
    }

    fn read_governance_state_at(
        &self,
        _scope: &TenantScope,
        _policy_id: &PolicyId,
    ) -> Result<Option<GovernanceState>, ChainReadError> {
        // M3: governance state reading requires scanning chain entries for governance transitions.
        // Full implementation deferred to M5 (foundation operations). Returns None for M3.
        Ok(None)
    }

    fn read_authority_state_at(
        &self,
        _scope: &TenantScope,
        _actor: &Actor,
    ) -> Result<Vec<AuthorityState>, ChainReadError> {
        // M3: authority state reading deferred to M5. Returns empty for M3.
        Ok(Vec::new())
    }

    fn read_cascade_link(&self, _prior: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> {
        // M3: cascade links deferred to M5. Returns None for M3.
        Ok(None)
    }

    fn freshness_marker(&self) -> FreshnessMarker {
        let seq: i64 = self.tx.query_row(
            "SELECT next_global_sequence FROM global_chain_state WHERE id = 1",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        FreshnessMarker {
            local_sequence: ChainSequence(seq as u64),
        }
    }
}

/// Deserialize a chain entry from its stored kind + payload.
///
/// F-05/F-08 verified: payloads are serialized with `CanonicalMsgPackSerializer`
/// (fixed-width str32/bin32/array32/map32) but deserialized here with
/// `rmp_serde::from_slice`. This works because:
///   1. str32, bin32, array32, map32 are valid MessagePack format tags
///   2. `rmp_serde` handles all valid msgpack format variants (both compact and fixed-width)
///   3. The canonical serializer writes structs as positional arrays (`array32`),
///      and `rmp_serde::from_slice` deserializes positional arrays into structs
///      by field declaration order (matching serde's sequential field access)
///
/// Roundtrip correctness is proven by `test_h_canonical_serialize_rmp_serde_deserialize_roundtrip`
/// and `test_h_refusal_entry_roundtrip` in `chain_tests.rs`.
///
/// NOTE: The deserialized `content_hash` field is always `[0;32]` because the
/// payload is the "hashable form" (pre-hash). The actual hash is stored in the
/// `content_hash` column and verified by `verify_chain`.
fn deserialize_chain_entry(kind: &str, payload: &[u8]) -> Result<ChainEntry, String> {
    match kind {
        "Committed" => {
            let entry: CommittedEntry = rmp_serde::from_slice(payload)
                .map_err(|e| format!("committed entry deserialize: {}", e))?;
            Ok(ChainEntry::Committed(entry))
        }
        "Refusal" => {
            let entry: RefusalEntry = rmp_serde::from_slice(payload)
                .map_err(|e| format!("refusal entry deserialize: {}", e))?;
            Ok(ChainEntry::Refusal(entry))
        }
        _ => Err(format!("unknown entry kind: {}", kind)),
    }
}
