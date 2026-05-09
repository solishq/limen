// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Canonical MessagePack serialization (v1.3 §10.2 + founder length-prefix clarification).
//!
//! Custom serializer that enforces:
//! - Rule 3: Fixed-width integer encoding per declared Rust type
//! - Founder clarification: str32/bin32/array32/map32 for all length-prefixed types
//! - Rule 2: Struct fields as positional arrays (declaration order)
//! - Rule 1: BTreeMap keys in sorted order (BTreeMap's natural iteration)
//!
//! Does NOT use `rmp_serde::to_vec` (the deviation source).

use serde::ser::{self, Serialize, Serializer, SerializeSeq, SerializeMap, SerializeStruct,
    SerializeTuple, SerializeTupleStruct, SerializeTupleVariant, SerializeStructVariant};
use crate::traits::CanonicalSerialize;

/// Blanket implementation using the custom canonical serializer.
impl<T: Serialize> CanonicalSerialize for T {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let mut ser = CanonicalMsgPackSerializer { buf: &mut buf };
        self.serialize(&mut ser)
            .expect("canonical MessagePack serialization must not fail for well-typed structures");
        buf
    }
}

/// Custom MessagePack serializer enforcing v1.3 §10.2 canonical rules.
struct CanonicalMsgPackSerializer<'a> {
    buf: &'a mut Vec<u8>,
}

impl<'a> CanonicalMsgPackSerializer<'a> {
    fn write_u8_val(&mut self, v: u8) { self.buf.push(v); }
    fn write_u16_be(&mut self, v: u16) { self.buf.extend_from_slice(&v.to_be_bytes()); }
    fn write_u32_be(&mut self, v: u32) { self.buf.extend_from_slice(&v.to_be_bytes()); }
    fn write_u64_be(&mut self, v: u64) { self.buf.extend_from_slice(&v.to_be_bytes()); }
    fn write_i8_val(&mut self, v: i8) { self.buf.push(v as u8); }
    fn write_i16_be(&mut self, v: i16) { self.buf.extend_from_slice(&v.to_be_bytes()); }
    fn write_i32_be(&mut self, v: i32) { self.buf.extend_from_slice(&v.to_be_bytes()); }
    fn write_i64_be(&mut self, v: i64) { self.buf.extend_from_slice(&v.to_be_bytes()); }
}

impl<'a, 'b> Serializer for &'a mut CanonicalMsgPackSerializer<'b> {
    type Ok = ();
    type Error = CanonicalError;
    type SerializeSeq = CanonicalSeqSerializer<'a, 'b>;
    type SerializeTuple = CanonicalSeqSerializer<'a, 'b>;
    type SerializeTupleStruct = CanonicalSeqSerializer<'a, 'b>;
    type SerializeTupleVariant = CanonicalSeqSerializer<'a, 'b>;
    type SerializeMap = CanonicalMapSerializer<'a, 'b>;
    type SerializeStruct = CanonicalSeqSerializer<'a, 'b>;
    type SerializeStructVariant = CanonicalSeqSerializer<'a, 'b>;

    // === Fixed-width integers (§10.2 rule 3) ===

    fn serialize_u8(self, v: u8) -> Result<(), Self::Error> {
        self.buf.push(0xcc); // uint8 tag
        self.write_u8_val(v);
        Ok(())
    }

    fn serialize_u16(self, v: u16) -> Result<(), Self::Error> {
        self.buf.push(0xcd); // uint16 tag
        self.write_u16_be(v);
        Ok(())
    }

    fn serialize_u32(self, v: u32) -> Result<(), Self::Error> {
        self.buf.push(0xce); // uint32 tag
        self.write_u32_be(v);
        Ok(())
    }

    fn serialize_u64(self, v: u64) -> Result<(), Self::Error> {
        self.buf.push(0xcf); // uint64 tag
        self.write_u64_be(v);
        Ok(())
    }

