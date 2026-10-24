//! WHAT THIS CRATE IS: the SmokeBox kitchen engine's planner. It decides when every waiting dish on every open ticket should
//! start, for the whole kitchen at once, knowing how many dishes each station can cook at the same time (fryer baskets,
//! burners, grill spots). It keeps each ticket's dishes finishing together, holds a dish back while its station is full, and
//! says when a full station frees up.
//!
//! The same code runs on the tablet (compiled to WebAssembly, see `ffi`) and on the server (native), so every device and the
//! server agree on one plan. All times are whole milliseconds (i64) and no floating point decides anything, so the result is
//! identical on every machine.
//!
//! With no station limits the plan is exactly the JavaScript engine's old per-ticket plan (`pacingPlan` in
//! src/js/20-engine.js): the slowest dish starts at once and every other dish waits for the slowest minus its own time.

pub mod ffi;
pub mod model;
pub mod schedule;

pub use model::{PlanInput, PlanItem, PlanOutput, Station, Ticket, TicketItem};
pub use schedule::plan;
