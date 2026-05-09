// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! SQLite schema for chain storage (v1.3 §6.3).
//! The DDL is a canonical string constant. Schema integrity tests assert
//! byte-for-byte equality and semantic introspection after migration.

/// Canonical migration DDL per v1.3 §6.3. Byte-for-byte test target.
pub const CHAIN_SCHEMA_DDL: &str = r#"CREATE TABLE chain_entries (
    global_sequence  INTEGER PRIMARY KEY NOT NULL,
    tenant_scope     TEXT NOT NULL,
    tenant_sequence  INTEGER NOT NULL,
    content_hash     BLOB NOT NULL UNIQUE,
    previous_hash    BLOB,
    entry_kind       TEXT NOT NULL,
    canonical_at     INTEGER NOT NULL,
    payload          BLOB NOT NULL,
    UNIQUE (tenant_scope, tenant_sequence)
);
CREATE INDEX idx_global_sequence ON chain_entries(global_sequence);
CREATE INDEX idx_tenant_sequence ON chain_entries(tenant_scope, tenant_sequence);
CREATE INDEX idx_kind_time ON chain_entries(entry_kind, canonical_at);
CREATE TABLE tenant_chain_state (
    tenant_scope          TEXT PRIMARY KEY NOT NULL,
    next_tenant_sequence  INTEGER NOT NULL,
    last_hash             BLOB
);
CREATE TABLE global_chain_state (
    id                     INTEGER PRIMARY KEY CHECK (id = 1),
    next_global_sequence   INTEGER NOT NULL
);"#;

/// Apply the chain schema to a SQLite connection.
pub fn apply_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(CHAIN_SCHEMA_DDL)?;
    // Initialize global_chain_state with sequence 0
    conn.execute(
        "INSERT OR IGNORE INTO global_chain_state (id, next_global_sequence) VALUES (1, 0)",
        [],
    )?;
    Ok(())
}
