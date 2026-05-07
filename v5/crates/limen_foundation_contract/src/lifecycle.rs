//! Lifecycle state machine for substrate dispatch gating.
//!
//! Enforces valid state transitions and provides a thread-safe guard
//! that dispatch operations check before executing. The substrate must
//! be in `Ready` state before any commit transaction is processed.
//!
//! Valid transitions:
//!   Uninitialized → Initializing → Ready
//!   Ready ↔ Degraded
//!   Ready → Shutdown
//!   Degraded → Shutdown
//!
//! All other transitions are rejected with `LifecycleError::InvalidTransition`.

use std::sync::RwLock;

/// Substrate lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleState {
    /// Initial state before any initialization has begun.
    Uninitialized,
    /// Initialization is in progress (schema migration, etc.).
    Initializing,
    /// Fully operational — dispatch is permitted.
    Ready,
    /// Operational but with reduced capability (e.g., read-only chain).
    Degraded,
    /// Substrate is shutting down — no new operations accepted.
    Shutdown,
}

/// Lifecycle transition errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleError {
    /// The requested state transition is not permitted.
    InvalidTransition {
        /// Current state at the time of the transition attempt.
        from: LifecycleState,
        /// Requested target state.
        to: LifecycleState,
    },
    /// An operation requires `Ready` state but the substrate is not ready.
    NotReady {
        /// Current state that prevented the operation.
        current: LifecycleState,
    },
    /// The internal lock was poisoned by a panicking thread.
    LockPoisoned,
}

impl std::fmt::Display for LifecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition { from, to } => {
                write!(f, "invalid lifecycle transition: {:?} → {:?}", from, to)
            }
            Self::NotReady { current } => {
                write!(f, "substrate not ready: current state is {:?}", current)
            }
            Self::LockPoisoned => write!(f, "lifecycle lock poisoned"),
        }
    }
}

/// Thread-safe lifecycle guard.
///
/// Wraps a `LifecycleState` behind a `RwLock` and enforces the state
/// machine transition rules. All state reads and transitions are
/// serialized through the lock.
pub struct LifecycleGuard {
    state: RwLock<LifecycleState>,
}

impl LifecycleGuard {
    /// Create a new guard in `Uninitialized` state.
    pub fn new() -> Self {
        Self {
            state: RwLock::new(LifecycleState::Uninitialized),
        }
    }

    /// Read the current lifecycle state.
    pub fn current(&self) -> Result<LifecycleState, LifecycleError> {
        self.state
            .read()
            .map(|s| *s)
            .map_err(|_| LifecycleError::LockPoisoned)
    }

    /// Attempt a state transition. Returns `Ok(())` if the transition
    /// is valid, or `Err(LifecycleError::InvalidTransition)` if not.
    pub fn transition(&self, to: LifecycleState) -> Result<(), LifecycleError> {
        let mut guard = self
            .state
            .write()
            .map_err(|_| LifecycleError::LockPoisoned)?;

        let from = *guard;
        if !is_valid_transition(from, to) {
            return Err(LifecycleError::InvalidTransition { from, to });
        }
        *guard = to;
        Ok(())
    }

    /// Assert that the substrate is in `Ready` state. Called at the top
    /// of `run_commit_transaction` to gate dispatch.
    pub fn require_ready(&self) -> Result<(), LifecycleError> {
        let current = self.current()?;
        if current == LifecycleState::Ready {
            Ok(())
        } else {
            Err(LifecycleError::NotReady { current })
        }
    }
}

impl Default for LifecycleGuard {
    fn default() -> Self {
        Self::new()
    }
}

