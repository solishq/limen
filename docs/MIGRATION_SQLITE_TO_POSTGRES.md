<!-- @governance SolisForge Protocol v1.4 — Sole Governing Doctrine -->
<!-- @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1 -->

# Limen v5: SQLite to PostgreSQL Migration Guide

## Prerequisites

- PostgreSQL 14+ (tested with 14, 15, 16)
- `limen_postgres` crate compiled with your Limen v5 application
- Network access from application host to PostgreSQL instance
- Sufficient disk space: Postgres uses ~1.3x the SQLite file size

## 1. Create the Database

```sql
CREATE DATABASE limen;
CREATE USER limen WITH PASSWORD '<strong-password>';
GRANT ALL PRIVILEGES ON DATABASE limen TO limen;
-- Required for trigger creation:
ALTER DATABASE limen OWNER TO limen;
```

## 2. Configure Connection

Set the connection string as an environment variable:

```bash
export LIMEN_PG_URL="postgres://limen:<password>@<host>:5432/limen"
```

Or in your application configuration:

```rust
let config = "postgres://limen:pass@localhost:5432/limen"
    .parse::<tokio_postgres::Config>()?;
let mgr = deadpool_postgres::Manager::from_config(
    config, tokio_postgres::NoTls, mgr_config);
let pool = deadpool_postgres::Pool::builder(mgr)
    .max_size(16).build()?;
```

## 3. Apply Schema

```rust
let chain = PostgresChainStorage::new(pool.clone());
let projection = PostgresProjectionStorage::new(pool.clone());
chain.apply_schema().await?;
projection.apply_schema().await?;
```

Both calls are idempotent. Safe to run on every application startup.

## 4. Run Migration

```rust
use limen_postgres::migrate::*;

// Export from SQLite (adapt to your SQLite storage types)
let source_entries = sqlite_chain.read_all_entries()?;
let source_certs = sqlite_chain.read_all_certificates()?;
let source_projection = export_sqlite_projection(&sqlite_proj)?;

let report = migrate_sqlite_to_postgres(
    &pg_chain, &pg_projection,
    source_entries, source_certs, source_projection,
).await?;

println!("{}", report);
assert!(report.is_clean());
assert!(report.chain_verified());
```

## 5. Verify Integrity

After migration, independently verify the chain:

```rust
let verified = pg_chain.verify_chain().await?;
assert_eq!(verified, report.chain_entries_migrated);
```

Compare row counts between SQLite and Postgres to confirm
completeness.

## 6. Switch Application Config

Update your application to use `PostgresChainStorage` instead of
`SqliteChainStorage`. Both implement `ChainReadContext`, so the
switch is a construction-site change — no interface changes needed.

Keep the SQLite file as a backup for at least 30 days.

## 7. Sharding Guidance (>10M entries)

For chains exceeding 10 million entries, partition the Postgres
tables by `tenant_scope`:

```sql
-- Convert to partitioned table
CREATE TABLE chain_entries_partitioned (
    LIKE chain_entries INCLUDING ALL
) PARTITION BY LIST (tenant_scope);

-- Create per-tenant partitions
CREATE TABLE chain_entries_tenant_1
    PARTITION OF chain_entries_partitioned
    FOR VALUES IN ('tenant-1');

-- Repeat for each tenant, or use a default partition:
CREATE TABLE chain_entries_default
    PARTITION OF chain_entries_partitioned
    DEFAULT;
```

Apply the same partitioning to `committed_transitions`,
`governance_state_at`, `authority_state_at`, and `refusal_records`.

Benefits of tenant-scoped partitioning:
- Partition pruning eliminates full-table scans
- Per-tenant VACUUM and maintenance windows
- Independent backup/restore per tenant
- Future: partition placement across nodes

## Rollback

If migration fails or Postgres proves unsuitable:

1. Stop the application
2. Revert config to SQLite storage constructors
3. Restart — SQLite file is untouched by migration
4. Drop the Postgres database: `DROP DATABASE limen;`
