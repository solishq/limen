//! Integration tests for limen_postgres.
//!
//! These tests require a live PostgreSQL instance. Enable with:
//!   cargo test -p limen_postgres --features postgres-tests -- --ignored
//!
//! Environment variable `LIMEN_PG_TEST_URL` configures the connection:
//!   export LIMEN_PG_TEST_URL="postgres://limen:limen@localhost:5432/limen_test"
//!
//! If not set, tests default to:
//!   postgres://postgres:postgres@localhost:5432/limen_test
//!
//! ## Test Isolation
//!
//! Each test creates its own tables with a unique prefix (test function name)
//! to avoid cross-test interference. Tests clean up after themselves.
//!
//! ## Tests (8 total)
//!
//! 1. test_schema_creation — DDL is idempotent
//! 2. test_chain_append_and_read — append + read round-trip
//! 3. test_chain_verify — hash chain integrity verification
//! 4. test_projection_crud — all 5 projection tables
//! 5. test_certificate_crud — projection certificate insert + read
//! 6. test_latest_sequence — MAX sequence tracking
//! 7. test_tamper_detection — projection sequence regression rejected
//! 8. test_migration_sqlite_to_postgres — full migration pipeline

// All tests gated behind postgres-tests feature
#![cfg(feature = "postgres-tests")]

use limen_postgres::chain_storage::PostgresChainStorage;
use limen_postgres::error::PostgresStorageError;
use limen_postgres::migrate::*;
use limen_postgres::projection_storage::PostgresProjectionStorage;
use serde_json::json;

/// Get the test database URL from environment or use default.
fn test_db_url() -> String {
    std::env::var("LIMEN_PG_TEST_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/limen_test".to_string())
}

/// Create a deadpool-postgres pool for testing.
async fn test_pool() -> deadpool_postgres::Pool {
    let config = test_db_url()
        .parse::<tokio_postgres::Config>()
        .expect("valid postgres URL");

    let mgr_config = deadpool_postgres::ManagerConfig {
        recycling_method: deadpool_postgres::RecyclingMethod::Fast,
    };

    let mgr = deadpool_postgres::Manager::from_config(config, tokio_postgres::NoTls, mgr_config);

    deadpool_postgres::Pool::builder(mgr)
        .max_size(4)
        .build()
        .expect("pool creation must succeed")
}

/// Drop all limen tables (cleanup between tests).
async fn drop_all_tables(pool: &deadpool_postgres::Pool) {
    let client = pool.get().await.expect("connection for cleanup");
    client
        .batch_execute(
            "DROP TABLE IF EXISTS chain_entries CASCADE;
             DROP TABLE IF EXISTS projection_certificates CASCADE;
             DROP TABLE IF EXISTS projection_metadata CASCADE;
             DROP TABLE IF EXISTS committed_transitions CASCADE;
             DROP TABLE IF EXISTS governance_state_at CASCADE;
             DROP TABLE IF EXISTS authority_state_at CASCADE;
             DROP TABLE IF EXISTS refusal_records CASCADE;
             DROP FUNCTION IF EXISTS limen_projection_tamper_check CASCADE;",
        )
        .await
        .expect("cleanup must succeed");
}

// ================================================================
// Test 1: Schema creation is idempotent
// ================================================================

#[tokio::test]
#[ignore]
async fn test_schema_creation() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    let projection = PostgresProjectionStorage::new(pool.clone());

    // First apply
    chain.apply_schema().await.expect("first chain schema apply");
    projection
        .apply_schema()
        .await
        .expect("first projection schema apply");

    // Second apply (idempotent)
    chain
        .apply_schema()
        .await
        .expect("second chain schema apply must be idempotent");
    projection
        .apply_schema()
        .await
        .expect("second projection schema apply must be idempotent");

    // Verify tables exist by querying them
    let client = pool.get().await.expect("connection");
    let count: i64 = client
        .query_one("SELECT COUNT(*) FROM chain_entries", &[])
        .await
        .expect("chain_entries must exist")
        .get(0);
    assert_eq!(count, 0, "chain_entries should be empty after fresh schema");

    let count: i64 = client
        .query_one("SELECT COUNT(*) FROM projection_metadata", &[])
        .await
        .expect("projection_metadata must exist")
        .get(0);
    assert_eq!(count, 0);

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 2: Chain append and read round-trip
// ================================================================

