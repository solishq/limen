//! SubstrateRuntimeEnvelope and related types (v1.3 §3.1, §5.1).

use std::marker::PhantomData;
use serde::{Serialize, Deserialize};
use limen_types::*;

/// Transaction-scoped runtime context. Built once per commit transaction.
/// Stable across all foundation operations within one commit (v1.3 §3.1).
///
/// **No public constructor.** Minted by substrate request handler.
pub struct TransactionRuntimeContext {
    pub(crate) request_boundary: RequestBoundary,
    pub(crate) actor_identity: ActorIdentity,
    pub(crate) tenant_scope: TenantScope,
    pub(crate) trace_identity: TraceIdentity,
    _seal: PhantomData<*const ()>,
}

impl TransactionRuntimeContext {
    pub(crate) fn mint(
        request_boundary: RequestBoundary,
        actor_identity: ActorIdentity,
        tenant_scope: TenantScope,
        trace_identity: TraceIdentity,
    ) -> Self {
        Self { request_boundary, actor_identity, tenant_scope, trace_identity, _seal: PhantomData }
    }

    pub fn request_boundary(&self) -> &RequestBoundary { &self.request_boundary }
    pub fn actor_identity(&self) -> &ActorIdentity { &self.actor_identity }
    pub fn tenant_scope(&self) -> &TenantScope { &self.tenant_scope }
    pub fn trace_identity(&self) -> &TraceIdentity { &self.trace_identity }
}

/// Per-operation runtime envelope (v1.3 §3.1, §3.3).
pub struct SubstrateRuntimeEnvelope<'tx> {
    pub(crate) transaction: &'tx TransactionRuntimeContext,
    pub(crate) operation: OperationScopedFields,
    _seal: PhantomData<*const ()>,
}

impl<'tx> SubstrateRuntimeEnvelope<'tx> {
    pub(crate) fn mint(
        transaction: &'tx TransactionRuntimeContext,
        operation: OperationScopedFields,
    ) -> Self {
        Self { transaction, operation, _seal: PhantomData }
    }

    pub fn transaction(&self) -> &TransactionRuntimeContext { self.transaction }
    pub fn operation(&self) -> &OperationScopedFields { &self.operation }
}

#[cfg(feature = "test-support")]
impl TransactionRuntimeContext {
    pub fn test_mint(
        request_boundary: RequestBoundary,
        actor_identity: ActorIdentity,
        tenant_scope: TenantScope,
        trace_identity: TraceIdentity,
    ) -> Self {
        Self::mint(request_boundary, actor_identity, tenant_scope, trace_identity)
    }
}

#[cfg(feature = "test-support")]
impl<'tx> SubstrateRuntimeEnvelope<'tx> {
    pub fn test_mint(
        transaction: &'tx TransactionRuntimeContext,
        operation: OperationScopedFields,
    ) -> Self {
        Self::mint(transaction, operation)
    }
}

/// Operation-scoped fields. Fresh per foundation operation (v1.3 §3.2).
#[derive(Debug, Clone)]
pub struct OperationScopedFields {
    pub substrate_clock: SubstrateInstant,
    pub invocation_identity: InvocationId,
    pub operation_type: OperationType,
    pub execution_context: ExecutionContext,
    pub chain_read_freshness: FreshnessMarker,
}

/// Substrate metadata at commit/refusal time (v1.3 §6.1).
/// Serializable for chain entry persistence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitEnvelope {
    pub request_boundary: RequestBoundary,
    pub actor_identity: ActorIdentity,
    pub tenant_scope: TenantScope,
    pub trace_identity: TraceIdentity,
    pub committed_at: SubstrateInstant,
}
