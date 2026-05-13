//! Fail-closed audit hash chain.
//! Contract refs: SHARED_TYPES.md §10.3; AUDIT_VISUALIZATION_SCHEMA.md §§1-2.1; SHARED_TYPES.md §20.

use crate::types::{AdapterErrorCode, AdapterId, AdapterKernelError, AdapterResult, AuditLogEntry};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct AuditLogger {
    adapter_id: AdapterId,
    previous_hash: String,
    entries: Vec<AuditLogEntry>,
}

impl AuditLogger {
    pub fn new(adapter_id: AdapterId) -> Self {
        Self {
            adapter_id,
            previous_hash: "GENESIS".to_owned(),
            entries: Vec::new(),
        }
    }

    pub fn append(&mut self, mut entry: AuditLogEntry) -> AdapterResult<AuditLogEntry> {
        entry.previous_hash = self.previous_hash.clone();
        entry.current_hash = hash_without_current_hash(&entry)?;
        self.previous_hash = entry.current_hash.clone();
        self.entries.push(entry.clone());
        Ok(entry)
    }

    pub fn verify_chain(&self) -> AdapterResult<()> {
        let mut previous = "GENESIS".to_owned();
        for entry in &self.entries {
            if entry.previous_hash != previous {
                return Err(AdapterKernelError::new(
                    self.adapter_id.clone(),
                    AdapterErrorCode::AuditAppendFailed,
                    "Audit previousHash mismatch.",
                    "SHARED_TYPES.md §10.3",
                ));
            }
            let expected = hash_without_current_hash(entry)?;
            if entry.current_hash != expected {
                return Err(AdapterKernelError::new(
                    self.adapter_id.clone(),
                    AdapterErrorCode::AuditAppendFailed,
                    "Audit currentHash mismatch.",
                    "SHARED_TYPES.md §10.3",
                ));
            }
            previous = entry.current_hash.clone();
        }
        Ok(())
    }

    pub fn entries(&self) -> &[AuditLogEntry] {
        &self.entries
    }
}

fn hash_without_current_hash(entry: &AuditLogEntry) -> AdapterResult<String> {
    #[derive(Serialize)]
    struct HashableEntry<'a> {
        id: &'a crate::types::EventId,
        timestamp: &'a str,
        tenant_id: &'a Option<crate::types::TenantId>,
        agent_id: &'a crate::types::AgentId,
        session_id: &'a crate::types::SessionId,
        event: crate::types::AgentEvent,
        action: &'a Option<crate::types::GovernanceAction>,
        governance_decision: &'a Option<crate::types::GovernanceDecision>,
        details: &'a Value,
        previous_hash: &'a str,
        classification: crate::types::ClassificationLevel,
    }
    let hashable = HashableEntry {
        id: &entry.id,
        timestamp: &entry.timestamp,
        tenant_id: &entry.tenant_id,
        agent_id: &entry.agent_id,
        session_id: &entry.session_id,
        event: entry.event,
        action: &entry.action,
        governance_decision: &entry.governance_decision,
        details: &entry.details,
        previous_hash: &entry.previous_hash,
        classification: entry.classification,
    };
    let bytes = serde_json::to_vec(&hashable).map_err(|source| {
        AdapterKernelError::new(
            AdapterId("audit".to_owned()),
            AdapterErrorCode::SerdeError,
            source.to_string(),
            "SHARED_TYPES.md §10.3",
        )
    })?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}