#[tokio::test]
#[ignore]
async fn test_chain_append_and_read() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    chain.apply_schema().await.expect("schema");

    let zero_hash = vec![0u8; 32];
    let entry_hash = blake3::hash(b"genesis payload").as_bytes().to_vec();
    let payload = json!({"type": "genesis", "data": "initial"});

    // Append genesis
    let seq = chain
        .append_entry(0, &entry_hash, &zero_hash, "tenant-1", "genesis", &payload)
        .await
        .expect("append genesis");
    assert_eq!(seq, 0);

    // Read it back
    let entry = chain
        .read_entry_async(0)
        .await
        .expect("read entry")
        .expect("entry must exist");

    assert_eq!(entry.sequence, 0);
    assert_eq!(entry.entry_hash, entry_hash);
    assert_eq!(entry.prev_hash, zero_hash);
    assert_eq!(entry.tenant_scope, "tenant-1");
    assert_eq!(entry.entry_type, "genesis");
    assert_eq!(entry.payload, payload);

    // Read non-existent
    let missing = chain
        .read_entry_async(999)
        .await
        .expect("read missing");
    assert!(missing.is_none());

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 3: Chain verify (hash chain integrity)
// ================================================================

#[tokio::test]
#[ignore]
async fn test_chain_verify() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    chain.apply_schema().await.expect("schema");

    // Empty chain verifies as 0
    let count = chain.verify_chain().await.expect("verify empty");
    assert_eq!(count, 0);

    // Build a 5-entry chain
    let zero_hash = vec![0u8; 32];
    let mut prev = zero_hash.clone();

    for i in 0..5i64 {
        let data = format!("entry-{}", i);
        let entry_hash = blake3::hash(data.as_bytes()).as_bytes().to_vec();
        let payload = json!({"index": i});

        chain
            .append_entry(i, &entry_hash, &prev, "tenant-1", "data", &payload)
            .await
            .expect("append");

        prev = entry_hash;
    }

    // Verify passes
    let verified = chain.verify_chain().await.expect("verify chain");
    assert_eq!(verified, 5);

    // Corrupt entry 3's prev_hash directly
    let client = pool.get().await.expect("connection");
    client
        .execute(
            "UPDATE chain_entries SET prev_hash = $1 WHERE sequence = 3",
            &[&vec![0xFFu8; 32]],
        )
        .await
        .expect("corrupt entry");

    // Verify should fail at sequence 3
    let err = chain.verify_chain().await.expect_err("should fail");
    match err {
        PostgresStorageError::ChainIntegrity { sequence, .. } => {
            assert_eq!(sequence, 3);
        }
        other => panic!("expected ChainIntegrity, got: {:?}", other),
    }

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 4: Projection CRUD (all 5 tables)
// ================================================================

#[tokio::test]
#[ignore]
async fn test_projection_crud() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let proj = PostgresProjectionStorage::new(pool.clone());
    proj.apply_schema().await.expect("schema");

    let tenant = "tenant-crud";

    // Metadata: insert then read
    proj.upsert_metadata(tenant, 10, &[1u8; 32])
        .await
        .expect("upsert metadata");

    let meta = proj
        .get_metadata(tenant)
        .await
        .expect("get metadata")
        .expect("metadata must exist");
    assert_eq!(meta.last_applied_seq, 10);

    // Transition: insert then read
    let tid = proj
        .insert_transition(tenant, 5, "created", "active", "activate", &json!({"by": "admin"}))
        .await
        .expect("insert transition");
    assert!(tid > 0);

    let transitions = proj
        .read_transitions(tenant, None)
        .await
        .expect("read transitions");
    assert_eq!(transitions.len(), 1);
    assert_eq!(transitions[0].from_state, "created");
    assert_eq!(transitions[0].to_state, "active");

    // Governance state: upsert then read
    proj.upsert_governance_state(tenant, "policy-1", 10, &json!({"allowed": true}))
        .await
        .expect("upsert governance");

    let gov = proj
        .read_latest_governance_state(tenant, "policy-1")
        .await
        .expect("read governance")
        .expect("governance must exist");
    assert_eq!(gov.chain_sequence, 10);

    // Authority state: upsert then read
    proj.upsert_authority_state(tenant, "actor-1", 10, &json!({"roles": ["admin"]}))
        .await
        .expect("upsert authority");

    let auth = proj
        .read_latest_authority_state(tenant, "actor-1")
        .await
        .expect("read authority")
        .expect("authority must exist");
    assert_eq!(auth.chain_sequence, 10);

    // Refusal: insert then read
    let rid = proj
        .insert_refusal(tenant, 8, "policy_violation", &json!({"detail": "exceeded limit"}))
        .await
        .expect("insert refusal");
    assert!(rid > 0);

    let refusals = proj.read_refusals(tenant).await.expect("read refusals");
    assert_eq!(refusals.len(), 1);
    assert_eq!(refusals[0].refusal_reason, "policy_violation");

    // Row counts
    let counts = proj.row_count(tenant).await.expect("row counts");
    assert_eq!(counts.metadata, 1);
    assert_eq!(counts.transitions, 1);
    assert_eq!(counts.governance, 1);
    assert_eq!(counts.authority, 1);
    assert_eq!(counts.refusals, 1);
    assert_eq!(counts.total(), 5);

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 5: Certificate CRUD
// ================================================================

