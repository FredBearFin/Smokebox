//! The whole-kitchen plan. Steps:
//! 1. Dishes already cooking hold their slots until their timer is up.
//! 2. Dishes already due (on the board, not started) take the next free slot at their station, in the order they came due.
//!    If the station is full, the dish is told when a slot frees up (`free_at`).
//! 3. Every ticket with waiting dishes is planned in order. Its finish time is the latest of: its dishes already cooking or
//!    due, and each waiting dish's earliest possible finish given the room left. Each waiting dish then starts at that
//!    finish time minus its own cook time, moved later only when its station is full then. A move that makes the ticket
//!    finish later moves the finish time, and the ticket is planned again (a few rounds at most).
//!
//! With no station limits this gives the old per-ticket plan exactly: the slowest dish starts at the ticket's creation and
//! every other dish waits for the slowest minus its own time.

use crate::model::{PlanInput, PlanItem, PlanOutput, Status, Ticket, TicketItem};
use std::collections::BTreeMap;

/// How many times a ticket is re-planned when a full station pushes its finish time later. Each round can only move the
/// finish later, and a handful of rounds settles any real ticket; the last round's plan is used either way.
const ROUNDS: usize = 8;

/// One booking of slots at a station from `start` (inclusive) to `end` (exclusive), in milliseconds.
#[derive(Debug, Clone, Copy)]
struct Booking {
    start: i64,
    end: i64,
    slots: u32,
}

/// The bookings of every limited station. Stations with no limit are not tracked at all.
#[derive(Debug, Clone, Default)]
struct Room {
    cap: BTreeMap<String, u32>,
    book: BTreeMap<String, Vec<Booking>>,
}

impl Room {
    /// Builds the room from the station list; a capacity of 0 means the station has no limit.
    fn new(input: &PlanInput) -> Self {
        let mut r = Room::default();
        for s in &input.stations {
            if s.capacity > 0 {
                r.cap.insert(s.id.clone(), s.capacity);
                r.book.insert(s.id.clone(), Vec::new());
            }
        }
        r
    }

    /// How many slots a dish needs at its station: its portions split over the portions one slot holds, at least one, and
    /// never more than the station has (so a big order still gets cooked, using the whole station).
    fn slots_for(&self, it: &TicketItem) -> u32 {
        let per = it.per_slot.max(1);
        let need = it.qty.max(1).div_ceil(per).max(1);
        match self.cap.get(&it.zone) {
            Some(&c) => need.min(c),
            None => need,
        }
    }

    /// The most slots in use at the station at any moment in [from, to).
    fn peak(&self, zone: &str, from: i64, to: i64) -> u32 {
        let Some(list) = self.book.get(zone) else { return 0 };
        // Usage only rises at a booking's start, so checking `from` and every start inside the window is enough.
        let mut points = vec![from];
        points.extend(list.iter().filter(|b| b.start > from && b.start < to).map(|b| b.start));
        points
            .into_iter()
            .map(|t| list.iter().filter(|b| b.start <= t && t < b.end).map(|b| b.slots).sum::<u32>())
            .max()
            .unwrap_or(0)
    }

    /// The earliest moment at or after `from` when the station has `slots` free for `dur` milliseconds. An unlimited
    /// station always answers `from`.
    fn earliest(&self, zone: &str, from: i64, dur: i64, slots: u32) -> i64 {
        let (Some(&cap), Some(list)) = (self.cap.get(zone), self.book.get(zone)) else { return from };
        let mut tries = vec![from];
        tries.extend(list.iter().filter(|b| b.end > from).map(|b| b.end));
        tries.sort_unstable();
        tries.dedup();
        for t in tries {
            if self.peak(zone, t, t + dur.max(1)) + slots <= cap {
                return t;
            }
        }
        // Once the last booking ends the station is empty and `slots` never exceeds the capacity, so the loop always
        // returns; this line only keeps the compiler content.
        from
    }

    /// Books `slots` at the station for [start, end). Unlimited stations are not booked.
    fn take(&mut self, zone: &str, start: i64, end: i64, slots: u32) {
        if let Some(list) = self.book.get_mut(zone) {
            list.push(Booking { start, end: end.max(start + 1), slots });
        }
    }
}

