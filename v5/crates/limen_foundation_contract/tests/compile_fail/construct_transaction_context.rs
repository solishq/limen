/// Compile-fail test: application code cannot construct TransactionRuntimeContext.
/// The `mint` function is `pub(crate)` — not accessible outside the crate.
/// This file MUST fail to compile.
fn main() {
    use std::marker::PhantomData;

    let _ctx = limen_foundation_contract::envelope::TransactionRuntimeContext {
        request_boundary: todo!(),
        actor_identity: todo!(),
        tenant_scope: todo!(),
        trace_identity: todo!(),
        _seal: PhantomData,
    };
}
