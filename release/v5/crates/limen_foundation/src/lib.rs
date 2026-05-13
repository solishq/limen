#![forbid(unsafe_code)]
#![deny(warnings)]

//! Phase X foundation crate.
//! Contract refs: MASTER-INDEX-v2.2-FINAL.md §2.2; SHARED_TYPES.md §25; AGENT_ADAPTER_ARCHITECTURE.md §9.

pub mod adapter;
pub mod audit;
pub mod governance;
pub mod lifecycle;
pub mod types;

pub use adapter::*;
pub use audit::*;
pub use governance::*;
pub use lifecycle::*;
pub use types::*;
