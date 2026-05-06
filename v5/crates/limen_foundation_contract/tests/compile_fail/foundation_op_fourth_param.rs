/// Compile-fail test: a foundation operation accepting a fourth parameter does not type-check.
/// The FoundationOperation trait signature admits exactly three input classes.
/// This file MUST fail to compile.
use limen_foundation_contract::operation::FoundationOperation;
use limen_foundation_contract::capabilities::FoundationReadCapability;
use limen_foundation_contract::envelope::SubstrateRuntimeEnvelope;
use limen_foundation_contract::proposed::ProposedTransitionEnvelope;
use limen_types::OperationType;

struct BadOperation;

impl FoundationOperation for BadOperation {
    type Verdict = bool;
    const TYPE: OperationType = OperationType::Refusal;

    // Fourth parameter — this must not compile against the trait.
    fn evaluate<'ctx, 'tx>(
        _chain_read: &FoundationReadCapability<'ctx>,
        _runtime: &SubstrateRuntimeEnvelope<'tx>,
        _proposed: &ProposedTransitionEnvelope,
        _extra: &str,  // FORBIDDEN fourth parameter
    ) -> Self::Verdict {
        true
    }
}

fn main() {}
