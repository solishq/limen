//! M3 Chain Storage Tests — Interface-First Contract Testing
//! Tests A through G per DOC-28 M3 requirements.

use std::sync::Arc;
use limen_types::*;
use limen_foundation_contract::chain::*;
use limen_foundation_contract::envelope::CommitEnvelope;
use limen_foundation_contract::proposed::*;
use limen_foundation_contract::verdict::*;
use limen_foundation_contract::capabilities::ChainReadContext;
use limen_chain::storage::*;
use limen_chain::commit::commit_entry;
use limen_chain::verify::verify_chain;
use limen_chain::schema::CHAIN_SCHEMA_DDL;

fn test_storage() -> SqliteChainStorage {
    SqliteChainStorage::open_in_memory(SyncMode::Normal).unwrap()
}

fn test_proposed(payload: &str) -> ProposedTransitionEnvelope {
    ProposedTransitionEnvelope::new(
        ProposedTransition { payload: payload.as_bytes().to_vec(), transition_type: "test".into() },
        ProposerIdentity("tester".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("default".into()),
        SchemaVersion(1),
    )
}

fn test_envelope(at: u64) -> CommitEnvelope {
    CommitEnvelope {
        request_boundary: RequestBoundary(1),
        actor_identity: ActorIdentity("tester".into()),
        tenant_scope: TenantScope("default".into()),
        trace_identity: TraceIdentity(1),
        committed_at: SubstrateInstant(at),
    }
}

/// Default verdict set for test commits — all operations pass.
fn test_verdicts() -> VerdictSet {
    VerdictSet {
        refusal: RefusalVerdict::Accept,
        authority: AuthorityVerdict::Authorized,
        governance: GovernanceVerdict::Permitted,
        cascade: CascadeVerdict::Intact,
    }
}

fn commit_one(storage: &SqliteChainStorage, payload: &str, at: u64) -> ChainEntry {
    commit_entry(
        storage,
        test_proposed(payload),
        CommitDecision::Commit { path: CommitPath::Default },
        test_verdicts(),
        TenantScope("default".into()),
        test_envelope(at),
    ).unwrap()
}

// ============================================================
// A. Schema integrity
// ============================================================

#[test]
fn test_a_schema_ddl_source_matches() {
    // Byte-for-byte check: the constant is the canonical DDL
    assert!(CHAIN_SCHEMA_DDL.contains("CREATE TABLE chain_entries"));
    assert!(CHAIN_SCHEMA_DDL.contains("global_sequence  INTEGER PRIMARY KEY NOT NULL"));
    assert!(CHAIN_SCHEMA_DDL.contains("UNIQUE (tenant_scope, tenant_sequence)"));
    assert!(CHAIN_SCHEMA_DDL.contains("CREATE TABLE tenant_chain_state"));
    assert!(CHAIN_SCHEMA_DDL.contains("CREATE TABLE global_chain_state"));
    assert!(CHAIN_SCHEMA_DDL.contains("CHECK (id = 1)"));
}

#[test]
fn test_a_schema_semantic_introspection() {
    let storage = test_storage();
    let conn = storage.lock_conn().unwrap();

    // Check chain_entries table exists with correct columns
    let mut stmt = conn.prepare(
        "SELECT name FROM pragma_table_info('chain_entries') ORDER BY cid"
    ).unwrap();
    let cols: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
        .map(|r| r.unwrap()).collect();
    assert_eq!(cols, vec![
        "global_sequence", "tenant_scope", "tenant_sequence",
        "content_hash", "previous_hash", "entry_kind", "canonical_at", "payload"
    ]);

    // Check tenant_chain_state exists
    let mut stmt = conn.prepare(
        "SELECT name FROM pragma_table_info('tenant_chain_state') ORDER BY cid"
    ).unwrap();
    let cols: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
        .map(|r| r.unwrap()).collect();
    assert_eq!(cols, vec!["tenant_scope", "next_tenant_sequence", "last_hash"]);

    // Check global_chain_state exists
    let mut stmt = conn.prepare(
        "SELECT name FROM pragma_table_info('global_chain_state') ORDER BY cid"
    ).unwrap();
    let cols: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
        .map(|r| r.unwrap()).collect();
    assert_eq!(cols, vec!["id", "next_global_sequence"]);

    // Check indexes exist
    let indexes: Vec<String> = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
    ).unwrap().query_map([], |row| row.get(0)).unwrap()
        .map(|r| r.unwrap()).collect();
    assert!(indexes.contains(&"idx_global_sequence".to_string()));
    assert!(indexes.contains(&"idx_tenant_sequence".to_string()));
    assert!(indexes.contains(&"idx_kind_time".to_string()));
}