/// A dish's cook time in milliseconds (never negative).
fn dur(it: &TicketItem) -> i64 {
    it.prep_sec.max(0) * 1000
}

/// Plans one ticket's waiting dishes with the timing coach on: they all aim to finish with the ticket's slowest dish, each
/// moved later only as far as its full station forces. Returns the start time of each dish in `order`, and books them in
/// `room`. `fixed` is the finish time already set by the ticket's cooking and due dishes (i64::MIN when there are none).
fn plan_paced(room: &mut Room, t: &Ticket, order: &[usize], fixed: i64) -> Vec<i64> {
    // The earliest each dish could finish if it started as soon as its station has room.
    let mut finish = fixed;
    for &ii in order {
        let it = &t.items[ii];
        let go = room.earliest(&it.zone, t.created_at, dur(it), room.slots_for(it));
        finish = finish.max(go + dur(it));
    }
    let mut starts = Vec::new();
    let mut trial = room.clone();
    for _ in 0..ROUNDS {
        trial = room.clone();
        starts.clear();
        let mut later = false;
        for &ii in order {
            let it = &t.items[ii];
            let slots = trial.slots_for(it);
            let want = (finish - dur(it)).max(t.created_at);
            let go = trial.earliest(&it.zone, want, dur(it), slots);
            trial.take(&it.zone, go, go + dur(it), slots);
            starts.push(go);
            if go + dur(it) > finish {
                finish = go + dur(it);
                later = true;
            }
        }
        if !later {
            break;
        }
    }
    *room = trial;
    starts
}

/// Plans one ticket's waiting dishes with the timing coach off (or a rush): each starts as soon as its station has room.
fn plan_now(room: &mut Room, t: &Ticket, order: &[usize]) -> Vec<i64> {
    order
        .iter()
        .map(|&ii| {
            let it = &t.items[ii];
            let slots = room.slots_for(it);
            let go = room.earliest(&it.zone, t.created_at, dur(it), slots);
            room.take(&it.zone, go, go + dur(it), slots);
            go
        })
        .collect()
}

