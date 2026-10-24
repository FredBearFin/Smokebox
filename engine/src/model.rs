//! The planner's input and output, in the same field names the JavaScript engine uses (camelCase), so a kitchen's state can
//! be handed over as JSON without renaming anything.

use serde::{Deserialize, Serialize};

/// One station and how many dishes it can cook at the same time. A capacity of 0 means "not limited", which is how every
/// station behaves until the owner answers "How many can cook at once here?".
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    #[serde(default)]
    pub capacity: u32,
}

/// Where a dish is in its life: waiting for its start time, due and waiting for a cook, cooking, or done.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Displayed,
    Cooking,
    Done,
}

/// One dish line on a ticket, as the JavaScript engine stores it. `prep_sec` is the planned cook time for the whole line (the
/// quantity already counted in), `per_slot` how many portions share one basket or grill spot (0 or 1: one portion per slot).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TicketItem {
    pub id: String,
    pub zone: String,
    #[serde(default = "one")]
    pub qty: u32,
    pub prep_sec: i64,
    pub status: Status,
    #[serde(default)]
    pub fire_at: Option<i64>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub per_slot: u32,
}

/// The default quantity when a line does not say: one portion.
fn one() -> u32 {
    1
}

/// One open ticket. `paced` is false for a rush ticket or when the kitchen switched the timing coach off: then every dish
/// starts as soon as its station has room, with no holding back.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: String,
    pub created_at: i64,
    #[serde(default = "yes")]
    pub paced: bool,
    pub items: Vec<TicketItem>,
}

/// The default for `paced`: the timing coach is on.
fn yes() -> bool {
    true
}

/// Everything the planner needs: the time now, the stations with their capacity, and the open tickets in the order they
/// should be served (the first ticket gets the first free slot).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
    pub now: i64,
    #[serde(default)]
    pub stations: Vec<Station>,
    pub tickets: Vec<Ticket>,
}

/// The planner's decision for one dish that is not done.
/// - `fire_at`: when it should start (for a waiting dish) or when it went on the board (for a due or cooking dish).
/// - `held`: the dish starts later than it would with unlimited room, because its station is full.
/// - `free_at`: for a due dish whose station is full right now, when a slot frees up (None when it can go in now).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub ticket_id: String,
    pub id: String,
    pub fire_at: i64,
    pub held: bool,
    pub free_at: Option<i64>,
}

/// The whole plan: one entry per dish that is not done, in ticket order and, inside a ticket, in line order.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanOutput {
    pub items: Vec<PlanItem>,
}
