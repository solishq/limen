/// Compile-fail test: application code cannot construct FoundationReadCapability.
/// The `mint` function is `pub(crate)` — not accessible outside the crate.
/// This file MUST fail to compile.
fn main() {
    use std::marker::PhantomData;
    use limen_types::TenantScope;

    // Attempt 1: Direct struct construction — fields are private.
    let _cap = limen_foundation_contract::capabilities::FoundationReadCapability {
        reader: todo!(),
        scope: TenantScope("test".into()),
        _seal: PhantomData,
    };
}
