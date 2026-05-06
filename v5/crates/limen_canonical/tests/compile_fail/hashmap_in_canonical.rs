/// Compile-fail test: HashMap cannot be used where CanonicalBTreeMap is expected.
/// v1.3 §10.2 rule 1: HashMap is forbidden in canonical structures.
/// This tests that the type system prevents HashMap from entering canonical paths.
fn main() {
    use std::collections::HashMap;
    use limen_canonical::CanonicalBTreeMap;

    // Attempt to assign a HashMap to a CanonicalBTreeMap — type mismatch.
    let hm: HashMap<String, i64> = HashMap::new();
    let _canonical: CanonicalBTreeMap<String, i64> = hm;
}
