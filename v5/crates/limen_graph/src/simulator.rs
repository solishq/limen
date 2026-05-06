//! Policy Simulation Engine
//!
//! Answers "what-if" questions about governance policies by running
//! scenario steps against a configurable policy and tracking state
//! transitions, effective confidence decay, and self-healing events.

use serde::{Deserialize, Serialize};

// --- Simulation Types ---

/// Projection validity state for simulation (distinct from graph's NodeLifecycleState).
/// Models the v5 verification lifecycle for projections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectionValidityState {
    Verified,
    Lagging,
    Unverified,
    Divergent,
    Rebuilding,
}

/// Action to take when tampering is detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TamperAction {
    Block,
    Warn,
    Rebuild,
}

/// Actions that can occur in a simulation scenario step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SimAction {
    Claim,
    Query,
    Tamper,
    Conflict,
    StateChange,
    Cascade,
}

/// Outcome of executing a single simulation step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum StepOutcome {
    Allowed,
    Refused { reason: String },
    Healed,
    StateChanged {
        from: ProjectionValidityState,
        to: ProjectionValidityState,
    },
}

/// Policy configuration governing simulation behavior.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyConfig {
    pub governed: bool,
    pub max_cascade_depth: u32,
    pub auto_retract_threshold: f64,
    pub tamper_action: TamperAction,
    /// Number of steps in Rebuilding before auto-transitioning to Verified (F-007).
    #[serde(default = "default_rebuild_steps")]
    pub rebuild_steps: u32,
}

fn default_rebuild_steps() -> u32 {
    3
}

/// A single step in a simulation scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioStep {
    pub action: SimAction,
    pub data: serde_json::Value,
}

/// Request to run a policy simulation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationRequest {
    pub policy: PolicyConfig,
    pub scenario: Vec<ScenarioStep>,
    pub initial_state: ProjectionValidityState,
}

/// Result of executing a single simulation step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_index: usize,
    pub action: SimAction,
    pub outcome: StepOutcome,
    pub governance_state_after: ProjectionValidityState,
    pub effective_confidence: f64,
}

/// Full result of a simulation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub steps: Vec<StepResult>,
    pub final_state: ProjectionValidityState,
    pub total_refusals: u32,
    pub governance_transitions: Vec<(ProjectionValidityState, ProjectionValidityState)>,
    pub effective_confidence_trajectory: Vec<f64>,
    pub self_healing_events: u32,
}

// --- Simulation Engine ---

/// Compute effective confidence with temporal decay.
/// EC(t) = confidence * (1 + step_index / (9 * 90))^(-1)
fn compute_effective_confidence(base_confidence: f64, step_index: usize) -> f64 {
    let decay_factor = 1.0 + (step_index as f64) / (9.0 * 90.0);
    base_confidence / decay_factor
}

/// Determine whether a read action is allowed given the current state and policy.
fn evaluate_read(state: ProjectionValidityState, governed: bool) -> StepOutcome {
    match state {
        ProjectionValidityState::Verified => StepOutcome::Allowed,
        ProjectionValidityState::Lagging => {
            if governed {
                StepOutcome::Refused {
                    reason: "reads refused in lagging state with governed=true (retryable)".into(),
                }
            } else {
                StepOutcome::Allowed
            }
        }
        ProjectionValidityState::Unverified | ProjectionValidityState::Divergent => StepOutcome::Refused {
            reason: format!(
                "reads refused in {:?} state (not retryable)",
                state
            ),
        },
        ProjectionValidityState::Rebuilding => StepOutcome::Refused {
            reason: "reads refused during rebuilding (retryable)".into(),
        },
    }
}

