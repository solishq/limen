// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use limen_graph::simulator::{
    PolicyConfig, ScenarioStep, SimAction, ProjectionValidityState, SimulationRequest,
    StepOutcome, TamperAction, run_simulation, run_comparison,
};
use serde_json::json;

fn default_policy(governed: bool, tamper_action: TamperAction) -> PolicyConfig {
    PolicyConfig {
        governed,
        max_cascade_depth: 5,
        auto_retract_threshold: 0.3,
        tamper_action,
        rebuild_steps: 3,
    }
}

#[test]
fn test_sim_verified_all_allowed() {
    let req = SimulationRequest {
        policy: default_policy(true, TamperAction::Block),
        scenario: (0..10)
            .map(|_| ScenarioStep {
                action: SimAction::Claim,
                data: json!({}),
            })
            .collect(),
        initial_state: ProjectionValidityState::Verified,
    };

    let result = run_simulation(req);

    assert_eq!(result.steps.len(), 10);
    assert_eq!(result.total_refusals, 0);
    assert_eq!(result.final_state, ProjectionValidityState::Verified);
    for step in &result.steps {
        assert_eq!(step.outcome, StepOutcome::Allowed);
    }
}

#[test]
fn test_sim_governed_lagging_refuses_reads() {
    let req = SimulationRequest {
        policy: default_policy(true, TamperAction::Block),
        scenario: vec![
            ScenarioStep { action: SimAction::Query, data: json!({}) },
            ScenarioStep { action: SimAction::Claim, data: json!({}) },
            ScenarioStep { action: SimAction::Query, data: json!({}) },
        ],
        initial_state: ProjectionValidityState::Lagging,
    };

    let result = run_simulation(req);

    // Queries refused, claims allowed
    assert!(matches!(result.steps[0].outcome, StepOutcome::Refused { .. }));
    assert_eq!(result.steps[1].outcome, StepOutcome::Allowed);
    assert!(matches!(result.steps[2].outcome, StepOutcome::Refused { .. }));
    assert_eq!(result.total_refusals, 2);
}

#[test]
fn test_sim_tamper_triggers_rebuild() {
    let req = SimulationRequest {
        policy: default_policy(true, TamperAction::Rebuild),
        scenario: vec![
            ScenarioStep { action: SimAction::Tamper, data: json!({}) },
        ],
        initial_state: ProjectionValidityState::Verified,
    };

    let result = run_simulation(req);

    assert_eq!(result.final_state, ProjectionValidityState::Rebuilding);
    assert_eq!(result.governance_transitions.len(), 1);
    assert_eq!(
        result.governance_transitions[0],
        (ProjectionValidityState::Verified, ProjectionValidityState::Rebuilding)
    );
    assert!(matches!(
        result.steps[0].outcome,
        StepOutcome::StateChanged {
            from: ProjectionValidityState::Verified,
            to: ProjectionValidityState::Rebuilding,
        }
    ));
}

#[test]
fn test_sim_self_healing() {
    // Use a high auto_retract_threshold so EC drops below it quickly
    let policy = PolicyConfig {
        governed: true,
        max_cascade_depth: 5,
        auto_retract_threshold: 0.95,
        tamper_action: TamperAction::Block,
        rebuild_steps: 3,
    };

    // Start in Lagging state; after enough steps EC will drop below 0.95
    // EC at step 0 = 1.0/(1 + 0/810) = 1.0 (not below 0.95)
    // EC at step 50 = 1.0/(1 + 50/810) ~ 0.942 (below 0.95)
    // Use claims (always allowed) to advance steps until self-heal fires
    let scenario: Vec<ScenarioStep> = (0..100)
        .map(|_| ScenarioStep {
            action: SimAction::Claim,
            data: json!({}),
        })
        .collect();

    let req = SimulationRequest {
        policy,
        scenario,
        initial_state: ProjectionValidityState::Lagging,
    };

    let result = run_simulation(req);

    assert!(result.self_healing_events > 0);
    // After self-healing, state transitions to Rebuilding
    assert!(result.governance_transitions.iter().any(|(_, to)| *to == ProjectionValidityState::Rebuilding));
    // At least one step has Healed outcome
    assert!(result.steps.iter().any(|s| s.outcome == StepOutcome::Healed));
}

