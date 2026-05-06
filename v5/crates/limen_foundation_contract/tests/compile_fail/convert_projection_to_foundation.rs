/// Compile-fail test: ProjectionReadCapability cannot convert to FoundationReadCapability.
/// No From, Into, AsRef, or any conversion path exists.
/// This file MUST fail to compile.
fn main() {
    use limen_types::TenantScope;

    // We can't even construct ProjectionReadCapability (mint is pub(crate)),
    // but even if we could, there's no conversion.
    // This tests that the types are not interchangeable at the type level.

    fn takes_foundation(_cap: &limen_foundation_contract::capabilities::FoundationReadCapability) {}

    // Attempt: pass a ProjectionReadCapability where FoundationReadCapability is expected.
    let proj_cap: limen_foundation_contract::capabilities::ProjectionReadCapability = todo!();
    takes_foundation(&proj_cap);
}
