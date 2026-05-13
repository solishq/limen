//! Mandatory governance engine.
//! Contract refs: SHARED_TYPES.md §§8-10.1, §20; AGENT_ADAPTER_ARCHITECTURE.md Invariant 8.

use crate::types::{
    AdapterErrorCode, AdapterId, AdapterKernelError, AdapterResult, EventId, GovernanceContext,
    GovernanceDecision, GovernanceVerdict, Permission,
};
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GovernanceRequirement {
    pub required_permissions: Vec<Permission>,
    pub clearance_required: Option<u8>,
    pub rule: String,
}

#[derive(Debug, Clone)]
pub struct GovernanceEngine {
    adapter_id: AdapterId,
    max_evaluation_ms: u128,
}

impl GovernanceEngine {
    pub fn new(adapter_id: AdapterId) -> Self {
        Self {
            adapter_id,
            max_evaluation_ms: 10,
        }
    }

    pub fn evaluate(
        &self,
        context: &GovernanceContext,
        requirement: &GovernanceRequirement,
        audit_id: EventId,
        evaluated_at: String,
    ) -> AdapterResult<GovernanceDecision> {
        let started = Instant::now();
        let missing_permissions = requirement
            .required_permissions
            .iter()
            .copied()
            .filter(|permission| !context.operation_context.permissions.contains(permission))
            .collect::<Vec<_>>();
        let actual_clearance = context.operation_context.clearance_level.unwrap_or(0);
        let clearance_denied = requirement
            .clearance_required
            .is_some_and(|required| actual_clearance < required);
        let decision = if missing_permissions.is_empty() && !clearance_denied {
            GovernanceDecision {
                allowed: true,
                verdict: GovernanceVerdict::Allow {
                    audit_id,
                    conditions: None,
                },
                reason: None,
                required_permissions: requirement.required_permissions.clone(),
                missing_permissions,
                clearance_required: requirement.clearance_required,
                clearance_actual: Some(actual_clearance),
                evaluated_at,
            }
        } else {
            GovernanceDecision {
                allowed: false,
                verdict: GovernanceVerdict::Refuse {
                    audit_id,
                    reason: "missing_required_permission_or_clearance".to_owned(),
                    rule: requirement.rule.clone(),
                    alternatives: None,
                },
                reason: Some("missing_required_permission_or_clearance".to_owned()),
                required_permissions: requirement.required_permissions.clone(),
                missing_permissions,
                clearance_required: requirement.clearance_required,
                clearance_actual: Some(actual_clearance),
                evaluated_at,
            }
        };
        if started.elapsed().as_millis() > self.max_evaluation_ms {
            return Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::PerformanceBudgetExceeded,
                "Governance evaluation exceeded performance budget.",
                "SHARED_TYPES.md §20",
            ));
        }
        if decision.allowed != matches!(decision.verdict, GovernanceVerdict::Allow { .. }) {
            return Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::GovernanceUnavailable,
                "Governance decision failed canonical validation.",
                "SHARED_TYPES.md §10.1",
            ));
        }
        Ok(decision)
    }
}