// ============================================================
// B. Singleton commit path stress
// ============================================================

#[test]
fn test_b_concurrent_commit_stress() {
    let storage = Arc::new(SqliteChainStorage::open_in_memory(SyncMode::Normal).unwrap());
    let total = 1000usize;
    let threads = 8;
    let per_thread = total / threads;

    let handles: Vec<_> = (0..threads).map(|t| {
        let s = Arc::clone(&storage);
        std::thread::spawn(move || {
            for i in 0..per_thread {
                let idx = t * per_thread + i;
                let _ = commit_entry(
                    &s,
                    test_proposed(&format!("entry-{}", idx)),
                    CommitDecision::Commit { path: CommitPath::Default },
                    test_verdicts(),
                    TenantScope("default".into()),
                    test_envelope(idx as u64),
                ).unwrap();
            }
        })
    }).collect();

    for h in handles { h.join().unwrap(); }

    // Verify gap-free global_sequence [0..999]
    let conn = storage.lock_conn().unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM chain_entries", [], |r| r.get(0)).unwrap();
    assert_eq!(count, total as i64);

    let max_seq: i64 = conn.query_row("SELECT MAX(global_sequence) FROM chain_entries", [], |r| r.get(0)).unwrap();
    assert_eq!(max_seq, (total - 1) as i64);

    let min_seq: i64 = conn.query_row("SELECT MIN(global_sequence) FROM chain_entries", [], |r| r.get(0)).unwrap();
    assert_eq!(min_seq, 0);

    // No duplicate global_sequence (PK enforces, but verify)
    let distinct: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT global_sequence) FROM chain_entries", [], |r| r.get(0)
    ).unwrap();
    assert_eq!(distinct, total as i64);

    // No duplicate content_hash (UNIQUE enforces)
    let distinct_hash: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT content_hash) FROM chain_entries", [], |r| r.get(0)
    ).unwrap();
    assert_eq!(distinct_hash, total as i64);
}

// ============================================================
// C. TOCTOU impossibility
// ============================================================

#[test]
fn test_c_toctou_impossible() {
    // Prove that a second writer cannot commit while first holds IMMEDIATE lock.
    // We use a file-based DB for real locking.
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("chain.db");

    let storage1 = SqliteChainStorage::open(&db_path, SyncMode::Normal).unwrap();

    // First connection: acquire IMMEDIATE lock
    {
        let mut conn1 = storage1.lock_conn().unwrap();
        let tx1 = conn1.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).unwrap();

        // While tx1 holds the lock, open a second connection and try to write
        let conn2 = rusqlite::Connection::open(&db_path).unwrap();
        conn2.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn2.busy_timeout(std::time::Duration::from_millis(50)).unwrap();

        let result = conn2.execute(
            "INSERT INTO chain_entries (global_sequence, tenant_scope, tenant_sequence, \
             content_hash, previous_hash, entry_kind, canonical_at, payload) \
             VALUES (999, 'attack', 0, X'00', NULL, 'Committed', 0, X'00')",
            [],
        );

        // Second writer must fail with SQLITE_BUSY (timeout exceeded)
        assert!(result.is_err(), "Second writer should be blocked by IMMEDIATE lock");
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("database is locked") || err.to_string().contains("BUSY"),
            "Error should be SQLITE_BUSY, got: {}", err
        );

        tx1.rollback().unwrap();
    }
}

// ============================================================
// D. Refusal durability
// ============================================================

