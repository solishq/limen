//! Strict adapter lifecycle state machine.
//! Contract refs: CREWAI_ADAPTER_CONTRACT.md Claims 1.1-1.3, 1.12; Phase 1 prompt action 5.

use crate::types::{AdapterErrorCode, AdapterId, AdapterKernelError, AdapterResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdapterLifecycleState {
    Uninitialized,
    Initializing,
    Ready,
    Degraded,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LifecycleSnapshot {
    pub state: AdapterLifecycleState,
    pub entered_at_ms: u64,
    pub last_error: Option<String>,
    pub transition_count: u64,
}

#[derive(Debug, Clone)]
pub struct AgentLifecycle {
    adapter_id: AdapterId,
    state: AdapterLifecycleState,
    entered_at_ms: u64,
    initializing_started_at_ms: Option<u64>,
    initialization_timeout_ms: u64,
    last_error: Option<String>,
    transition_count: u64,
}

impl AgentLifecycle {
    pub fn new(adapter_id: AdapterId, now_ms: u64, initialization_timeout_ms: u64) -> Self {
        Self {
            adapter_id,
            state: AdapterLifecycleState::Uninitialized,
            entered_at_ms: now_ms,
            initializing_started_at_ms: None,
            initialization_timeout_ms,
            last_error: None,
            transition_count: 0,
        }
    }

    pub fn snapshot(&self) -> LifecycleSnapshot {
        LifecycleSnapshot {
            state: self.state,
            entered_at_ms: self.entered_at_ms,
            last_error: self.last_error.clone(),
            transition_count: self.transition_count,
        }
    }

    pub fn begin_initializing(&mut self, now_ms: u64) -> AdapterResult<()> {
        self.transition_to(AdapterLifecycleState::Initializing, now_ms)?;
        self.initializing_started_at_ms = Some(now_ms);
        Ok(())
    }

    pub fn complete_initializing(&mut self, now_ms: u64) -> AdapterResult<()> {
        self.enforce_initializing_timeout(now_ms)?;
        self.transition_to(AdapterLifecycleState::Ready, now_ms)
    }

    pub fn mark_degraded(&mut self, reason: impl Into<String>, now_ms: u64) -> AdapterResult<()> {
        if self.state == AdapterLifecycleState::Shutdown {
            return Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::NotInitialized,
                "Lifecycle is shut down.",
                "CREWAI_ADAPTER_CONTRACT.md Claim 1.12",
            ));
        }
        self.last_error = Some(reason.into());
        if self.state == AdapterLifecycleState::Degraded {
            return Ok(());
        }
        self.transition_to(AdapterLifecycleState::Degraded, now_ms)
    }

    pub fn shutdown(&mut self, now_ms: u64) -> AdapterResult<()> {
        if self.state == AdapterLifecycleState::Shutdown {
            return Ok(());
        }
        self.initializing_started_at_ms = None;
        self.transition_to(AdapterLifecycleState::Shutdown, now_ms)
    }

    pub fn assert_ready_for_core_operation(&self, operation: &str) -> AdapterResult<()> {
        match self.state {
            AdapterLifecycleState::Ready => Ok(()),
            AdapterLifecycleState::Degraded => Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::CorePortUnavailable,
                format!("Core operation {operation} is fail-closed while DEGRADED."),
                "Phase 1 prompt action 6",
            )),
            _ => Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::NotInitialized,
                format!("Core operation {operation} requires READY lifecycle state."),
                "CREWAI_ADAPTER_CONTRACT.md Claim 1.1",
            )),
        }
    }

    pub fn transition_to(&mut self, next: AdapterLifecycleState, now_ms: u64) -> AdapterResult<()> {
        if !is_valid_transition(self.state, next) {
            return Err(AdapterKernelError::new(
                self.adapter_id.clone(),
                AdapterErrorCode::InvalidTransition,
                format!(
                    "Invalid lifecycle transition {:?} -> {:?}",
                    self.state, next
                ),
                "Phase 1 prompt action 5",
            ));
        }
        self.state = next;
        self.entered_at_ms = now_ms;
        self.transition_count += 1;
        if next != AdapterLifecycleState::Degraded {
            self.last_error = None;
        }
        Ok(())
    }

    pub fn enforce_initializing_timeout(&mut self, now_ms: u64) -> AdapterResult<()> {
        if self.state != AdapterLifecycleState::Initializing {
            return Ok(());
        }
        let Some(started_at) = self.initializing_started_at_ms else {
            return Ok(());
        };
        let elapsed = now_ms.saturating_sub(started_at);
        if elapsed <= self.initialization_timeout_ms {
            return Ok(());
        }
        self.mark_degraded(
            format!(
                "Initialization exceeded {}ms timeout.",
                self.initialization_timeout_ms
            ),
            now_ms,
        )?;
        Err(AdapterKernelError::new(
            self.adapter_id.clone(),
            AdapterErrorCode::CorePortUnavailable,
            "Initialization timeout transitioned lifecycle to DEGRADED.",
            "Phase 1 prompt action 5",
        ))
    }
}

pub const fn is_valid_transition(from: AdapterLifecycleState, to: AdapterLifecycleState) -> bool {
    match from {
        AdapterLifecycleState::Uninitialized => matches!(
            to,
            AdapterLifecycleState::Initializing | AdapterLifecycleState::Shutdown
        ),
        AdapterLifecycleState::Initializing => matches!(
            to,
            AdapterLifecycleState::Ready
                | AdapterLifecycleState::Degraded
                | AdapterLifecycleState::Shutdown
        ),
        AdapterLifecycleState::Ready => matches!(
            to,
            AdapterLifecycleState::Degraded | AdapterLifecycleState::Shutdown
        ),
        AdapterLifecycleState::Degraded => matches!(
            to,
            AdapterLifecycleState::Ready | AdapterLifecycleState::Shutdown
        ),
        AdapterLifecycleState::Shutdown => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn lifecycle() -> AgentLifecycle {
        AgentLifecycle::new(AdapterId("adapter".to_owned()), 0, 10)
    }

    proptest! {
        #[test]
        fn transition_matrix_matches_invariant(from in 0u8..5, to in 0u8..5) {
            let states = [
                AdapterLifecycleState::Uninitialized,
                AdapterLifecycleState::Initializing,
                AdapterLifecycleState::Ready,
                AdapterLifecycleState::Degraded,
                AdapterLifecycleState::Shutdown,
            ];
            let valid = is_valid_transition(states[from as usize], states[to as usize]);
            prop_assert_eq!(valid, match states[from as usize] {
                AdapterLifecycleState::Uninitialized => matches!(states[to as usize], AdapterLifecycleState::Initializing | AdapterLifecycleState::Shutdown),
                AdapterLifecycleState::Initializing => matches!(states[to as usize], AdapterLifecycleState::Ready | AdapterLifecycleState::Degraded | AdapterLifecycleState::Shutdown),
                AdapterLifecycleState::Ready => matches!(states[to as usize], AdapterLifecycleState::Degraded | AdapterLifecycleState::Shutdown),
                AdapterLifecycleState::Degraded => matches!(states[to as usize], AdapterLifecycleState::Ready | AdapterLifecycleState::Shutdown),
                AdapterLifecycleState::Shutdown => false,
            });
        }
    }

    #[test]
    fn initializing_timeout_enters_degraded() {
        let mut lifecycle = lifecycle();
        lifecycle.begin_initializing(0).expect("begin");
        let result = lifecycle.enforce_initializing_timeout(11);
        assert!(result.is_err());
        assert_eq!(lifecycle.snapshot().state, AdapterLifecycleState::Degraded);
    }
}
