// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// A single version of a belief.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefVersion {
    pub version_id: String,
    pub belief_id: String,
    pub content: serde_json::Value,
    pub confidence: f64,
    pub governance_state: String,
    pub created_at: String,
    pub parent_version: Option<String>,
    pub branch_name: Option<String>,
}

/// A named branch of belief versions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeliefBranch {
    pub branch_id: String,
    pub name: String,
    pub base_version: String,
    pub versions: Vec<BeliefVersion>,
    pub created_at: String,
}

/// Request to create a branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchRequest {
    pub belief_id: String,
    pub branch_name: String,
}

/// Request to merge two branches.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeRequest {
    pub source_branch: String,
    pub target_branch: String,
    pub conflict_resolution: ConflictResolution,
}

/// Strategy for resolving merge conflicts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    TakeSource,
    TakeTarget,
    TakeHigherConfidence,
}

/// Result of a merge operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub merged_version: BeliefVersion,
    pub conflicts_resolved: u32,
    pub resolution_strategy: String,
}

/// In-memory belief versioning store.
#[derive(Debug, Default)]
pub struct BeliefVersionStore {
    /// belief_id -> ordered list of versions (oldest first)
    versions: BTreeMap<String, Vec<BeliefVersion>>,
    /// branch_id -> branch metadata
    branches: BTreeMap<String, BeliefBranch>,
    /// Counter for generating unique IDs
    next_id: u64,
}

impl BeliefVersionStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a version for a belief (used during seeding and normal operation).
    pub fn add_version(&mut self, version: BeliefVersion) {
        self.versions
            .entry(version.belief_id.clone())
            .or_default()
            .push(version);
    }

    /// Add a branch (used during seeding).
    pub fn add_branch(&mut self, branch: BeliefBranch) {
        self.branches.insert(branch.branch_id.clone(), branch);
    }

    /// Get all versions for a belief.
    pub fn get_versions(&self, belief_id: &str) -> Option<&Vec<BeliefVersion>> {
        self.versions.get(belief_id)
    }

    /// Create a new branch from the latest version of a belief.
    pub fn create_branch(&mut self, request: &BranchRequest) -> Result<BeliefBranch, String> {
        let versions = self
            .versions
            .get(&request.belief_id)
            .ok_or_else(|| format!("belief not found: {}", request.belief_id))?;

        let latest = versions
            .last()
            .ok_or_else(|| format!("no versions for belief: {}", request.belief_id))?;

        self.next_id += 1;
        let branch_id = format!("branch-{:06}", self.next_id);

        // Create a new version on the branch
        self.next_id += 1;
        let branch_version = BeliefVersion {
            version_id: format!("ver-{:06}", self.next_id),
            belief_id: request.belief_id.clone(),
            content: latest.content.clone(),
            confidence: latest.confidence,
            governance_state: latest.governance_state.clone(),
            created_at: latest.created_at.clone(),
            parent_version: Some(latest.version_id.clone()),
            branch_name: Some(request.branch_name.clone()),
        };

        let branch = BeliefBranch {
            branch_id: branch_id.clone(),
            name: request.branch_name.clone(),
            base_version: latest.version_id.clone(),
            versions: vec![branch_version.clone()],
            created_at: latest.created_at.clone(),
        };

        self.versions
            .entry(request.belief_id.clone())
            .or_default()
            .push(branch_version);

        self.branches.insert(branch_id, branch.clone());
        Ok(branch)
    }

    /// Merge two branches using the specified conflict resolution strategy.
    pub fn merge_branches(&mut self, request: &MergeRequest) -> Result<MergeResult, String> {
        let source = self
            .branches
            .get(&request.source_branch)
            .ok_or_else(|| format!("source branch not found: {}", request.source_branch))?
            .clone();

        let target = self
            .branches
            .get(&request.target_branch)
            .ok_or_else(|| format!("target branch not found: {}", request.target_branch))?
            .clone();

        let source_latest = source
            .versions
            .last()
            .ok_or("source branch has no versions")?;
        let target_latest = target
            .versions
            .last()
            .ok_or("target branch has no versions")?;

        // Resolve conflict
        let (resolved, conflicts) =
            if source_latest.content == target_latest.content {
                (source_latest.clone(), 0u32)
            } else {
                let winner = match request.conflict_resolution {
                    ConflictResolution::TakeSource => source_latest,
                    ConflictResolution::TakeTarget => target_latest,
                    ConflictResolution::TakeHigherConfidence => {
                        if source_latest.confidence >= target_latest.confidence {
                            source_latest
                        } else {
                            target_latest
                        }
                    }
                };
                (winner.clone(), 1)
            };

        self.next_id += 1;
        let merged_version = BeliefVersion {
            version_id: format!("ver-{:06}", self.next_id),
            belief_id: resolved.belief_id.clone(),
            content: resolved.content,
            confidence: resolved.confidence,
            governance_state: resolved.governance_state,
            created_at: resolved.created_at,
            parent_version: Some(source_latest.version_id.clone()),
            branch_name: Some(target.name.clone()),
        };

        // Add merged version to target branch and global versions
        let target_branch = self
            .branches
            .get_mut(&request.target_branch)
            .ok_or("target branch disappeared")?;
        target_branch.versions.push(merged_version.clone());

        self.versions
            .entry(merged_version.belief_id.clone())
            .or_default()
            .push(merged_version.clone());

        let strategy_name = match request.conflict_resolution {
            ConflictResolution::TakeSource => "take_source",
            ConflictResolution::TakeTarget => "take_target",
            ConflictResolution::TakeHigherConfidence => "take_higher_confidence",
        };

        Ok(MergeResult {
            merged_version,
            conflicts_resolved: conflicts,
            resolution_strategy: strategy_name.to_string(),
        })
    }
}
