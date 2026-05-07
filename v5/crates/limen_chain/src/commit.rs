//! Commit path per v1.3 §6.4 steps 1–8.
//!
//! P0 amendment: actual `VerdictSet` from dispatch loop is threaded through
//! (F-03 fix). The `commit_entry` function now takes the real verdicts instead
//! of fabricating `Accept/Authorized/Permitted/Intact`.
//!
//! `SqliteChainStorage` implements `ChainCommitSink` for audit-before-success
//! fusion with the dispatch loop.

use limen_types::*;
use limen_foundation_contract::chain::*;
use limen_foundation_contract::dispatch::ChainCommitSink;
use limen_foundation_contract::envelope::CommitEnvelope;
use limen_foundation_contract::proposed::ProposedTransitionEnvelope;
use limen_foundation_contract::verdict::*;
use crate::storage::{SqliteChainStorage, ChainStorageError};
use crate::canonical_temp::to_canonical_bytes;

/// Commit a chain entry with the actual verdict set from the dispatch loop.
///
/// F-03 fix: the `verdicts` parameter carries the real `VerdictSet` — no
/// fabricated verdicts. For backward compatibility, callers that pass
/// `CommitDecision::Refused` do not use the verdicts (refusal entries
/// store the refusal verdict from the decision itself).
pub fn commit_entry(
    storage: &SqliteChainStorage,
    proposed: ProposedTransitionEnvelope,
    decision: CommitDecision,
    verdicts: VerdictSet,
    tenant_scope: TenantScope,
    commit_envelope: CommitEnvelope,
) -> Result<ChainEntry, ChainStorageError> {
    let mut conn = storage.conn.lock().map_err(|_| ChainStorageError::LockPoisoned)?;

    // Step 2: Begin SQLite IMMEDIATE transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Step 3: Read current state within this transaction
    let next_global: i64 = tx.query_row(
        "SELECT next_global_sequence FROM global_chain_state WHERE id = 1",
        [], |row| row.get(0),
    )?;

    // Read per-tenant sequence (for tenant_sequence allocation)
    let next_tenant = match tx.query_row(
        "SELECT next_tenant_sequence FROM tenant_chain_state WHERE tenant_scope = ?1",
        [&tenant_scope.0],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(seq) => seq,
        Err(rusqlite::Error::QueryReturnedNoRows) => 0i64,
        Err(e) => return Err(e.into()),
    };

    // Read GLOBAL chain head hash for previous_hash linkage (v1.3 §6.1:
    // "previous_hash chaining follows global_sequence order")
    let last_hash: Option<Blake3Hash> = if next_global > 0 {
        let hash_bytes: Vec<u8> = tx.query_row(
            "SELECT content_hash FROM chain_entries WHERE global_sequence = ?1",
            [next_global - 1],
            |row| row.get(0),
        )?;
        let mut arr = [0u8; 32];
        if hash_bytes.len() >= 32 { arr.copy_from_slice(&hash_bytes[..32]); }
        Some(Blake3Hash(arr))
    } else {
        None
    };

    let global_seq = ChainSequence(next_global as u64);
    let tenant_seq = ChainSequence(next_tenant as u64);
    let canonical_at = commit_envelope.committed_at;

    // Step 6: Build entry per decision
    let entry = match decision {
        CommitDecision::Commit { path } => {
            let transition = CommittedTransition {
                proposed: proposed.clone(),
                verdicts,
                commit_path: path,
                canonical_at,
            };
            let mut entry = CommittedEntry {
                global_sequence: global_seq,
                tenant_sequence: tenant_seq,
                content_hash: Blake3Hash([0; 32]), // placeholder — computed from payload below
                previous_hash: last_hash,
                tenant_scope: tenant_scope.clone(),
                canonical_at,
                transition,
                commit_envelope: commit_envelope.clone(),
            };
            // Hash from the entry with zeroed content_hash (the "hashable" form).
            // The stored payload is this same bytes — verify_chain recomputes
            // blake3(payload) and compares to stored content_hash.
            let payload = to_canonical_bytes(&entry);
            entry.content_hash = Blake3Hash(blake3::hash(&payload).into());
            // Store the pre-hash payload. content_hash is stored separately in the
            // content_hash column. verify_chain recomputes blake3(payload) and
            // checks it matches the content_hash column.

            insert_entry(&tx, &entry.global_sequence, &tenant_scope, &entry.tenant_sequence,
                &entry.content_hash, &entry.previous_hash, "Committed", &entry.canonical_at, &payload)?;

            ChainEntry::Committed(entry)
        }
        CommitDecision::Refused(reason) => {
            let governing_evidence = GoverningEvidence {
                chain_state_at_evaluation: ChainStateSnapshot {
                    sequence: global_seq,
                    head_hash: last_hash.unwrap_or(Blake3Hash([0; 32])),
                },
                governance_policy_id: None,
                authority_state: AuthorityStateSnapshot {
                    actor: Actor("system".into()),
                    authorities: vec![],
                },
                cascade_check: CascadeCheckResult::Intact,
            };
            let mut entry = RefusalEntry {
                global_sequence: global_seq,
                tenant_sequence: tenant_seq,
                content_hash: Blake3Hash([0; 32]),
                previous_hash: last_hash,
                tenant_scope: tenant_scope.clone(),
                refused_at: canonical_at,
                proposed,
                refusal_verdict: RefusalVerdict::Refuse(reason),
                governing_evidence,
                refusal_envelope: commit_envelope.clone(),
            };
            // Hash from entry with zeroed content_hash (same pattern as CommittedEntry)
            let payload = to_canonical_bytes(&entry);
            entry.content_hash = Blake3Hash(blake3::hash(&payload).into());

            insert_entry(&tx, &entry.global_sequence, &tenant_scope, &entry.tenant_sequence,
                &entry.content_hash, &entry.previous_hash, "Refusal", &entry.refused_at, &payload)?;

            ChainEntry::Refusal(entry)
        }
    };

    // Step 7: Update sequences
    tx.execute(
        "INSERT INTO tenant_chain_state (tenant_scope, next_tenant_sequence, last_hash) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(tenant_scope) DO UPDATE SET next_tenant_sequence = ?2, last_hash = ?3",
        rusqlite::params![
            tenant_scope.0,
            (tenant_seq.0 + 1) as i64,
            entry.content_hash().0.as_slice(), // per-tenant last_hash for tenant queries
        ],
    )?;

    tx.execute(
        "UPDATE global_chain_state SET next_global_sequence = ?1 WHERE id = 1",
        [(next_global + 1)],
    )?;

    // Step 8: Commit transaction
    tx.commit()?;

    Ok(entry)
}