    fn serialize_i8(self, v: i8) -> Result<(), Self::Error> {
        self.buf.push(0xd0); // int8 tag
        self.write_i8_val(v);
        Ok(())
    }

    fn serialize_i16(self, v: i16) -> Result<(), Self::Error> {
        self.buf.push(0xd1); // int16 tag
        self.write_i16_be(v);
        Ok(())
    }

    fn serialize_i32(self, v: i32) -> Result<(), Self::Error> {
        self.buf.push(0xd2); // int32 tag
        self.write_i32_be(v);
        Ok(())
    }

    fn serialize_i64(self, v: i64) -> Result<(), Self::Error> {
        self.buf.push(0xd3); // int64 tag
        self.write_i64_be(v);
        Ok(())
    }

    // === Bool ===

    fn serialize_bool(self, v: bool) -> Result<(), Self::Error> {
        self.buf.push(if v { 0xc3 } else { 0xc2 });
        Ok(())
    }

    // === Nil ===

    fn serialize_none(self) -> Result<(), Self::Error> {
        self.buf.push(0xc0); // nil
        Ok(())
    }

    fn serialize_some<T: ?Sized + Serialize>(self, value: &T) -> Result<(), Self::Error> {
        value.serialize(self)
    }

    fn serialize_unit(self) -> Result<(), Self::Error> {
        self.buf.push(0xc0); // nil
        Ok(())
    }

    // === Strings: str32 (founder clarification) ===

    fn serialize_str(self, v: &str) -> Result<(), Self::Error> {
        self.buf.push(0xdb); // str32 tag
        self.write_u32_be(v.len() as u32);
        self.buf.extend_from_slice(v.as_bytes());
        Ok(())
    }

    // === Bytes: bin32 (founder clarification) ===

    fn serialize_bytes(self, v: &[u8]) -> Result<(), Self::Error> {
        self.buf.push(0xc6); // bin32 tag
        self.write_u32_be(v.len() as u32);
        self.buf.extend_from_slice(v);
        Ok(())
    }

    // === Floats: forbidden in canonical (§10.2 rule 4) ===

    fn serialize_f32(self, _v: f32) -> Result<(), Self::Error> {
        Err(CanonicalError::FloatForbidden)
    }

    fn serialize_f64(self, _v: f64) -> Result<(), Self::Error> {
        Err(CanonicalError::FloatForbidden)
    }

    // === Char (as string) ===

    fn serialize_char(self, v: char) -> Result<(), Self::Error> {
        let mut buf = [0u8; 4];
        let s = v.encode_utf8(&mut buf);
        self.serialize_str(s)
    }

    // === Sequences: array32 (founder clarification) ===

    fn serialize_seq(self, len: Option<usize>) -> Result<Self::SerializeSeq, Self::Error> {
        let len = len.ok_or(CanonicalError::UnknownLength)?;
        self.buf.push(0xdd); // array32 tag
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }

    fn serialize_tuple(self, len: usize) -> Result<Self::SerializeTuple, Self::Error> {
        self.buf.push(0xdd); // array32
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }

    // === Structs: serialized as array32 (positional, §10.2 rule 2) ===

    fn serialize_struct(self, _name: &'static str, len: usize) -> Result<Self::SerializeStruct, Self::Error> {
        self.buf.push(0xdd); // array32 — struct as positional array
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }

    fn serialize_tuple_struct(self, _name: &'static str, len: usize) -> Result<Self::SerializeTupleStruct, Self::Error> {
        self.buf.push(0xdd); // array32
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }

    // === Maps: map32 (founder clarification) ===

    fn serialize_map(self, len: Option<usize>) -> Result<Self::SerializeMap, Self::Error> {
        let len = len.ok_or(CanonicalError::UnknownLength)?;
        self.buf.push(0xdf); // map32 tag
        self.write_u32_be(len as u32);
        Ok(CanonicalMapSerializer { ser: self })
    }

