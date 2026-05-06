//! Compile-fail tests for canonical serialization (v1.3 §10.2).

#[test]
fn compile_fail_tests() {
    let t = trybuild::TestCases::new();
    t.compile_fail("tests/compile_fail/*.rs");
}
