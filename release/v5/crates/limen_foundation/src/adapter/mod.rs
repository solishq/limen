//! Canonical Rust adapter trait.
//! Contract refs: AGENT_ADAPTER_ARCHITECTURE.md §§3, 5, 8-12; CREWAI_ADAPTER_CONTRACT.md §3; Phase 1 prompt action 4.

use crate::lifecycle::AdapterLifecycleState;
use crate::types::{
    AdapterId, AdapterKernelError, AdapterRefusalHint, AdapterResult, AdapterSandboxDefaults,
    AgentCapability, AgentEventPayload, AgentFramework, AgentId, AgentMemoryOptions,
    AgentRecallOptions, AgentRecallQuery, AgentSession, AgentTrustLevel, ClaimId,
    ClassificationLevel, ComputerAction, GovernanceContext, MergeStrategy, NativeAgentAction,
    OperationContext, RateLimitPolicy, RelationshipType, SessionSummary, StructuredContent,
    TenantId,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterConfig {
    pub agent_id: AgentId,
    pub tenant_id: Option<TenantId>,
    pub trust_level: AgentTrustLevel,
    pub default_classification: ClassificationLevel,
    pub capabilities: HashSet<AgentCapability>,
    pub rate_limits: Vec<RateLimitPolicy>,
    pub sandbox_defaults: AdapterSandboxDefaults,
    pub refusal_hints: Vec<AdapterRefusalHint>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterHealth {
    pub status: HealthStatus,
    pub lifecycle_state: AdapterLifecycleState,
    pub last_activity: Option<String>,
    pub active_sessions: u32,
    pub error_count: u64,
    pub uptime_ms: u64,
    pub core_port_connected: bool,
    pub token_budget_remaining: u64,
    pub token_budget_total: u64,
    pub last_error: Option<String>,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentToolCall {
    pub tool_name: String,
    pub tool_args: Value,
    pub call_id: String,
    pub agent_framework: AgentFramework,
    pub raw_payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LimenOperation {
    Remember {
        content: MemoryContent,
        options: Option<AgentMemoryOptions>,
    },
    Recall {
        query: AgentRecallQuery,
        options: Option<AgentRecallOptions>,
    },
    Forget {
        entry_id: ClaimId,
        reason: String,
    },
    GetBelief {
        belief_id: ClaimId,
    },
    CreateBranch {
        base_belief_id: ClaimId,
        description: String,
    },
    MergeBranches {
        branch_ids: Vec<String>,
        strategy: MergeStrategy,
    },
    DiscardBranch {
        branch_id: String,
    },
    Relate {
        from_id: ClaimId,
        to_id: ClaimId,
        relation_type: RelationshipType,
    },
    CheckPermission {
        action: ComputerAction,
        context: Box<GovernanceContext>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MemoryContent {
    Text(String),
    Structured(StructuredContent),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OperationResult {
    pub operation_type: String,
    pub audit_id: String,
    pub value: Value,
}

#[async_trait]
pub trait AgentMemoryBridge: Send + Sync {
    async fn execute(&self, operation: LimenOperation) -> AdapterResult<OperationResult>;
}

#[async_trait]
pub trait ComputerActionGovernor: Send + Sync {
    async fn before_action(
        &self,
        action: &ComputerAction,
        context: &GovernanceContext,
    ) -> AdapterResult<crate::types::GovernanceVerdict>;
    async fn after_action(
        &self,
        action: &ComputerAction,
        result: &AdapterResult<Value>,
    ) -> AdapterResult<()>;
}

#[async_trait]
pub trait AgentAdapter: Send + Sync + 'static {
    fn adapter_id(&self) -> &AdapterId;
    fn agent_framework(&self) -> AgentFramework;
    fn version(&self) -> &str;
    fn capabilities(&self) -> &HashSet<AgentCapability>;

    async fn initialize(
        &mut self,
        client: Arc<dyn AgentMemoryBridge>,
        governor: Arc<dyn ComputerActionGovernor>,
        config: AdapterConfig,
    ) -> AdapterResult<()>;

    async fn shutdown(&mut self) -> AdapterResult<()>;

    async fn translate_tool_call(
        &self,
        tool_call: &AgentToolCall,
    ) -> AdapterResult<Vec<LimenOperation>>;

    async fn translate_action_to_governance(
        &self,
        action: &NativeAgentAction,
    ) -> AdapterResult<ComputerAction>;

    async fn on_session_start(&self, native_session: &Value) -> AdapterResult<AgentSession>;

    async fn on_session_end(&self, native_session: &Value) -> AdapterResult<SessionSummary>;

    fn map_native_event(&self, native_event: &Value) -> Option<AgentEventPayload>;

    fn map_limen_event(&self, limen_event: &AgentEventPayload) -> Option<Value>;

    async fn health_check(&self) -> AdapterResult<AdapterHealth>;

    async fn execute(
        &self,
        operation: OperationContext,
    ) -> Result<OperationResult, AdapterKernelError>;
}
