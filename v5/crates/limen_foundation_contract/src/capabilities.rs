//! Typed, unforgeable, substrate-owned read capabilities (v1.3 §2.1).
//!
//! `FoundationReadCapability` — bound to canonical chain state.
//! `ProjectionReadCapability` — bound to materialized view state.
//! No conversion between them. No public constructor.

use std::marker::PhantomData;
use limen_types::*;
use crate::chain::*;

/// Opaque chain-read interface (v1.3 §2.1).
/// Implemented by storage layers (`limen_chain` for SQLite-backed Profile 1/2;
/// future `limen_consensus` for Profile 3+) outside the foundation contract crate.
/// Foundation operations see only this trait; never SQLite or consensus protocols.
pub trait ChainReadContext {
    fn read_entry(&self, sequence: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError>;
    fn read_tenant_state(&self, scope: &TenantScope) -> Result<TenantChainState, ChainReadError>;
    fn read_governance_state_at(
        &self,
        scope: &TenantScope,
        policy_id: &PolicyId,
    ) -> Result<Option<GovernanceState>, ChainReadError>;
    fn read_authority_state_at(
        &self,
        scope: &TenantScope,
        actor: &Actor,
    ) -> Result<Vec<AuthorityState>, ChainReadError>;
    fn read_cascade_link(&self, prior: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError>;
    fn freshness_marker(&self) -> FreshnessMarker;
}

/// Foundation read capability. Bound to an opaque `ChainReadContext` for the
/// duration of one commit transaction. The `'ctx` lifetime ties chain reads to
/// the active transaction snapshot/lock; the capability cannot outlive the
/// dispatch scope (v1.3 §2.1).
///
/// **No public constructor.** Construction is private to the substrate's
/// minting infrastructure in `limen_substrate_runtime`.
///
/// **No conversion to/from `ProjectionReadCapability`.** The type system
/// rejects any attempt.
pub struct FoundationReadCapability<'ctx> {
    reader: &'ctx dyn ChainReadContext,
    scope: TenantScope,
    _seal: PhantomData<*const ()>, // !Send + !Sync
}

// No Default, no Clone for FoundationReadCapability.
// PhantomData<*const ()> prevents auto-derive of Send/Sync.

impl<'ctx> FoundationReadCapability<'ctx> {
    /// Private constructor. Only callable from within this crate's minting module
    /// or by `limen_substrate_runtime` via the `mint` function below.
    pub(crate) fn mint(reader: &'ctx dyn ChainReadContext, scope: TenantScope) -> Self {
        Self {
            reader,
            scope,
            _seal: PhantomData,
        }
    }

    /// Read chain state through the bound ChainReadContext.
    pub fn read_entry(&self, sequence: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> {
        self.reader.read_entry(sequence)
    }

    pub fn read_tenant_state(&self) -> Result<TenantChainState, ChainReadError> {
        self.reader.read_tenant_state(&self.scope)
    }

    pub fn read_governance_state(
        &self,
        policy_id: &PolicyId,
    ) -> Result<Option<GovernanceState>, ChainReadError> {
        self.reader.read_governance_state_at(&self.scope, policy_id)
    }

    pub fn read_authority_state(
        &self,
        actor: &Actor,
    ) -> Result<Vec<AuthorityState>, ChainReadError> {
        self.reader.read_authority_state_at(&self.scope, actor)
    }

    pub fn read_cascade_link(&self, prior: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> {
        self.reader.read_cascade_link(prior)
    }

    pub fn freshness_marker(&self) -> FreshnessMarker {
        self.reader.freshness_marker()
    }

    pub fn tenant_scope(&self) -> &TenantScope {
        &self.scope
    }
}

/// Non-authoritative wrapper for projection-derived data (v1.3 §2.3).
/// No `into_inner` that strips the marker. Consuming code must use
/// substrate-aware adapters or pattern-matched extraction in non-foundation contexts.
#[derive(Debug, Clone)]
pub struct NonAuthoritative<T>(T);

impl<T> NonAuthoritative<T> {
    /// Construct a `NonAuthoritative` wrapper around a projection-derived value.
    ///
    /// `pub(crate)` — only projection internals may wrap values. External code
    /// receives `NonAuthoritative<T>` from substrate queries, never constructs it.
    #[allow(dead_code)] // Reserved for projection layer (Phase 2)
    pub(crate) fn wrap(value: T) -> Self {
        Self(value)
    }

    /// Access the inner value by reference. The `NonAuthoritative` wrapper
    /// remains — the caller sees the value but cannot strip the marker.
    pub fn as_ref(&self) -> &T {
        &self.0
    }

    /// Map over the inner value, preserving the non-authoritative wrapper.
    pub fn map<U, F: FnOnce(T) -> U>(self, f: F) -> NonAuthoritative<U> {
        NonAuthoritative(f(self.0))
    }
}

/// Projection read capability. Bound to materialized view state.
/// Used for non-foundation-relevant operations only (v1.3 §2.1).
///
/// **No public constructor.** No conversion to/from `FoundationReadCapability`.
pub struct ProjectionReadCapability {
    _scope: TenantScope,
    _seal: PhantomData<*const ()>, // !Send + !Sync
}

impl ProjectionReadCapability {
    pub(crate) fn mint(scope: TenantScope) -> Self {
        Self {
            _scope: scope,
            _seal: PhantomData,
        }
    }
}

// Explicit: NO From, Into, AsRef, or any conversion between the two capability types.
// NO generic ReadCapability parent type. This is the Layer 3 exclusion (v1.3 §2.3).

/// Test-only constructors. Available only when `test-support` feature is enabled.
/// These are NOT production API — they exist so downstream test crates can
/// construct capabilities for testing without depending on limen_substrate_runtime.
#[cfg(feature = "test-support")]
impl<'ctx> FoundationReadCapability<'ctx> {
    pub fn test_mint(reader: &'ctx dyn ChainReadContext, scope: TenantScope) -> Self {
        Self::mint(reader, scope)
    }
}

#[cfg(feature = "test-support")]
impl ProjectionReadCapability {
    pub fn test_mint(scope: TenantScope) -> Self {
        Self::mint(scope)
    }
}