/// Plans the whole kitchen. Pure: the same input always gives the same output, on every machine.
pub fn plan(input: &PlanInput) -> PlanOutput {
    let now = input.now;
    let mut room = Room::new(input);
    let mut out: BTreeMap<(usize, usize), PlanItem> = BTreeMap::new();

    // 1. Cooking dishes keep their slots until their timer is up (or until now, for one past its time).
    for (ti, t) in input.tickets.iter().enumerate() {
        for (ii, it) in t.items.iter().enumerate() {
            if it.status != Status::Cooking {
                continue;
            }
            let start = it.started_at.unwrap_or(now);
            let slots = room.slots_for(it);
            room.take(&it.zone, start, (start + dur(it)).max(now), slots);
            out.insert((ti, ii), PlanItem { ticket_id: t.id.clone(), id: it.id.clone(), fire_at: it.fire_at.unwrap_or(start), held: false, free_at: None });
        }
    }

    // 2. Due dishes take the next free slot, the one that came due first going first.
    let mut due: Vec<(i64, usize, usize)> = Vec::new();
    for (ti, t) in input.tickets.iter().enumerate() {
        for (ii, it) in t.items.iter().enumerate() {
            if it.status == Status::Displayed {
                due.push((it.fire_at.unwrap_or(t.created_at), ti, ii));
            }
        }
    }
    due.sort_unstable();
    for (fire_at, ti, ii) in due {
        let it = &input.tickets[ti].items[ii];
        let slots = room.slots_for(it);
        let go = room.earliest(&it.zone, now, dur(it), slots);
        room.take(&it.zone, go, go + dur(it), slots);
        let free_at = if go > now { Some(go) } else { None };
        out.insert((ti, ii), PlanItem { ticket_id: input.tickets[ti].id.clone(), id: it.id.clone(), fire_at, held: false, free_at });
    }

    // 3. Waiting dishes, ticket by ticket.
    for (ti, t) in input.tickets.iter().enumerate() {
        let waiting: Vec<usize> = (0..t.items.len()).filter(|&i| t.items[i].status == Status::Queued).collect();
        if waiting.is_empty() {
            continue;
        }
        // The finish time already set by this ticket's cooking and due dishes.
        let mut fixed = i64::MIN;
        for (ii, it) in t.items.iter().enumerate() {
            match it.status {
                Status::Cooking => fixed = fixed.max(it.started_at.unwrap_or(now) + dur(it)),
                Status::Displayed => {
                    let go = out.get(&(ti, ii)).and_then(|p| p.free_at).unwrap_or(now);
                    fixed = fixed.max(go + dur(it));
                }
                _ => {}
            }
        }
        // The slowest dish goes first when room is shared; ties keep line order, so the plan never depends on sorting luck.
        let mut order = waiting.clone();
        order.sort_by(|&a, &b| dur(&t.items[b]).cmp(&dur(&t.items[a])).then(a.cmp(&b)));
        // Where each dish would start with unlimited room, to tell which ones the station limits hold back.
        let ideal_finish = order.iter().map(|&ii| t.created_at + dur(&t.items[ii])).fold(fixed, i64::max);
        let starts = if t.paced { plan_paced(&mut room, t, &order, fixed) } else { plan_now(&mut room, t, &order) };
        for (&ii, &start) in order.iter().zip(starts.iter()) {
            let it = &t.items[ii];
            let ideal = if t.paced { (ideal_finish - dur(it)).max(t.created_at) } else { t.created_at };
            out.insert((ti, ii), PlanItem { ticket_id: t.id.clone(), id: it.id.clone(), fire_at: start, held: start > ideal, free_at: None });
        }
    }
    PlanOutput { items: out.into_values().collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Station, Ticket, TicketItem};

    const MIN: i64 = 60_000;

    /// A waiting dish line for the tests.
    fn dish(id: &str, zone: &str, prep_sec: i64) -> TicketItem {
        TicketItem { id: id.into(), zone: zone.into(), qty: 1, prep_sec, status: Status::Queued, fire_at: None, started_at: None, per_slot: 0 }
    }
    /// A ticket for the tests, made at `at` ms, with the timing coach on.
    fn ticket(id: &str, at: i64, items: Vec<TicketItem>) -> Ticket {
        Ticket { id: id.into(), created_at: at, paced: true, items }
    }
    /// The planned start of one dish, in ms.
    fn start_of(out: &PlanOutput, id: &str) -> i64 {
        out.items.iter().find(|p| p.id == id).unwrap().fire_at
    }

    #[test]
    fn unlimited_room_is_the_old_per_ticket_plan() {
        // Brisket 300 s, slaw x2 264 s, mac 120 s (the JS engine's own test): brisket at 0, slaw at 36 s, mac at 180 s.
        let input = PlanInput { now: 0, stations: vec![], tickets: vec![ticket("t1", 0, vec![dish("b", "pit", 300), dish("s", "cold", 264), dish("m", "sides", 120)])] };
        let out = plan(&input);
        assert_eq!((start_of(&out, "b"), start_of(&out, "s"), start_of(&out, "m")), (0, 36_000, 180_000));
        assert!(out.items.iter().all(|p| !p.held));
    }

    #[test]
    fn fries_wait_for_frank_the_way_the_owner_expects() {
        // French fries 7 min and Freaky Frank 5 min: fries now, Frank 2 minutes later, both done at 7 minutes.
        let input = PlanInput { now: 0, stations: vec![], tickets: vec![ticket("t1", 0, vec![dish("fries", "fry", 420), dish("frank", "pit", 300)])] };
        let out = plan(&input);
        assert_eq!((start_of(&out, "fries"), start_of(&out, "frank")), (0, 2 * MIN));
    }

    #[test]
    fn a_full_fryer_holds_the_third_ticket_and_its_other_dish_waits_to_match() {
        // Two baskets. Tickets 1 and 2 fill both with 3-minute fries. Ticket 3 has fries and a 1-minute side.
        let fryer = Station { id: "fry".into(), capacity: 2 };
        let input = PlanInput {
            now: 0,
            stations: vec![fryer],
            tickets: vec![
                ticket("t1", 0, vec![dish("f1", "fry", 180)]),
                ticket("t2", 0, vec![dish("f2", "fry", 180)]),
                ticket("t3", 0, vec![dish("f3", "fry", 180), dish("side", "sides", 60)]),
            ],
        };
        let out = plan(&input);
        assert_eq!(start_of(&out, "f1"), 0);
        assert_eq!(start_of(&out, "f2"), 0);
        // The third basket is free only at 3 minutes; its side waits so both finish at 6 minutes.
        assert_eq!(start_of(&out, "f3"), 3 * MIN);
        assert_eq!(start_of(&out, "side"), 5 * MIN);
        assert!(out.items.iter().find(|p| p.id == "f3").unwrap().held);
    }

    #[test]
    fn portions_that_share_a_basket_take_one_slot() {
        // Four portions of fries, four to a basket, take one slot of two: a second ticket's fries still go in at once.
        let fryer = Station { id: "fry".into(), capacity: 2 };
        let mut big = dish("big", "fry", 180);
        big.qty = 4;
        big.per_slot = 4;
        let input = PlanInput { now: 0, stations: vec![fryer], tickets: vec![ticket("t1", 0, vec![big]), ticket("t2", 0, vec![dish("f2", "fry", 180)])] };
        let out = plan(&input);
        assert_eq!((start_of(&out, "big"), start_of(&out, "f2")), (0, 0));
    }

    #[test]
    fn a_due_dish_at_a_full_station_is_told_when_a_slot_frees() {
        // One grill spot, busy until 90 s. A burger is due now: it can go in at 90 s.
        let grill = Station { id: "pit".into(), capacity: 1 };
        let mut cooking = dish("steak", "pit", 120);
        cooking.status = Status::Cooking;
        cooking.started_at = Some(-30_000);
        let mut burger = dish("burger", "pit", 240);
        burger.status = Status::Displayed;
        burger.fire_at = Some(0);
        let input = PlanInput { now: 0, stations: vec![grill], tickets: vec![ticket("t1", -60_000, vec![cooking]), ticket("t2", 0, vec![burger])] };
        let out = plan(&input);
        assert_eq!(out.items.iter().find(|p| p.id == "burger").unwrap().free_at, Some(90_000));
    }

    #[test]
    fn a_late_lead_dish_moves_its_siblings_so_the_ticket_still_finishes_together() {
        // Brisket (5 min) was started 1 minute late, at 60 s. The 2-minute side now starts at 4 min, not 3.
        let mut lead = dish("b", "pit", 300);
        lead.status = Status::Cooking;
        lead.started_at = Some(60_000);
        let input = PlanInput { now: 70_000, stations: vec![], tickets: vec![ticket("t1", 0, vec![lead, dish("side", "sides", 120)])] };
        let out = plan(&input);
        assert_eq!(start_of(&out, "side"), 4 * MIN);
    }

    #[test]
    fn rush_starts_everything_as_soon_as_there_is_room() {
        let mut t = ticket("t1", 0, vec![dish("b", "pit", 300), dish("side", "sides", 60)]);
        t.paced = false;
        let out = plan(&PlanInput { now: 0, stations: vec![], tickets: vec![t] });
        assert_eq!((start_of(&out, "b"), start_of(&out, "side")), (0, 0));
    }

    #[test]
    fn the_same_kitchen_always_gets_the_same_plan() {
        let fryer = Station { id: "fry".into(), capacity: 2 };
        let input = PlanInput {
            now: 5_000,
            stations: vec![fryer],
            tickets: (0..6).map(|i| ticket(&format!("t{i}"), i * 7_000, vec![dish(&format!("f{i}"), "fry", 150 + i * 10), dish(&format!("p{i}"), "pit", 200)])).collect(),
        };
        assert_eq!(plan(&input), plan(&input));
    }
}
