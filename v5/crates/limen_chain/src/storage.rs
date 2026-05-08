//! SQLite chain storage — opens DB, configures WAL, holds connection.
//! Storage-layer types that do NOT redefine v1.3 §0.7 contract types.

use std::path::Path;
use std::sync::Mutex;
use rusqlite::Connection;
use crate::schema;

/// Profile configuration for SQLite sync mode.
#[derive(Debug, Clone, Copy)]
pub enum SyncMode {
    /// Profile 1: NORMAL (dev speed; loss of last commit on crash acceptable)
    Normal,
    /// Profile 2: FULL (production durability)
    Full,
}

/// SQLite chain storage. Wraps a mutex-protected connection.
/// Commit is the only API for chain modification (v1.3 §6.4).
pub struct SqliteChainStorage {
    pub(crate) conn: Mutex<Connection>,
}

impl SqliteChainStorage {
    /// Acquire the connection lock for test and verification use only.
    ///
    /// F-09 fix: hidden from public API documentation. External production
    /// code MUST use `ChainReadContext` or `ChainCommitSink` for chain access.
    /// This method exists solely for schema introspection, tamper-injection
    /// tests, and chain verification (`verify.rs` uses `conn` directly).
    #[doc(hidden)]
    pub fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, ChainStorageError> {
        self.conn.lock().map_err(|_| ChainStorageError::LockPoisoned)
    }

    /// Open or create a chain database at the given path.
    pub fn open(path: impl AsRef<Path>, sync_mode: SyncMode) -> Result<Self, ChainStorageError> {
        let conn = Connection::open(path)?;

        // WAL mode required (v1.3 §6.3)
        conn.pragma_update(None, "journal_mode", "WAL")?;

        // Sync mode per profile
        let sync = match sync_mode {
            SyncMode::Normal => "NORMAL",
            SyncMode::Full => "FULL",
        };
        conn.pragma_update(None, "synchronous", sync)?;

        // Apply schema
        schema::apply_schema(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory chain database (for testing).
    pub fn open_in_memory(sync_mode: SyncMode) -> Result<Self, ChainStorageError> {
        let conn = Connection::open_in_memory()?;

        let sync = match sync_mode {
            SyncMode::Normal => "NORMAL",
            SyncMode::Full => "FULL",
        };
        conn.pragma_update(None, "synchronous", sync)?;

        schema::apply_schema(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

/// Chain storage errors.
#[derive(Debug)]
pub enum ChainStorageError {
    Sqlite(rusqlite::Error),
    IntegrityViolation(String),
    LockPoisoned,
}

impl From<rusqlite::Error> for ChainStorageError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Sqlite(e)
    }
}