#[test]
fn test_sim_compare_two_policies() {
    let scenario: Vec<ScenarioStep> = vec![
        ScenarioStep { action: SimAction::Query, data: json!({}) },
        ScenarioStep { action: SimAction::Query, data: json!({}) },
        ScenarioStep { action: SimAction::Claim, data: json!({}) },
        ScenarioStep { action: SimAction::Query, data: json!({}) },
    ];

    let governed_req = SimulationRequest {
        policy: default_policy(true, TamperAction::Block),
        scenario: scenario.clone(),
        initial_state: ProjectionValidityState::Lagging,
    };

    let ungoverned_req = SimulationRequest {
        policy: default_policy(false, TamperAction::Block),
        scenario,
        initial_state: ProjectionValidityState::Lagging,
    };

    let results = run_comparison(vec![governed_req, ungoverned_req]);

    assert_eq!(results.len(), 2);
    // Governed refuses reads in Lagging, ungoverned allows them
    assert!(results[0].total_refusals > 0);
    assert_eq!(results[1].total_refusals, 0);
    // Governed has more refusals than ungoverned
    assert!(results[0].total_refusals > results[1].total_refusals);
}

// F-005: max_cascade_depth enforcement
#[test]
fn test_sim_cascade_depth_exceeded() {
    let policy = PolicyConfig {
        governed: true,
        max_cascade_depth: 3,
        auto_retract_threshold: 0.3,
        tamper_action: TamperAction::Block,
        rebuild_steps: 3,
    };

    let scenario: Vec<ScenarioStep> = vec![
        ScenarioStep { action: SimAction::Cascade, data: json!({"depth": 2}) },
        ScenarioStep { action: SimAction::Cascade, data: json!({"depth": 2}) },
    ];

    let req = SimulationRequest {
        policy,
        scenario,
        initial_state: ProjectionValidityState::Verified,
    };

    let result = run_simulation(req);

    // First cascade: depth 2 <= max 3 -> Allowed
    assert_eq!(result.steps[0].outcome, StepOutcome::Allowed);
    // Second cascade: depth 4 > max 3 -> Refused
    assert!(matches!(result.steps[1].outcome, StepOutcome::Refused { ref reason } if reason == "max cascade depth exceeded"));
    assert_eq!(result.total_refusals, 1);
}

// F-007: Rebuilding state auto-transitions to Verified after rebuild_steps
#[test]
fn test_sim_rebuilding_auto_transitions() {
    let policy = PolicyConfig {
        governed: true,
        max_cascade_depth: 5,
        auto_retract_threshold: 0.1,
        tamper_action: TamperAction::Block,
        rebuild_steps: 3,
    };

    // Start in Rebuilding, do 5 claims — should auto-transition to Verified after 3 steps
    let scenario: Vec<ScenarioStep> = (0..5)
        .map(|_| ScenarioStep { action: SimAction::Claim, data: json!({}) })
        .collect();

    let req = SimulationRequest {
        policy,
        scenario,
        initial_state: ProjectionValidityState::Rebuilding,
    };

    let result = run_simulation(req);

    // After rebuild_steps (3), the 4th step triggers transition to Verified
    assert_eq!(result.final_state, ProjectionValidityState::Verified);
    assert!(result.governance_transitions.iter().any(|(from, to)| {
        *from == ProjectionValidityState::Rebuilding && *to == ProjectionValidityState::Verified
    }));
}

