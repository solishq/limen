// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Type-level guards against forbidden types in canonical structures.
//!
//! `CanonicalBTreeMap` — the only map type permitted in canonical structures.
//! `HashMap` is structurally forbidden (v1.3 §10.2 rule 1).
//! `f32`/`f64` are forbidden by convention; compile-fail tests verify.

use std::collections::BTreeMap;
use serde::{Serialize, Deserialize, Serializer, Deserializer};

/// A BTreeMap wrapper for canonical structures. Ensures sorted key order.
/// This is the ONLY map type permitted in types implementing CanonicalSerialize.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalBTreeMap<K: Ord, V>(pub BTreeMap<K, V>);

impl<K: Ord, V> CanonicalBTreeMap<K, V> {
    pub fn new() -> Self {
        Self(BTreeMap::new())
    }

    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }

    pub fn iter(&self) -> std::collections::btree_map::Iter<'_, K, V> {
        self.0.iter()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl<K: Ord + Default, V> Default for CanonicalBTreeMap<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<K: Ord + Serialize, V: Serialize> Serialize for CanonicalBTreeMap<K, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // BTreeMap iterates in sorted key order by default
        self.0.serialize(serializer)
    }
}

impl<'de, K: Ord + Deserialize<'de>, V: Deserialize<'de>> Deserialize<'de> for CanonicalBTreeMap<K, V> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let map = BTreeMap::deserialize(deserializer)?;
        Ok(Self(map))
    }
}
