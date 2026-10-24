//! The door between JavaScript and the engine. JSON goes in through memory the engine hands out, JSON comes back the same
//! way. Three functions, no other dependency, so the same WebAssembly file works in a browser and in Node:
//! - `sb_alloc(len)` gives a buffer for the input;
//! - `sb_plan(ptr, len)` reads a `PlanInput`, plans, and returns where the output JSON is (pointer in the high 32 bits,
//!   length in the low 32 bits); bad input gives `{"error":"..."}`;
//! - `sb_free(ptr, len)` gives a buffer back.

use crate::model::PlanInput;
use crate::schedule::plan;

/// Hands out a buffer of `len` bytes for the caller to write input into.
#[no_mangle]
pub extern "C" fn sb_alloc(len: u32) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Takes back a buffer handed out by `sb_alloc` or returned by `sb_plan`.
///
/// # Safety
/// `ptr` and `len` must be exactly what `sb_alloc` or `sb_plan` gave out, and the buffer must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn sb_free(ptr: *mut u8, len: u32) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len as usize));
    }
}

/// Plans the kitchen described by the JSON in [ptr, ptr+len) and returns the plan as JSON (pointer << 32 | length).
///
/// # Safety
/// [ptr, ptr+len) must be a readable buffer, normally one filled after `sb_alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn sb_plan(ptr: *const u8, len: u32) -> u64 {
    let input = std::slice::from_raw_parts(ptr, len as usize);
    let json = match serde_json::from_slice::<PlanInput>(input) {
        Ok(p) => serde_json::to_string(&plan(&p)).unwrap_or_else(|e| format!("{{\"error\":{:?}}}", e.to_string())),
        Err(e) => format!("{{\"error\":{:?}}}", e.to_string()),
    };
    // A boxed slice has exactly its length as capacity, so `sb_free(ptr, len)` gives back exactly what was allocated.
    let bytes = json.into_bytes().into_boxed_slice();
    let out_len = bytes.len() as u64;
    let out_ptr = Box::into_raw(bytes) as *mut u8 as usize as u64;
    (out_ptr << 32) | out_len
}