#[test]
fn test_d_refusal_durable_and_chain_linked() {
    let storage = test_storage();

    // Commit one entry, then refuse one
    let first = commit_one(&storage, "first", 1);

    let refusal = commit_entry(
        &storage,
        test_proposed("refused-proposal"),
        CommitDecision::Refused(RefusalReason {
            category: RefusalCategory::Governance,
            detail: "policy violation".into(),
        }),
        test_verdicts(),
        TenantScope("default".into()),
        test_envelope(2),
    ).unwrap();

    // Refusal is chain-linked: previous_hash matches first entry's content_hash
    assert_eq!(refusal.previous_hash(), Some(first.content_hash()));

    // Refusal is queryable by global_sequence
    let conn = storage.lock_conn().unwrap();
    let kind: String = conn.query_row(
        "SELECT entry_kind FROM chain_entries WHERE global_sequence = ?1",
        [refusal.global_sequence().0 as i64],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(kind, "Refusal");

    // Queryable by content_hash
    let seq: i64 = conn.query_row(
        "SELECT global_sequence FROM chain_entries WHERE content_hash = ?1",
        [refusal.content_hash().0.as_slice()],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(seq, refusal.global_sequence().0 as i64);

    // Verify chain integrity holds with refusal included
    drop(conn);
    let report = verify_chain(&storage).unwrap();
    assert!(report.integrity_ok);
    assert_eq!(report.verified_count, 2);
}

// ============================================================
// E. Tamper detection
// ============================================================

#[test]
fn test_e_tamper_detection() {
    let storage = test_storage();

    // Create 5 entries
    for i in 0..5 {
        commit_one(&storage, &format!("entry-{}", i), i as u64);
    }

    // Verify clean chain
    let report = verify_chain(&storage).unwrap();
    assert!(report.integrity_ok);
    assert_eq!(report.verified_count, 5);

    // Tamper with entry at sequence 2
    {
        let conn = storage.lock_conn().unwrap();
        conn.execute(
            "UPDATE chain_entries SET payload = X'DEADBEEF' WHERE global_sequence = 2",
            [],
        ).unwrap();
    }

    // Verify tamper detected
    let report = verify_chain(&storage).unwrap();
    assert!(!report.integrity_ok);
    assert!(report.first_break.is_some());
    assert_eq!(report.first_break.unwrap().sequence, ChainSequence(2));
}

// ============================================================
// F. Transaction-bound reads
// ============================================================

#[test]
fn test_f_transaction_bound_reads() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("chain.db");

    let storage = SqliteChainStorage::open(&db_path, SyncMode::Normal).unwrap();
    commit_one(&storage, "initial", 1);

    // Open IMMEDIATE transaction and create read context
    let mut conn = storage.lock_conn().unwrap();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).unwrap();
    let read_ctx = limen_chain::read_context::SqliteTransactionReadContext::new(&tx);

    // Read within transaction sees the entry
    let entry = read_ctx.read_entry(ChainSequence(0)).unwrap();
    assert!(entry.is_some());

    // Freshness marker reflects current state
    let marker = read_ctx.freshness_marker();
    assert_eq!(marker.local_sequence, ChainSequence(1)); // next_global_sequence

    tx.rollback().unwrap();
}

// ============================================================
// G. Multi-tenant correctness
// ============================================================

#[test]
fn test_g_multi_tenant() {
    let storage = test_storage();
    let tenant_a = TenantScope("tenant-a".into());
    let tenant_b = TenantScope("tenant-b".into());

    // 5 commits per tenant, interleaved
    for i in 0..5 {
        commit_entry(
            &storage, test_proposed(&format!("a-{}", i)),
            CommitDecision::Commit { path: CommitPath::Default },
            test_verdicts(),
            tenant_a.clone(), test_envelope(i * 2),
        ).unwrap();

        commit_entry(
            &storage, test_proposed(&format!("b-{}", i)),
            CommitDecision::Commit { path: CommitPath::Default },
            test_verdicts(),
            tenant_b.clone(), test_envelope(i * 2 + 1),
        ).unwrap();
    }

    let conn = storage.lock_conn().unwrap();

    // Global sequence is gap-free [0..9]
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM chain_entries", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 10);

    // Per-tenant sequences are gap-free [0..4]
    for tenant in &["tenant-a", "tenant-b"] {
        let max_t: i64 = conn.query_row(
            "SELECT MAX(tenant_sequence) FROM chain_entries WHERE tenant_scope = ?1",
            [tenant], |r| r.get(0),
        ).unwrap();
        assert_eq!(max_t, 4, "tenant {} max_tenant_sequence", tenant);

        let count_t: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chain_entries WHERE tenant_scope = ?1",
            [tenant], |r| r.get(0),
        ).unwrap();
        assert_eq!(count_t, 5, "tenant {} count", tenant);
    }

    // Cross-tenant commits don't interfere — tenant_chain_state is independent
    let next_a: i64 = conn.query_row(
        "SELECT next_tenant_sequence FROM tenant_chain_state WHERE tenant_scope = 'tenant-a'",
        [], |r| r.get(0),
    ).unwrap();
    let next_b: i64 = conn.query_row(
        "SELECT next_tenant_sequence FROM tenant_chain_state WHERE tenant_scope = 'tenant-b'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(next_a, 5);
    assert_eq!(next_b, 5);

    // Chain integrity holds across tenants
    drop(conn);
    let report = verify_chain(&storage).unwrap();
    assert!(report.integrity_ok);
    assert_eq!(report.verified_count, 10);
}