// F-011: StateChange with invalid target_state returns Refused
#[test]
fn test_sim_state_change_invalid_target() {
    let req = SimulationRequest {
        policy: default_policy(true, TamperAction::Block),
        scenario: vec![
            ScenarioStep { action: SimAction::StateChange, data: json!({}) }, // missing target_state
            ScenarioStep { action: SimAction::StateChange, data: json!({"target_state": "bogus"}) }, // invalid
        ],
        initial_state: ProjectionValidityState::Verified,
    };

    let result = run_simulation(req);

    assert!(matches!(result.steps[0].outcome, StepOutcome::Refused { ref reason } if reason == "invalid target_state"));
    assert!(matches!(result.steps[1].outcome, StepOutcome::Refused { ref reason } if reason == "invalid target_state"));
    // State unchanged because both were refused
    assert_eq!(result.final_state, ProjectionValidityState::Verified);
    assert_eq!(result.total_refusals, 2);
}

// F-012: Non-discriminative self-healing test (rejection path)
// With very low threshold (0.01), EC never drops below it in reasonable steps,
// so self_healing_events should be 0.
#[test]
fn test_sim_self_healing_rejection_low_threshold() {
    let policy = PolicyConfig {
        governed: true,
        max_cascade_depth: 5,
        auto_retract_threshold: 0.01,
        tamper_action: TamperAction::Block,
        rebuild_steps: 3,
    };

    // Same scenario as test_sim_self_healing but with threshold=0.01
    // EC at step 99 = 1.0/(1 + 99/810) ~ 0.891 — still far above 0.01
    let scenario: Vec<ScenarioStep> = (0..100)
        .map(|_| ScenarioStep {
            action: SimAction::Claim,
            data: json!({}),
        })
        .collect();

    let req = SimulationRequest {
        policy,
        scenario,
        initial_state: ProjectionValidityState::Lagging,
    };

    let result = run_simulation(req);

    assert_eq!(result.self_healing_events, 0);
    // State should remain Lagging (no self-healing transition)
    assert_eq!(result.final_state, ProjectionValidityState::Lagging);
}

// F-006: Self-healing does not mask refusals
#[test]
fn test_sim_self_healing_does_not_mask_refusal() {
    let policy = PolicyConfig {
        governed: true,
        max_cascade_depth: 5,
        // Very high threshold so self-healing fires at step 0
        // But wait - EC at step 0 is 1.0, which is NOT below 0.95
        // EC at step ~43 drops below 0.95
        auto_retract_threshold: 0.95,
        tamper_action: TamperAction::Block,
        rebuild_steps: 100, // Keep in rebuilding a long time
    };

    // Start in Lagging: Query will be refused (governed=true, state=Lagging).
    // After enough steps, EC drops below 0.95 and self-healing fires.
    // At that point, a Query should still show as Refused (not Healed).
    let mut scenario: Vec<ScenarioStep> = (0..42)
        .map(|_| ScenarioStep { action: SimAction::Claim, data: json!({}) })
        .collect();
    // Step 42: Query in Lagging state, EC ~ 0.951 (above threshold still)
    // Step 43: EC ~ 0.949 (below). Let's add a Query at step 43.
    scenario.push(ScenarioStep { action: SimAction::Claim, data: json!({}) }); // step 42
    scenario.push(ScenarioStep { action: SimAction::Query, data: json!({}) }); // step 43

    let req = SimulationRequest {
        policy,
        scenario,
        initial_state: ProjectionValidityState::Lagging,
    };

    let result = run_simulation(req);

    // Find step 43 (index 43)
    let step_43 = &result.steps[43];
    // EC at step 43 = 1.0 / (1 + 43/810) = 1.0 / 1.0531 = 0.9496 (below 0.95)
    // State is Lagging, governed=true, so Query -> Refused
    // Self-healing also fires (EC < threshold, state is Lagging)
    // F-006: outcome should be Refused, NOT Healed
    assert!(matches!(step_43.outcome, StepOutcome::Refused { .. }));
    // Self-healing still counted
    assert!(result.self_healing_events > 0);
}