#[tokio::test]
#[ignore]
async fn test_certificate_crud() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    chain.apply_schema().await.expect("schema");

    // No certificates initially
    let latest = chain
        .get_latest_projection_certificate()
        .await
        .expect("get latest");
    assert!(latest.is_none());

    // Insert certificates
    chain
        .insert_projection_certificate(10, &[1u8; 32], &[2u8; 32], &json!({"valid": true}))
        .await
        .expect("insert cert 1");

    chain
        .insert_projection_certificate(20, &[3u8; 32], &[4u8; 32], &json!({"valid": true}))
        .await
        .expect("insert cert 2");

    // Latest should be sequence 20
    let latest = chain
        .get_latest_projection_certificate()
        .await
        .expect("get latest")
        .expect("cert must exist");
    assert_eq!(latest.chain_sequence, 20);
    assert_eq!(latest.projection_hash, vec![3u8; 32]);

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 6: Latest sequence tracking
// ================================================================

#[tokio::test]
#[ignore]
async fn test_latest_sequence() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    chain.apply_schema().await.expect("schema");

    // Empty chain: None
    let latest = chain.latest_sequence().await.expect("latest");
    assert!(latest.is_none());

    // Add entries
    let zero_hash = vec![0u8; 32];
    let hash1 = blake3::hash(b"e1").as_bytes().to_vec();
    let hash2 = blake3::hash(b"e2").as_bytes().to_vec();

    chain
        .append_entry(0, &hash1, &zero_hash, "t1", "data", &json!({}))
        .await
        .expect("append 0");

    let latest = chain.latest_sequence().await.expect("latest");
    assert_eq!(latest, Some(0));

    chain
        .append_entry(1, &hash2, &hash1, "t1", "data", &json!({}))
        .await
        .expect("append 1");

    let latest = chain.latest_sequence().await.expect("latest");
    assert_eq!(latest, Some(1));

    // Entry count
    let count = chain.entry_count().await.expect("count");
    assert_eq!(count, 2);

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 7: Tamper detection (projection sequence regression)
// ================================================================

#[tokio::test]
#[ignore]
async fn test_tamper_detection() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let proj = PostgresProjectionStorage::new(pool.clone());
    proj.apply_schema().await.expect("schema");

    let tenant = "tenant-tamper";

    // Set initial sequence
    proj.upsert_metadata(tenant, 10, &[1u8; 32])
        .await
        .expect("initial metadata");

    // Advance sequence (allowed)
    proj.upsert_metadata(tenant, 20, &[2u8; 32])
        .await
        .expect("advance sequence");

    // Regress sequence (must be rejected by trigger)
    let result = proj.upsert_metadata(tenant, 5, &[3u8; 32]).await;
    assert!(
        result.is_err(),
        "sequence regression must be rejected by tamper trigger"
    );

    // Verify the original data is intact
    let meta = proj
        .get_metadata(tenant)
        .await
        .expect("get metadata")
        .expect("metadata must exist");
    assert_eq!(
        meta.last_applied_seq, 20,
        "sequence must remain at 20 after rejected regression"
    );

    drop_all_tables(&pool).await;
}

// ================================================================
// Test 8: Migration pipeline (in-process, no real SQLite)
// ================================================================