    // === Enums ===

    fn serialize_unit_struct(self, _name: &'static str) -> Result<(), Self::Error> {
        self.buf.push(0xdd); // array32 with 0 elements
        self.write_u32_be(0);
        Ok(())
    }

    fn serialize_unit_variant(self, _name: &'static str, variant_index: u32, _variant: &'static str) -> Result<(), Self::Error> {
        // Enum unit variant as map32 { variant_index: nil }
        self.buf.push(0xdf); // map32
        self.write_u32_be(1);
        self.serialize_u32(variant_index)?;
        self.buf.push(0xc0); // nil
        Ok(())
    }

    fn serialize_newtype_struct<T: ?Sized + Serialize>(self, _name: &'static str, value: &T) -> Result<(), Self::Error> {
        value.serialize(self)
    }

    fn serialize_newtype_variant<T: ?Sized + Serialize>(self, _name: &'static str, variant_index: u32, _variant: &'static str, value: &T) -> Result<(), Self::Error> {
        // Enum newtype variant as map32 { variant_index: value }
        self.buf.push(0xdf); // map32
        self.write_u32_be(1);
        self.serialize_u32(variant_index)?;
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.buf })
    }

    fn serialize_tuple_variant(self, _name: &'static str, variant_index: u32, _variant: &'static str, len: usize) -> Result<Self::SerializeTupleVariant, Self::Error> {
        self.buf.push(0xdf); // map32
        self.write_u32_be(1);
        // key: variant_index
        self.buf.push(0xce); // u32 tag
        self.write_u32_be(variant_index);
        // value: array32
        self.buf.push(0xdd); // array32
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }

    fn serialize_struct_variant(self, _name: &'static str, variant_index: u32, _variant: &'static str, len: usize) -> Result<Self::SerializeStructVariant, Self::Error> {
        self.buf.push(0xdf); // map32
        self.write_u32_be(1);
        self.buf.push(0xce); // u32 tag
        self.write_u32_be(variant_index);
        self.buf.push(0xdd); // array32
        self.write_u32_be(len as u32);
        Ok(CanonicalSeqSerializer { ser: self })
    }
}

// === Sequence serializer (for arrays, tuples, structs) ===

struct CanonicalSeqSerializer<'a, 'b> {
    ser: &'a mut CanonicalMsgPackSerializer<'b>,
}

impl<'a, 'b> SerializeSeq for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

impl<'a, 'b> SerializeTuple for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

impl<'a, 'b> SerializeTupleStruct for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

impl<'a, 'b> SerializeTupleVariant for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

impl<'a, 'b> SerializeStruct for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, _key: &'static str, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

impl<'a, 'b> SerializeStructVariant for CanonicalSeqSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, _key: &'static str, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

// === Map serializer ===

struct CanonicalMapSerializer<'a, 'b> {
    ser: &'a mut CanonicalMsgPackSerializer<'b>,
}

impl<'a, 'b> SerializeMap for CanonicalMapSerializer<'a, 'b> {
    type Ok = ();
    type Error = CanonicalError;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, key: &T) -> Result<(), Self::Error> {
        key.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, value: &T) -> Result<(), Self::Error> {
        value.serialize(&mut CanonicalMsgPackSerializer { buf: self.ser.buf })
    }
    fn end(self) -> Result<(), Self::Error> { Ok(()) }
}

// === Error type ===

#[derive(Debug)]
pub enum CanonicalError {
    FloatForbidden,
    UnknownLength,
    Custom(String),
}

impl std::fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FloatForbidden => write!(f, "floats are forbidden in canonical structures (§10.2 rule 4)"),
            Self::UnknownLength => write!(f, "sequence/map length must be known for canonical encoding"),
            Self::Custom(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for CanonicalError {}

impl ser::Error for CanonicalError {
    fn custom<T: std::fmt::Display>(msg: T) -> Self {
        Self::Custom(msg.to_string())
    }
}