/// Execute a single step against the current simulation state.
fn execute_step(
    step_index: usize,
    step: &ScenarioStep,
    current_state: &mut ProjectionValidityState,
    policy: &PolicyConfig,
    base_confidence: f64,
    self_healing_events: &mut u32,
    cascade_depth: &mut u32,
    rebuilding_step_count: &mut u32,
) -> StepResult {
    let ec = compute_effective_confidence(base_confidence, step_index);

    // F-007: auto-transition from Rebuilding after N steps
    if *current_state == ProjectionValidityState::Rebuilding {
        *rebuilding_step_count += 1;
        if *rebuilding_step_count >= policy.rebuild_steps {
            let from = *current_state;
            *current_state = ProjectionValidityState::Verified;
            *rebuilding_step_count = 0;
            return StepResult {
                step_index,
                action: step.action,
                outcome: StepOutcome::StateChanged { from, to: ProjectionValidityState::Verified },
                governance_state_after: *current_state,
                effective_confidence: ec,
            };
        }
    } else {
        *rebuilding_step_count = 0;
    }

    let outcome = match step.action {
        // Writes always allowed regardless of state
        SimAction::Claim => StepOutcome::Allowed,

        // Reads governed by state + policy
        SimAction::Query => evaluate_read(*current_state, policy.governed),

        // Tamper triggers configured response
        SimAction::Tamper => match policy.tamper_action {
            TamperAction::Block => StepOutcome::Refused {
                reason: "tamper detected: blocked by policy".into(),
            },
            TamperAction::Warn => StepOutcome::Allowed,
            TamperAction::Rebuild => {
                let from = *current_state;
                *current_state = ProjectionValidityState::Rebuilding;
                *rebuilding_step_count = 0;
                StepOutcome::StateChanged {
                    from,
                    to: ProjectionValidityState::Rebuilding,
                }
            }
        },

        // Conflict triggers state degradation
        SimAction::Conflict => {
            let from = *current_state;
            *current_state = ProjectionValidityState::Divergent;
            StepOutcome::StateChanged {
                from,
                to: ProjectionValidityState::Divergent,
            }
        }

        // F-005: Cascade action with depth tracking
        SimAction::Cascade => {
            let depth = step.data.get("depth")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32;
            *cascade_depth += depth;
            if *cascade_depth > policy.max_cascade_depth {
                StepOutcome::Refused {
                    reason: "max cascade depth exceeded".into(),
                }
            } else {
                StepOutcome::Allowed
            }
        }

        // Explicit state change from scenario data (F-011: reject invalid target_state)
        SimAction::StateChange => {
            let target_value = step.data.get("target_state").cloned().unwrap_or(serde_json::Value::Null);
            match serde_json::from_value::<ProjectionValidityState>(target_value) {
                Ok(target) => {
                    let from = *current_state;
                    *current_state = target;
                    if target == ProjectionValidityState::Rebuilding {
                        *rebuilding_step_count = 0;
                    }
                    StepOutcome::StateChanged { from, to: target }
                }
                Err(_) => {
                    StepOutcome::Refused {
                        reason: "invalid target_state".into(),
                    }
                }
            }
        }
    };

    // F-006: Compute primary outcome first, count refusal, then check self-healing separately.
    // Self-healing fires independently but does NOT override a Refused outcome.
    let is_refused = matches!(outcome, StepOutcome::Refused { .. });

    // Self-healing check: if EC drops below auto_retract_threshold and state
    // is degraded, transition to Rebuilding (self-heal initiation)
    if ec < policy.auto_retract_threshold
        && matches!(
            *current_state,
            ProjectionValidityState::Unverified | ProjectionValidityState::Divergent | ProjectionValidityState::Lagging
        )
    {
        *self_healing_events += 1;
        *current_state = ProjectionValidityState::Rebuilding;
        *rebuilding_step_count = 0;

        // F-006: If the primary outcome was Refused, keep it as Refused
        // (self-healing is a side-effect, not an outcome override)
        if is_refused {
            return StepResult {
                step_index,
                action: step.action,
                outcome,
                governance_state_after: *current_state,
                effective_confidence: ec,
            };
        }

        return StepResult {
            step_index,
            action: step.action,
            outcome: StepOutcome::Healed,
            governance_state_after: *current_state,
            effective_confidence: ec,
        };
    }

    StepResult {
        step_index,
        action: step.action,
        outcome,
        governance_state_after: *current_state,
        effective_confidence: ec,
    }
}

/// Run a full policy simulation.
pub fn run_simulation(req: SimulationRequest) -> SimulationResult {
    let mut current_state = req.initial_state;
    let mut steps: Vec<StepResult> = Vec::with_capacity(req.scenario.len());
    let mut total_refusals: u32 = 0;
    let mut governance_transitions: Vec<(ProjectionValidityState, ProjectionValidityState)> = Vec::new();
    let mut effective_confidence_trajectory: Vec<f64> = Vec::new();
    let mut self_healing_events: u32 = 0;
    let mut cascade_depth: u32 = 0;
    let mut rebuilding_step_count: u32 = 0;

    // Base confidence starts at 1.0 (maximum)
    let base_confidence = 1.0;

    for (i, scenario_step) in req.scenario.iter().enumerate() {
        let state_before = current_state;

        let result = execute_step(
            i,
            scenario_step,
            &mut current_state,
            &req.policy,
            base_confidence,
            &mut self_healing_events,
            &mut cascade_depth,
            &mut rebuilding_step_count,
        );

        if matches!(result.outcome, StepOutcome::Refused { .. }) {
            total_refusals += 1;
        }

        if state_before != current_state {
            governance_transitions.push((state_before, current_state));
        }

        effective_confidence_trajectory.push(result.effective_confidence);
        steps.push(result);
    }

    SimulationResult {
        steps,
        final_state: current_state,
        total_refusals,
        governance_transitions,
        effective_confidence_trajectory,
        self_healing_events,
    }
}

/// Run multiple simulations for side-by-side comparison.
pub fn run_comparison(requests: Vec<SimulationRequest>) -> Vec<SimulationResult> {
    requests.into_iter().map(run_simulation).collect()
}