#[tokio::test]
#[ignore]
async fn test_migration_sqlite_to_postgres() {
    let pool = test_pool().await;
    drop_all_tables(&pool).await;

    let chain = PostgresChainStorage::new(pool.clone());
    let proj = PostgresProjectionStorage::new(pool.clone());

    chain.apply_schema().await.expect("chain schema");
    proj.apply_schema().await.expect("projection schema");

    // Build source data (simulating SQLite export)
    let zero_hash = vec![0u8; 32];
    let hash0 = blake3::hash(b"entry-0").as_bytes().to_vec();
    let hash1 = blake3::hash(b"entry-1").as_bytes().to_vec();
    let hash2 = blake3::hash(b"entry-2").as_bytes().to_vec();

    let source_entries = vec![
        SourceChainEntry {
            sequence: 0,
            entry_hash: hash0.clone(),
            prev_hash: zero_hash.clone(),
            tenant_scope: "tenant-mig".into(),
            entry_type: "genesis".into(),
            payload: json!({"i": 0}),
        },
        SourceChainEntry {
            sequence: 1,
            entry_hash: hash1.clone(),
            prev_hash: hash0.clone(),
            tenant_scope: "tenant-mig".into(),
            entry_type: "data".into(),
            payload: json!({"i": 1}),
        },
        SourceChainEntry {
            sequence: 2,
            entry_hash: hash2.clone(),
            prev_hash: hash1.clone(),
            tenant_scope: "tenant-mig".into(),
            entry_type: "data".into(),
            payload: json!({"i": 2}),
        },
    ];

    let source_certs = vec![SourceCertificate {
        chain_sequence: 2,
        projection_hash: vec![0xAA; 32],
        chain_hash: hash2.clone(),
        certificate: json!({"valid": true}),
    }];

    let source_projection = SourceProjectionData {
        metadata: vec![SourceMetadata {
            tenant_scope: "tenant-mig".into(),
            last_applied_seq: 2,
            projection_digest: vec![0xBB; 32],
        }],
        transitions: vec![SourceTransition {
            tenant_scope: "tenant-mig".into(),
            chain_sequence: 1,
            from_state: "init".into(),
            to_state: "active".into(),
            transition_type: "activate".into(),
            payload: json!({}),
        }],
        governance_states: vec![SourceGovernanceState {
            tenant_scope: "tenant-mig".into(),
            policy_id: "default".into(),
            chain_sequence: 2,
            state: json!({"enabled": true}),
        }],
        authority_states: vec![SourceAuthorityState {
            tenant_scope: "tenant-mig".into(),
            actor_id: "admin".into(),
            chain_sequence: 2,
            authorities: json!({"roles": ["owner"]}),
        }],
        refusals: vec![SourceRefusal {
            tenant_scope: "tenant-mig".into(),
            chain_sequence: 1,
            refusal_reason: "test_refusal".into(),
            context: json!({"test": true}),
        }],
    };

    // Run migration
    let report = migrate_sqlite_to_postgres(
        &chain,
        &proj,
        source_entries,
        source_certs,
        source_projection,
    )
    .await
    .expect("migration must succeed");

    // Verify report
    assert_eq!(report.chain_entries_migrated, 3);
    assert_eq!(report.certificates_migrated, 1);
    assert_eq!(report.projection_metadata_migrated, 1);
    assert_eq!(report.transitions_migrated, 1);
    assert_eq!(report.governance_states_migrated, 1);
    assert_eq!(report.authority_states_migrated, 1);
    assert_eq!(report.refusals_migrated, 1);
    assert_eq!(report.total_rows(), 9);
    assert!(report.is_clean(), "migration must have no errors: {:?}", report.errors);
    assert!(report.chain_verified(), "chain must be verified");
    assert_eq!(report.chain_entries_verified, 3);

    // Verify data in Postgres
    let latest = chain.latest_sequence().await.expect("latest");
    assert_eq!(latest, Some(2));

    let entry = chain
        .read_entry_async(1)
        .await
        .expect("read")
        .expect("must exist");
    assert_eq!(entry.tenant_scope, "tenant-mig");

    let cert = chain
        .get_latest_projection_certificate()
        .await
        .expect("cert")
        .expect("must exist");
    assert_eq!(cert.chain_sequence, 2);

    let meta = proj
        .get_metadata("tenant-mig")
        .await
        .expect("metadata")
        .expect("must exist");
    assert_eq!(meta.last_applied_seq, 2);

    // Print report for manual inspection
    println!("{}", report);

    drop_all_tables(&pool).await;
}
