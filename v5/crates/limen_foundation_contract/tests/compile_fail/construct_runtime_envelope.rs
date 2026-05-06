/// Compile-fail test: application code cannot construct SubstrateRuntimeEnvelope.
/// The `mint` function is `pub(crate)` — not accessible outside the crate.
/// This file MUST fail to compile.
fn main() {
    use std::marker::PhantomData;

    let _env = limen_foundation_contract::envelope::SubstrateRuntimeEnvelope {
        transaction: todo!(),
        operation: todo!(),
        _seal: PhantomData,
    };
}