/// Implement `ChainCommitSink` for `SqliteChainStorage` to enable
/// audit-before-success fusion with the dispatch loop.
impl ChainCommitSink for SqliteChainStorage {
    fn commit_entry(
        &self,
        proposed: ProposedTransitionEnvelope,
        decision: CommitDecision,
        verdicts: VerdictSet,
        tenant_scope: TenantScope,
        commit_envelope: CommitEnvelope,
    ) -> Result<ChainEntry, String> {
        crate::commit::commit_entry(
            self, proposed, decision, verdicts, tenant_scope, commit_envelope,
        )
        .map_err(|e| format!("{:?}", e))
    }
}

fn insert_entry(
    tx: &rusqlite::Transaction,
    global_seq: &ChainSequence,
    tenant_scope: &TenantScope,
    tenant_seq: &ChainSequence,
    content_hash: &Blake3Hash,
    previous_hash: &Option<Blake3Hash>,
    kind: &str,
    canonical_at: &SubstrateInstant,
    payload: &[u8],
) -> Result<(), ChainStorageError> {
    tx.execute(
        "INSERT INTO chain_entries (global_sequence, tenant_scope, tenant_sequence, \
         content_hash, previous_hash, entry_kind, canonical_at, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            global_seq.0 as i64,
            tenant_scope.0,
            tenant_seq.0 as i64,
            content_hash.0.as_slice(),
            previous_hash.map(|h| h.0.to_vec()),
            kind,
            canonical_at.0 as i64,
            payload,
        ],
    )?;
    Ok(())
}