/// Transition validity table.
fn is_valid_transition(from: LifecycleState, to: LifecycleState) -> bool {
    matches!(
        (from, to),
        (LifecycleState::Uninitialized, LifecycleState::Initializing)
            | (LifecycleState::Initializing, LifecycleState::Ready)
            | (LifecycleState::Ready, LifecycleState::Degraded)
            | (LifecycleState::Degraded, LifecycleState::Ready)
            | (LifecycleState::Ready, LifecycleState::Shutdown)
            | (LifecycleState::Degraded, LifecycleState::Shutdown)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_is_uninitialized() {
        let guard = LifecycleGuard::new();
        assert_eq!(guard.current().unwrap(), LifecycleState::Uninitialized);
    }

    #[test]
    fn test_valid_startup_sequence() {
        let guard = LifecycleGuard::new();
        guard
            .transition(LifecycleState::Initializing)
            .expect("Uninitialized → Initializing");
        guard
            .transition(LifecycleState::Ready)
            .expect("Initializing → Ready");
        assert_eq!(guard.current().unwrap(), LifecycleState::Ready);
    }

    #[test]
    fn test_ready_to_degraded_and_back() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();

        guard
            .transition(LifecycleState::Degraded)
            .expect("Ready → Degraded");
        guard
            .transition(LifecycleState::Ready)
            .expect("Degraded → Ready");
        assert_eq!(guard.current().unwrap(), LifecycleState::Ready);
    }

    #[test]
    fn test_ready_to_shutdown() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();

        guard
            .transition(LifecycleState::Shutdown)
            .expect("Ready → Shutdown");
        assert_eq!(guard.current().unwrap(), LifecycleState::Shutdown);
    }

    #[test]
    fn test_degraded_to_shutdown() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();
        guard.transition(LifecycleState::Degraded).unwrap();

        guard
            .transition(LifecycleState::Shutdown)
            .expect("Degraded → Shutdown");
        assert_eq!(guard.current().unwrap(), LifecycleState::Shutdown);
    }

    #[test]
    fn test_invalid_transition_uninitialized_to_ready() {
        let guard = LifecycleGuard::new();
        let err = guard
            .transition(LifecycleState::Ready)
            .unwrap_err();
        assert_eq!(
            err,
            LifecycleError::InvalidTransition {
                from: LifecycleState::Uninitialized,
                to: LifecycleState::Ready,
            }
        );
    }

    #[test]
    fn test_invalid_transition_shutdown_to_ready() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();
        guard.transition(LifecycleState::Shutdown).unwrap();

        let err = guard
            .transition(LifecycleState::Ready)
            .unwrap_err();
        assert_eq!(
            err,
            LifecycleError::InvalidTransition {
                from: LifecycleState::Shutdown,
                to: LifecycleState::Ready,
            }
        );
    }

    #[test]
    fn test_invalid_transition_initializing_to_shutdown() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();

        let err = guard
            .transition(LifecycleState::Shutdown)
            .unwrap_err();
        assert_eq!(
            err,
            LifecycleError::InvalidTransition {
                from: LifecycleState::Initializing,
                to: LifecycleState::Shutdown,
            }
        );
    }

    #[test]
    fn test_require_ready_when_ready() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();

        guard.require_ready().expect("should be ready");
    }

    #[test]
    fn test_require_ready_when_not_ready() {
        let guard = LifecycleGuard::new();
        let err = guard.require_ready().unwrap_err();
        assert_eq!(
            err,
            LifecycleError::NotReady {
                current: LifecycleState::Uninitialized,
            }
        );
    }

    #[test]
    fn test_require_ready_when_degraded() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();
        guard.transition(LifecycleState::Degraded).unwrap();

        let err = guard.require_ready().unwrap_err();
        assert_eq!(
            err,
            LifecycleError::NotReady {
                current: LifecycleState::Degraded,
            }
        );
    }

    #[test]
    fn test_require_ready_when_shutdown() {
        let guard = LifecycleGuard::new();
        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();
        guard.transition(LifecycleState::Shutdown).unwrap();

        let err = guard.require_ready().unwrap_err();
        assert_eq!(
            err,
            LifecycleError::NotReady {
                current: LifecycleState::Shutdown,
            }
        );
    }

    #[test]
    fn test_thread_safety() {
        use std::sync::Arc;
        let guard = Arc::new(LifecycleGuard::new());

        guard.transition(LifecycleState::Initializing).unwrap();
        guard.transition(LifecycleState::Ready).unwrap();

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let g = Arc::clone(&guard);
                std::thread::spawn(move || {
                    for _ in 0..100 {
                        g.require_ready().unwrap();
                        let _ = g.current().unwrap();
                    }
                })
            })
            .collect();

        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn test_self_transition_is_invalid() {
        let guard = LifecycleGuard::new();
        let err = guard
            .transition(LifecycleState::Uninitialized)
            .unwrap_err();
        assert!(matches!(err, LifecycleError::InvalidTransition { .. }));
    }

    #[test]
    fn test_display_formatting() {
        let err = LifecycleError::InvalidTransition {
            from: LifecycleState::Uninitialized,
            to: LifecycleState::Ready,
        };
        assert!(err.to_string().contains("invalid lifecycle transition"));

        let err = LifecycleError::NotReady {
            current: LifecycleState::Degraded,
        };
        assert!(err.to_string().contains("not ready"));
    }
}
