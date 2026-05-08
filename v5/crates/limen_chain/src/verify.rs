//! Chain integrity verification (v1.3 §14.1 verify_chain).

use limen_types::*;
use crate::storage::{SqliteChainStorage, ChainStorageError};

/// Chain verification report.
#[derive(Debug)]
pub struct ChainVerifyReport {
    pub verified_count: u64,
    pub integrity_ok: bool,
    pub first_break: Option<ChainBreak>,
}

#[derive(Debug)]
pub struct ChainBreak {
    pub sequence: ChainSequence,
    pub expected_hash: Blake3Hash,
    pub actual_hash: Blake3Hash,
}

/// Verify chain integrity by recomputing content hashes and checking
/// previous_hash linkage.
pub fn verify_chain(
    storage: &SqliteChainStorage,
) -> Result<ChainVerifyReport, ChainStorageError> {
    let conn = storage.conn.lock().map_err(|_| ChainStorageError::LockPoisoned)?;

    let mut stmt = conn.prepare(
        "SELECT global_sequence, content_hash, previous_hash, payload \
         FROM chain_entries ORDER BY global_sequence ASC"
    ).map_err(|e| ChainStorageError::Sqlite(e))?;

    let mut rows = stmt.query([]).map_err(|e| ChainStorageError::Sqlite(e))?;
    let mut count: u64 = 0;
    let mut prev_hash: Option<Blake3Hash> = None;

    while let Some(row) = rows.next().map_err(|e| ChainStorageError::Sqlite(e))? {
        let seq: i64 = row.get(0).map_err(|e| ChainStorageError::Sqlite(e))?;
        let stored_hash: Vec<u8> = row.get(1).map_err(|e| ChainStorageError::Sqlite(e))?;
        let stored_prev: Option<Vec<u8>> = row.get(2).map_err(|e| ChainStorageError::Sqlite(e))?;
        let payload: Vec<u8> = row.get(3).map_err(|e| ChainStorageError::Sqlite(e))?;

        // Recompute content hash from payload
        let computed = blake3::hash(&payload);
        let computed_hash = Blake3Hash(computed.into());

        if stored_hash.len() != 32 {
            return Err(ChainStorageError::IntegrityViolation(
                format!(
                    "content_hash at global_sequence {} has {} bytes, expected 32",
                    seq, stored_hash.len()
                ),
            ));
        }
        let mut stored_arr = [0u8; 32];
        stored_arr.copy_from_slice(&stored_hash[..32]);
        let stored_blake = Blake3Hash(stored_arr);

        // Check content hash matches
        if computed_hash != stored_blake {
            return Ok(ChainVerifyReport {
                verified_count: count,
                integrity_ok: false,
                first_break: Some(ChainBreak {
                    sequence: ChainSequence(seq as u64),
                    expected_hash: computed_hash,
                    actual_hash: stored_blake,
                }),
            });
        }

        // Check previous_hash linkage
        let stored_prev_hash = match stored_prev {
            Some(h) => {
                if h.len() != 32 {
                    return Err(ChainStorageError::IntegrityViolation(
                        format!(
                            "previous_hash at global_sequence {} has {} bytes, expected 32",
                            seq, h.len()
                        ),
                    ));
                }
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&h[..32]);
                Some(Blake3Hash(arr))
            }
            None => None,
        };

        if stored_prev_hash != prev_hash {
            return Ok(ChainVerifyReport {
                verified_count: count,
                integrity_ok: false,
                first_break: Some(ChainBreak {
                    sequence: ChainSequence(seq as u64),
                    expected_hash: prev_hash.unwrap_or(Blake3Hash([0; 32])),
                    actual_hash: stored_prev_hash.unwrap_or(Blake3Hash([0; 32])),
                }),
            });
        }

        prev_hash = Some(stored_blake);
        count += 1;
    }

    Ok(ChainVerifyReport {
        verified_count: count,
        integrity_ok: true,
        first_break: None,
    })
}
