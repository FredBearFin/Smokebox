# Smokebox KDS v2: Z-style specification of the engine

This is the formal companion to SPEC sections 5-10. It follows Wordsworth's style, as used for Pitcall: informal text, then a schema, then what it means. Each operation is made **total** by joining its success schema with error schemas that change nothing. The notation is ASCII:

```
+-- Name --------------------------    schema box: declarations above the bar, predicates below
| decl                                Delta S   = before S and after S'      Xi S = S' = S (and the SAME reference)
+---------------------------------    x?        = optional field ("unknown is not zero": absent, never 0)
| predicate                           #s = size, dom f = keys, ran f = values, <=> iff, => implies, /\ and, \/ or
+---------------------------------    tau       = the evaluation time of a state (the `now` of the apply/tick that made it)
```

The code is `src/js/20-engine.js` (`SB.engine`); the invariant checker `checkInvariants(state, now)` implements the predicates marked I1-I19. Property tests run every predicate after every step of 12,000+ random steps (`test/engine.fuzz.test.mjs`).

---

## 1. Given sets and constants

```
[TicketId, ItemId, MenuId, IngId, BatchId, SyncId, EventId]        opaque identifiers ('t_17', 't_17.2', 'b_3' ...)
Time   == Z  (epoch ms, virtual)      Grams == R, >= 0 ('ea' units for counted ingredients)
Zone   ::= pit | sides | fry | cold                                 (expo is a view, never a destination)
Channel ::= dine_in | takeout | drive_thru | third_party
Report ::= ok | unknownAction | unknownTicket | unknownItem | unknownMenu | unknownBatch | unknownIng | emptyOrder | badQty
         | tooManyItems | badCustomer | badChannel | noteTooLong | itemUnavailable | ticketNotActive | ticketNotExpedited
         | notAllDone | alreadyDone | alreadyFired | notQueued | nothingToDo | reasonRequired | badTemp | tempTooLow
         | notReheatable | notEnoughData | batchNotServable | badWeight | badPatch | outOfBounds | undoExpired | undoNothing
         | undoConflict | invalidBackup | exportTooLarge | storageBlocked
         | moduleOff | nameTaken | tooManyIngredients | portionsConflict       (added with the clean start; the list above is not complete, the code's REPORT_IDS is)
```

Pacing constants come from `state.settings.pacing` (owner-editable within bounds): `floorSec, qtyFactor, qtyCap, learnK, minFactor, maxFactor, outlierFactor`. The safety constants come from `state.settings.safety`, each bounded by `C.safetyBounds` (`hotHoldF >= 135` always).

```
qtyScale(q)          = min(qtyCap, 1 + qtyFactor * (q - 1))
estimate(m)          = learned(m).est   if m in dom learned,  else  menu(m).prepSec
linePrep(m, q)       = round(max(floorSec, estimate(m) * qtyScale(q)))
learnEst(n, ema, s)  = clamp((n * ema + learnK * s) / (n + learnK), minFactor * s, maxFactor * s)
```

## 2. Items and tickets

An item is one ticket line, routed to its menu item's zone at creation and snapshotted (name, price, plan). Timestamps exist only once the event has happened.

```
+-- Item -------------------------------------------------------------------------------------
| id : ItemId; menuId : MenuId; zone : Zone; qty : 1..20; track : {one, two}; price : R
| prepSec, offsetSec : N; fireAt : Time; rushed? : true; override? : true
| status : {queued, displayed, cooking, done}
| firedAt?, startedAt?, doneAt? : Time
| depleted? : seq {ing : IngId; g : Grams; batchId? : BatchId; short? : Grams}; cost? : R
+--------------------------------------------------------------------------------------------
| firedAt defined   <=> status /= queued                                             [I3]
| doneAt defined    <=> status = done                                                [I3]
| startedAt defined  => track = two /\ status in {cooking, done}                     [I3]
| status = cooking   => startedAt defined                                            [I3]
| depleted defined  <=> status = done   (undo removes it again)
+--------------------------------------------------------------------------------------------
```

```
+-- Ticket -----------------------------------------------------------------------------------
| id : TicketId; num : N; serviceDate : Date; channel : Channel; customer : String(1..40)
| createdAt : Time; rush, pacing : Bool; dmaxSec : N; src : {live, demo, sample}
| status : {active, expedited, voided}; recalls : N; forced? : true
| expeditedAt?, voidedAt? : Time; voidReason? : String(1..40)
| items : seq1 Item   (#items <= 30)
+--------------------------------------------------------------------------------------------
| serviceDate = date(createdAt - dayStartHour)                                       (F13)
| forall i : items . createdAt <= i.firedAt <= i.startedAt <= i.doneAt  (where defined)   [I3]
| forall i : items . i.zone in Zone  (never expo)                                    [I6]
| forall i : items .                                                                 [I5]
|     i.offsetSec = (if i.rushed \/ dmaxSec = 0 then 0 else dmaxSec - i.prepSec)
|  /\ 0 <= i.offsetSec <= dmaxSec  /\  i.fireAt = createdAt + 1000 * i.offsetSec
| status = expedited  <=> expeditedAt defined                                         [I4]
| status = expedited /\ not forced  =>  forall i : items . i.status = done           [I4]
| status = expedited  =>  expeditedAt >= max { i.doneAt | i in items }               [I4]
| status = voided     =>  voidReason defined /\ voidedAt defined                     [I11]
+--------------------------------------------------------------------------------------------
```

Planned firing is the research formula: `D_max = max d(i)`, `O(i) = D_max - d(i)`, with item i shown when `now >= createdAt + O(i)`. `dmaxSec = 0` records "not paced" (rush at creation, or pacing off). An item fired by `setRush` keeps a consistent plan: offset 0, `fireAt = createdAt`, `rushed`.

## 3. Batches (hold cabinet)

```
+-- Batch ------------------------------------------------------------------------------------
| id : BatchId; ing : IngId (tcs); kind : {hot, cold, cooling}; enteredAt : Time; maxHoldH? : R
| cookedG : Grams; remainingG : Grams; rawG?, yieldPct?, costPerCookedKg?, endpointC?, holdH? : R
| temps : seq {t : Time; f : 32..300}; lastTempF?, lastTempAt?, outSince? : Time; reheats : N
| coolStartAt?, stage1At?, finalAt? : Time      (cooling only)
| status : {ok, check, reheat, chill, discard}; action : GateAction; canServe : Bool
| discardedAt? : Time; discardReason? : {expired, temp, cooling, manual, quality, other}; wasteG? : Grams
+--------------------------------------------------------------------------------------------
| remainingG >= 0                                                                    [I1]
| status = discard  =>  canServe = false /\ remainingG = 0 /\ wasteG defined         [I8]
| kind = cooling    =>  canServe = false                                             [I8]
| remainingG > 0 \/ kind = cooling  =>  (status, canServe) = gate(self, tau, safety) [I8, at tau]
+--------------------------------------------------------------------------------------------
```

An empty pan (`remainingG = 0`, not cooling) is **frozen**. Nothing can be served from it and nothing is wasted, so its gate is not re-run (F-E4). Undo that puts grams back unfreezes it.

The gate is a total function of a batch, a time and the safety settings. The first matching row wins. `hold = min(maxHoldH, defaultMaxHoldH)`.

```
gate(b, t) for kind hot | cold:
  1  t - enteredAt > hold                                     -> DISCARD_LOCKOUT  'expired'   canServe false
  2  hot,  outSince def, reheats >= 1                         -> DISCARD_LOCKOUT  'temp'      (single reheat only)
     hot,  outSince def, t - outSince > belowHotGraceH        -> DISCARD_LOCKOUT  'temp'
     hot,  outSince def                                       -> REHEAT_IMMEDIATE             canServe false
     cold, outSince def, t - outSince > aboveColdGraceH       -> DISCARD_LOCKOUT  'temp'
     cold, outSince def                                       -> CHILL_NOW                    canServe false
  3  lastTempAt undef  \/  t - lastTempAt > tempCheckEveryMin -> CHECK_TEMP  (warn; bad past 2x)   canServe true
  4  otherwise                                                -> NONE                          canServe true
gate(b, t) for kind cooling (never servable): finalAt def -> NONE ('cooled'); t > coolStart + totalH -> DISCARD 'cooling';
  no stage1 reading by coolStart + stage1H -> REHEAT_IMMEDIATE (DISCARD if already reheated once); else CHILL_NOW.
```

`outSince` is the first out-of-range **reading** that has not been corrected (hot: below `hotHoldF`; cold: above `coldHoldF`). This differs from the research sample code on purpose (F-E1). A hot batch is corrected only by its single reheat to `reheatF`. A `logTemp` at reheat temperature inside the grace window counts as that reheat. A cold batch is corrected by any later in-range reading.

## 4. The state

```
+-- Kitchen ----------------------------------------------------------------------------------
| settings; menu : seq MenuItem; ingredients : seq Ingredient
| tickets : seq Ticket                     (oldest -> newest, sorted by id sequence)
| batches : seq Batch; stock : IngId -|> Grams   (non-TCS only)
| manual86 : MenuId -|> {since}; avail : MenuId -|> {ok, reason, ing, since}
| syncs : seq Sync; learned : MenuId -|> {n, ema, est}; sanitize : {lastAt?, dueAt}
| seq : {ticket, batch, event, sync, undo : N; byDate : Date -|> N}
| events : seq Event; eventArchive : seq seq Event     (allEvents = concat archive ^ events)
| undo : seq UndoEntry (<= 20); ledger : IngId -|> {open, in, prunedUsed, prunedWaste, prunedRemain, dropped}
| rev : N
+--------------------------------------------------------------------------------------------
| forall k : dom stock . stock k >= 0                                                [I1]
| forall g : ingredients .                                                           [I2]
|     open + in - used(g) - prunedUsed - waste(g) - prunedWaste - prunedRemain - dropped
|        = physical(g)            (within 0.5 g)
|   where used(g)  = sum { r.g | t in tickets, i in t.items, r in i.depleted, r.ing = g }
|         waste(g) = sum { b.wasteG | b in batches, b.ing = g }
|         physical(g) = (if g.tcs then sum { b.remainingG | b in batches, b.ing = g } else stock g)
| forall s : batches . I8 (above); servable(g) counts only b.canServe /\ status /= discard /\ kind /= cooling
| allEvents is non-decreasing in t                                                   [I9]
| ticket ids, item ids unique; (serviceDate, num) unique; seq.ticket >= every id seq  [I10]
| forall t : tickets . t.recalls >= 0                                                [I11]
| forall m : dom learned . minFactor * prepSec(m) <= learned(m).est <= maxFactor * prepSec(m)   [I14]
| forall m : menu . avail(m) |> {ok, reason, ing} = availability(self, m)            [I15]
| lastClose = <> \/ (lastClose.day is a YYYY-MM-DD date /\ lastClose.at is a time /\ lastClose.leftovers in {keep, discard})   [I17]
| forall t : tickets, i : t.items . t.status = active /\ i.status = queued => i.fireAt > tau     [I5, at tau]
+--------------------------------------------------------------------------------------------
```

The ledger turns I2 into a real check: two records are kept independently, the depletion records on items and the grams in pans and stock, and they must agree whatever was pruned, discarded or undone. Behavioural invariants (I7, I12, I13) are properties of operations, stated in section 6.

```
availability(s, m) =
  (false, manual, -)   if m in dom manual86
  (false, safety, g)   if some TCS g in bom(m) has servable(g) <= 0 and (locked grams of g > 0, or the newest batch of g
                       was discarded for expired | temp | cooling)
  (false, stock, g)    if some g in bom(m) has servable(g) - qty <= 0 or servable(g) <= thresholdG(g)
  (true, null, null)   otherwise
```

## 5. Initial state

```
+-- InitKitchen -------------------------------------------------------------------------------
| Kitchen'; now? : Time; empty? : Bool
+--------------------------------------------------------------------------------------------
| tickets' = <>; events' = <>; undo' = <>; learned' = {}; manual86' = {}; sanitize' = {dueAt = now?}
| not empty? => one 'starter' batch per TCS ingredient (parG, reading 155 F hot / 38 F cold at now?) /\ stock' = parG
| empty?     => batches' = <> /\ stock' = 0
| ledger'(g).open = physical(g); avail' = availability for every menu item (since = now?)
+--------------------------------------------------------------------------------------------
```

The first sanitise is due at once: it is honestly unknown when surfaces were last done.

**BlankKitchen.** `newState({ blank: true })` is the start of a brand-new install: `menu' = <>; ingredients' = <>; batches' = <>; stock' = {}; ledger' = {}`, `catalog' = 'own'`, `settings' = blankSettings()` (the normal defaults with `pacing.enabled = false` and `modules.cookAhead = false`). `defaultSettings()` and every other start are unchanged. `catalog` is absent on every older save and on the demo.

## 6. Operations

Every operation is `apply(s, type, payload, now)`. It first catches up the kitchen to `now` (`Tick`), then runs the action. Totality:

```
+-- Refuse(r) ----------------------------------------------------------------------------------
| Xi Kitchen; report! : Report
+--------------------------------------------------------------------------------------------
| report! = r /\ r /= ok /\ s' == s        (the same reference: the catch-up tick is thrown away too)   [I12]
+--------------------------------------------------------------------------------------------
Op == OpOK \/ Refuse(r1) \/ Refuse(r2) \/ ...      the guards of the Refuse cases cover every input not accepted by OpOK
```

An exception inside a handler is caught and returned as `badPatch` with `info.internalError`. The fuzz test asserts that this never happens. Unknown types (including `"__proto__"`, `"constructor"`, `"toString"`) give `unknownAction`; a non-finite `now` gives `badPatch`.

### 6.1 CreateTicket

```
+-- CreateTicketOK -----------------------------------------------------------------------------
| Delta Kitchen; lines? : seq {menuId; qty; mods}; customer?; channel?; note?; rush?; createdAt?; src?
+--------------------------------------------------------------------------------------------
| 1 <= #lines? <= 30;  forall l . l.menuId in dom menu /\ not archived /\ l.qty in 1..20
| forall l : lines? . avail(l.menuId).ok                                              [I7]
| createdAt in [now - 48h, now]  (any past time when allowPast)
| let d = (linePrep(l.menuId, l.qty) | l in lines?); paced = pacing.enabled /\ not rush?
|     D = (if paced then max d else 0)
| tickets' = tickets ^ <t> where t.id = 't_' (seq.ticket + 1), t.num = byDate(serviceDate) + 1 (101 first),
|     item k: zone = menu(l.menuId).zone, prepSec = d k, offsetSec = (if paced then D - d k else 0)
| every item with fireAt <= now is displayed with firedAt = fireAt (exact plan time)
+--------------------------------------------------------------------------------------------
CreateTicket == CreateTicketOK \/ Refuse(emptyOrder | badPatch | tooManyItems | badCustomer | badChannel | noteTooLong
                | outOfBounds | unknownMenu | badQty | itemUnavailable)
```

### 6.2 Item and ticket flow

| op | precondition (else report) | effect |
|---|---|---|
| AdvanceItem | ticket (`unknownTicket`), item (`unknownItem`), ticket active (`ticketNotActive`), not done (`alreadyDone`), not queued (`nothingToDo`, info.why `onDeck`) | displayed+two -> cooking, `startedAt = max(firedAt, now)`; otherwise -> done (see Complete) |
| CompleteItem | as above | displayed/cooking -> done |
| FireNow | ticket, item, active; status queued (`alreadyFired`) | displayed, `firedAt = max(createdAt, now)`, `override` |
| CompleteZone | ticket; zone in Zone (`badPatch`); active; some not-done item in zone (`nothingToDo`) | every such item done; queued ones count as `override` |
| BumpTicket | ticket; active; all done unless `force` (`notAllDone`, info.remaining) | expedited, `expeditedAt = max(now, createdAt, all item stamps)`, `forced` iff items left |
| RecallTicket | ticket; expedited (`ticketNotExpedited`) | active, `recalls + 1`, `expeditedAt` removed; due queued items fire now (F-E3) |
| VoidTicket | ticket; reason 1..40 (`reasonRequired`, `noteTooLong`); active | voided, `voidedAt`, `voidReason` |
| SetRush | ticket; `on` boolean (`badPatch`); active; changes something (`nothingToDo`) | on: queued items -> displayed now, offset 0, `fireAt = createdAt`, `rushed` |

**Complete (shared by every path to done):** `doneAt = max(startedAt ?? firedAt, now)`. Depletion: for each BOM line, `need = qty_bom * item.qty`. TCS ingredients draw first-in-first-out from servable batches (oldest `enteredAt` first, never a locked one: I8). Others draw from `stock`. What cannot be drawn is recorded as `short` and logged (`stock_short`); nothing goes negative (I1). Learning: unless `override` or (two-step with no `startedAt`), `sample = min((doneAt - (startedAt ?? firedAt)) / 1000 / qtyScale, outlierFactor * starter)`, `n' = n + 1`, `ema' = (n = 0 ? sample : 0.8 ema + 0.2 sample)`, `est' = learnEst(n', ema', starter)` (I14).

### 6.2b Orders and closing the day

| op | precondition (else report) | effect |
|---|---|---|
| CloseDay `{ leftovers?: keep or discard }` | `leftovers` is keep (default) or discard (`badLeftovers`); **no order is open** (`ordersStillOpen`, info `count`, `orderIds`, `customers`): each one must be paid or voided first | appends one `day_closed` event for the service day of `now`, sets `lastClose = { day, at, leftovers }`. With discard, every batch still holding food is discarded as reason `other` (a plain, non-safety discard) and the grams land in waste, so I2 holds. Not undoable. |

`day_closed` carries, for the paid orders whose `paidAt` falls in that service day: `orders`, `subtotal`, `discount`, `tax`, `total`, `tip`, and `byMethod` (`cash`, `card`, `other`, each with `count`, `subtotal`, `discount`, `tax`, `total`, `tip`, in dollars to the cent). It also carries `voidedOrders`, `tickets` and `voidedTickets` for that day, `leftovers`, `discarded` (batches), `discardedG`, and `again` (true when that day was closed before). Closing the same day twice is allowed on purpose: late sales after the first close are caught by the second, which covers the whole day. `resetLive` clears `lastClose`. Saves written before this action have no `lastClose`; `validateBackup` accepts that and drops a malformed one (`repaired` says `lastClose dropped`).

### 6.3 Stock, availability and the hold cabinet

| op | precondition (else report) | effect |
|---|---|---|
| Toggle86 | menu item (`unknownMenu`); `on` boolean; changes something (`nothingToDo`) | `manual86` set/removed |
| Restock | ingredient (`unknownIng`); `0 < g <= 1e6` (`badWeight`) | non-TCS: `stock + g`; TCS: a new batch with **no** reading (status `check`, servable) |
| AddBatch | TCS ingredient; `tempF in 32..300` (`badTemp`); a weight (`badWeight`) | thermal: `cookedG = round(rawG * hot% / 100)`; else `rawG * yield` or `cookedG` as given; first reading sets `outSince` when out of range |
| LogTemp | batch (`unknownBatch`); not discarded (`batchNotServable`); `tempF in 32..300` | reading appended; `outSince` updated (sec. 3); gate re-run, discard if locked out |
| ReheatBatch | batch; not discarded; not cold (`notReheatable`); `tempF >= reheatF` (`tempTooLow`); `reheats = 0` (`notReheatable`); out of range (`nothingToDo`); inside grace (`notReheatable`) | `outSince` cleared, `reheats = 1` (cooling: restart cooling) |
| StartCooling (P2) | batch; hot; has grams (`nothingToDo`); `0 < g <= remainingG + 0.5` (`badWeight`) | grams move to a new `cooling` batch (never servable) |
| DiscardBatch | batch; reason in the list (`reasonRequired`); not discarded (`batchNotServable`) | `wasteG = remainingG`, `remainingG = 0`, status discard |
| SanitizeDone | none | `lastAt = now`, `dueAt = now + sanitizeEveryH`; records on-time or late |

After every action and every tick that touches a batch, stock, `manual86`, the menu or ingredients, `avail` is recomputed (I15). Each change appends `avail_changed`. A change of `ok` creates a simulated sync record whose four channel targets complete `2 + (hash(syncId|target) mod 38001 ms)` later. That is deterministic, never random, and always inside the 60-second target.

### 6.3b Who did it: initials and the safety log

`LogTemp`, `ReheatBatch`, `StartCooling`, `DiscardBatch` and `SanitizeDone` take an optional `who` (1 to 12 characters after trimming; anything else gives `badWho`). It is stored on the event (`temp_logged`, `batch_reheat`, `cooling_started`, `batch_discard`, `sanitize_done`) and on the reading in `batch.temps`. `KeepServing` and `EndKeepServing` already require `who`. Without `who` the event has no `who` field at all, so older screens, older saves and old events stay valid.

| op | precondition (else report) | effect |
|---|---|---|
| CorrectSafety `{ eventId, note, who }` | `who` 1..12 (`whoRequired`); `note` non-empty (`reasonRequired`) and within the note limit (`noteTooLong`); `eventId` names an existing safety entry: temperature, reheat, cooling, discard, sanitize or keep-serving (`unknownSafetyEntry`) | appends `safety_correction { of, ofType, batchId?, who, note }`. Nothing else changes. |

The safety log is append-only: the original entry is never edited or removed, and an entry may be corrected more than once. `safetyLog(state)` returns `[{ event, corrections }]`, oldest first. I18: initials on any event are 1 to 12 characters, and a `safety_correction` has `who`, a non-empty `note` and an `of`. `validateBackup` keeps initials on readings only when valid.

**Retention (safetyKeep).** The safety event types are `safety_setting_changed`, `temp_logged`, `batch_reheat`, `batch_discard`, `cooling_started`, `sanitize_done`, `quality_extend`, `quality_extend_corrected` and `safety_correction`. Whenever the main event log is trimmed (the `maxEvents` cap in `appendEvents`, `prune(state, { maxEvents })` which the store calls on a full quota, or the cap applied by `validateBackup`), the safety events among the dropped ones move to `state.safetyKeep`, an ordinary list of events, oldest first. The bucket is trimmed only by age: entries older than 400 days (measured from the newest event) leave it; it has no size cap. `safetyLog(state)` reads the bucket and the main log together. I19: `safetyKeep`, when present, holds only safety events with ids and times, oldest first. Saves without it load fine. `resetLive` and the store's `reset` start a fresh board and clear it on purpose.

### 6.4 Settings and catalogue

`UpdateSettings`, `UpdateMenuItem` and `UpdateIngredient` accept only whitelisted keys (`badPatch` names the offending key) and in-bounds values (`outOfBounds` with `min` and `max`). A patch that changes nothing gives `nothingToDo`. Changing safety settings re-runs every gate. Changing pacing bounds or a starter `prepSec` recomputes `learned.est` (I14). `ResetLive` keeps settings, menu, ingredients and learned unless `keepSettings = false`, keeps the id counters (ids are never reused) and restores the starter stock.

### 6.5 Undo

```
+-- UndoOK -------------------------------------------------------------------------------------
| Delta Kitchen
+--------------------------------------------------------------------------------------------
| undo /= <> /\ now <= last(undo).expiresAt
| the things last(undo) touched still carry the values it wrote (else Refuse(undoConflict))
| s' restores every field the action changed, from INVERSE data (before-values, depletion records), not a snapshot,
|   so an unrelated change made in between is kept                                   [I13]
| events of the undone action are kept, marked reverted; an 'undo' event is appended
+--------------------------------------------------------------------------------------------
Undo == UndoOK \/ Refuse(undoNothing) \/ Refuse(undoExpired) \/ Refuse(undoConflict)
```

I13, as tested: `strip(undo(apply(s, a, now), now)) = strip(tick(s, now))` for every undoable `a` (advanceItem, completeItem, completeZone, bumpTicket, voidTicket, toggle86, fireNow, discardBatch, sanitizeDone). Here `strip` drops `events`, `eventArchive`, `undo`, `rev`, the `seq.event/sync/undo` counters and `syncs` (the simulated channel feed really did see the 86 and then the un-86). `avail.since` is restored. If a batch the undone depletion drew from has since been discarded or pruned, those grams are booked in `ledger.dropped` (I2 holds) and the report is `ok` with `info.partial`.

### 6.6 Tick

```
+-- Tick ---------------------------------------------------------------------------------------
| Delta Kitchen; now? : Time
+--------------------------------------------------------------------------------------------
| forall active t, queued i . i.fireAt <= now?  =>  i' displayed /\ i'.firedAt = i.fireAt     (exact, at any clock speed)
| forall sync targets . dueAt <= now? => doneAt = dueAt  (sync_done, latencyMs = dueAt - t)
| forall non-empty batches b . now? > statusDeadline(b) => b' = gate(b, now?) applied; DISCARD_LOCKOUT discards
| nothing due  =>  s' == s  (same reference; O(1) via a memoised next deadline)
+--------------------------------------------------------------------------------------------
```

`tick` never changes `rev`, because only actions are announced to other tabs. Sanitise overdue is a warning, never a block, so `tick` does not touch it.

### 6.4b Ingredients, portions on hand and the cook-ahead switch

| Operation | Rules | Effect |
|---|---|---|
| AddIngredient `{ name, unit?, costPerKg?, costEach?, parG?, thresholdG?, tcs?, hold?, maxHoldH?, holdBasis? }` | name 1..60 and not used by another ingredient (`nameTaken`); at most 80 ingredients (`tooManyIngredients`); `unit` is `g` (default) or `ea`; `costPerKg` only for `g` and `costEach` only for `ea` (`badPatch`); numbers in the edit ranges (`outOfBounds`); `tcs` needs unit `g` and the cook-ahead module on (`moduleOff`); the id is made from the name and never equals a config ingredient id or an existing id | appends the ingredient, `stock(id) = 0` (not for `tcs`), a zero ledger entry, `settings_changed`. A `tcs` ingredient defaults to hot, 4 hours, hold basis `safety`, cook 2 h, rest 0, pull 1000 g. Undoable: undo removes it while no recipe, stock, batch or books entry refers to it (`undoConflict` otherwise). |
| SetPortions `{ menuId, on, count? }` | dish exists (`unknownMenu`); `on` boolean; `count` a whole number 0..100000 (`outOfBounds`); turning on a dish that lists other ingredients gives `portionsConflict`; no change gives `nothingToDo` | on: makes or revives a hidden ingredient `forMenu = menuId` (`unit ea`, `exact`, `hidden`), sets the dish's recipe to one portion of it, and adds `count` to stock and to the ledger intake. off: the recipe line goes, the ingredient is archived, stock and books stay. |

| MoveMenuItem `{ id, toIndex }` | dish exists (`unknownMenu`); `toIndex` a whole number from 0 to the last place (`outOfBounds` with `min` and `max`); the same place gives `nothingToDo` | moves the dish in `menu`; logs `settings_changed { keys: ['menu.<id>.moved'] }`. Undoable: undo puts the dish back while it is still at the place the move gave it (`undoConflict` otherwise). Invariant B2: menu ids are unique. |

`AddMenuItem` also takes `prepGuess` (boolean): when true the prep time is stored unconfirmed (`prepConfirmed = false`), as for an imported menu, and the app keeps learning the real time. A refused order line (`itemUnavailable`) now puts the dish's own name in `info.name`, so the message names custom dishes. The menu importer (`SB.menuImport`, `src/js/13-menu-import.js`) is a separate pure module: it reads text into checked rows and builds `AddMenuItem` actions; it never changes the state itself.

A recipe is set with `UpdateMenuItem { bom }` (known ingredients, no repeats, up to 12 lines). Availability uses `exact` ingredients differently: a counted ingredient is out only when fewer than one portion is left (no safety margin and no 86 level), so "I made 20" sells 20. A dish with no recipe is never sold out by itself and records no cost (`cost` is absent, never 0); the same holds for a dish whose ingredient has no cost entered, and for a batch with no cost on record (`batch_discard` then carries no `cost`). `ItemDone` and the cost analytics treat an absent cost as unrecorded.

`E.moduleOn(state, 'cookAhead')` is false only when `settings.modules.cookAhead === false`. While it is false, `AddBatch`, `PlanBatch` and a `restock` of cook-ahead food give `moduleOff`. `E.cookAheadActive(state)` is the module being on or any batch still holding food; when it is false, `views.counts` reports no sanitize reminder and the deadline feed (`SB.deadlines.build`) has no batch, safety or sanitize rows (ticket rows stay). Invariant B1: every recipe line names an existing ingredient, and every `forMenu` names an existing dish. `ResetLive` accepts `catalog: 'sample'` (loads the sample dishes and ingredients; refused with `badPatch` over an own kitchen that already has dishes, orders or tickets unless `replaceOwn`) and `catalog: 'blank'`.

## 7. Backups

`validateBackup(x)` is total. It returns `{ok: true, state, repaired}` or `{ok: false, error}` and changes nothing. It repairs fields one at a time: settings out of bounds fall back to defaults, negative stock becomes 0, unsafe ids are dropped, a ticket whose own invariants fail is dropped, and a ledger that no longer balances is re-opened at the current physical stock. Anything left inconsistent is refused. A state with `catalog = 'own'` is never topped up from the sample menu or ingredients; any other state still gets missing sample entries restored as before. `serialize` then `validateBackup` is the identity up to the undo stack (tested).

## 8. Store obligations (SB.store)

The clock `now = base + (real - realBase) * speed` is clamped so that it never decreases (I9). `setSpeed` rebases without a jump, and a reload continues from the saved virtual time at x1. The only exception is `reset`/`resetLive`: they bring a demo-sped clock back to real time, which is safe because the new state holds no stamps. Persistence is debounced at 400 ms and flushed on `pagehide`/hidden when there are unsaved changes. A pristine first run is not written until something happens, so storage that was just cleared is not brought back. A payload that fails `validateBackup` is kept under `smokebox.v1.corrupt` and the app starts fresh. If storage refuses on quota, the store halves the persisted history (through `prune`, so I2 holds) rather than losing the save. A refused user action appends `ui_report` (except `nothingToDo`).

**Transport and outbox.** The store talks to other tabs, other devices and a future server through a pluggable transport (`open(deliver)`, `post(msg)`, optional `push(entries)`, `close()`); the full contract is the "TRANSPORT INTERFACE" comment block in `30-store.js`. The default is a same-browser `BroadcastChannel`. Every dispatched action gets an `opId` (outside the engine; the engine stays pure). When a transport can `push`, each successful person-made action is queued in a persisted outbox (`smokebox.v1.outbox`) until the server acknowledges its `opId`; a server must treat a repeated `opId` as already done. An action arriving from elsewhere (`type: 'action'`) is applied once per `opId` and never re-queued.  A hub can send `type: 'state'` with the authoritative state and the `opIds` it includes; the store adopts it and replays its still-unconfirmed actions on top.

**Units.** `settings.ui.tempUnit` (`F` or `C`) and `settings.ui.weightUnit` (`kg` or `lb`) only change how numbers are shown. The engine and the saves keep degrees Fahrenheit (cook endpoints stay in Celsius, as before) and grams. The store keeps `SB.util.units` in step with the settings; screens use `U.tempText`, `U.tempTextC`, `U.tempShown`, `U.tempStored`, `U.weightText`, `U.weightShown`, `U.weightStored` and `U.unitLabel`. Old saves without the fields get `F` and `kg`.

### 8.1 Kitchens, modes and keys (added with the clean start)

**Two kinds of kitchen, one engine.** A state may carry `catalog = 'own'` (a kitchen that began empty: the sample dishes and ingredients are never restored into it) or have no `catalog` (every older save and the demo). `settings.modules.cookAhead` is absent on those older states and means on; an explicit `false` turns the cabinet, temperature checks and sanitize reminders off. `defaultSettings()` and the byte-level start states of the demo are pinned by `test/golden-hashes.test.mjs`.

**Mode.** `SB.util.mode()` is `'real'` or `'demo'`, decided at page load from `?demo` or this tab's `sessionStorage['smokebox.mode']` (anything else is real). `SB.store.init({ mode, blank, storage, now, reload, transport, noTimers, noSync })`: naming a mode makes the store *isolated*: the demo's kitchen data lives under `smokebox.demo.*` instead of `smokebox.v1.*`, its tab channel is `smokebox-demo`, a server transport is never opened in the demo, the real kitchen refuses any clock speed other than 1 and ignores the sample history, backups carry `mode`, and an import from the other mode is refused with `wrongBackupMode`. `init()` without a mode is unchanged (the plain tests). `blank: true` makes a brand-new real install start empty; saved data always wins. The calls: `isBlank()` (own kitchen, no live dish), `isOwn()`, `mode()`, `isDemo()`, `isolated()`, `enterDemo()` (saves the real kitchen, sets the tab flag, reloads), `leaveDemo()` (deletes every `smokebox.demo.*` key, clears the flag, stops that tab saving, reloads).

**Keys** (`SB.util.sharedKeys` for device settings, `SB.util.dataKeys` for kitchen data; `test/demo-isolation.test.mjs` fails when a `smokebox.v1.*` literal in `src/` is in neither list): `state`, `sid`, `outbox`, `corrupt`, `corruptat`, `lastgood`, `names`, `sample`, `welcome`, `lastbackup`, `dlog`, `alertlog`, `lastbatch`, `initials`, `pinlock`, `paymethod`, and the `setup.*` keys are kitchen data (separate copies in the demo); `theme`, `otheme`, `textsize`, `density`, `hints`, `zone`, `role`, `sound`, `volume`, `speech`, `voicelevel`, `callouts`, `far`, `wall`, `dock` are device settings. An unlisted key is treated as kitchen data. Sizes and trim rules: `docs/audit/storage-budget.md`.

**Saving.** One value (`state`) per save, debounced 400 ms; after a slow save the next wait is eight times its duration, between 400 ms and 5 s (`status().saveCostMs`, `saveDelayMs`). If the browser refuses the value: the last good copy is deleted and the save retried once; then at most 1,500 tickets and 10,000 events are kept, halving up to 12 times; the oldest finished tickets, paid orders and events go first, and never the menu, ingredients, stock, settings and PIN, open tickets and open orders, batches, or the safety records (kept 400 days in `safetyKeep`). If nothing fits, the copy in memory stays whole and `status().lastSaveOk` is false.

**The last good copy** (`lastgood`, isolated real kitchens only): a validated, trimmed state (300 tickets, 2,000 events) taken after a whole live save on the first save of a session, after every `closeDay`, and every 6 hours. A damaged live save (unreadable text, or text that fails `validateBackup`) is set aside under `corrupt` with its time in `corruptat`, and the copy is loaded in its place (`status().restoredFromCopy` holds its time); with no usable copy the kitchen starts blank. A set-aside copy is cleared 30 days after `corruptat`, never while the live save is itself damaged.

**Backups.** The envelope is `{ v, savedAt, rev, clock, state, names?, setup?, mode? }`: `names` is the owner's station, category and channel names (they were already carried), `setup` holds the lists of hidden stations and example dishes, `mode` is present in isolated builds. A backup with no `mode` is a real kitchen's. Importing restores the names and lists before the check and puts the old names back if the import is refused.

**Actions added this session** (full rules in 6.4b): `addIngredient`, `setPortions`, `moveMenuItem`; `addMenuItem` takes `prepGuess`; `resetLive` takes `catalog` (`'sample'` or `'blank'`) and `replaceOwn` and drops learned prep times when it replaces the dishes. **Invariants added:** B1 (every recipe line names an existing ingredient; every portion-counting ingredient names an existing dish) and B2 (menu ids are unique). **The menu importer** is `SB.menuImport` (`src/js/13-menu-import.js`): `parse`, `toActions`, `exportMenu`, `readPrice`, `limits`.

### 8.2 Start over and old demo tickets

`SB.store.startOver({ confirm, keepSettings = true })` (real kitchen only): refused with `confirmWord` unless `confirm` is the word in `SB.store.START_OVER_WORD` ("ERASE", any case, spaces around allowed), with `notInDemo` in the demo, with `badPatch` for a non-boolean `keepSettings`. It first takes a full backup with `exportAll` (if that fails nothing is cleared and the report says why), refreshes the last good copy (`reason: 'startOver'`), then runs `resetLive { catalog: 'blank', replaceOwn: true, starter: false, keepSettings }`, removes the setup-progress and log keys (`setup.*`, `welcome`, `dlog`, `lastbatch`, `alertlog`), and with `keepSettings: false` also resets the owner station names. Settings kept: tax, hours, PIN, units, station names; the cook-ahead switch is always off afterwards, like a new install. Id counters continue so ids are never reused. It returns `{ ok, report, info, backup: { text, filename, mime, savedAt, chars } }`; the screen offers the backup for download. Demo keys are never read, written or removed.

`E.demoLeftovers(state)` / `SB.store.demoLeftovers()` count the tickets made by the old in-place demo or the sample history (`src` demo or sample) that sit in a real kitchen's reports: `{ tickets, orders, paidOrders, openOrders, mixedOrders, events }` (the store adds `kept` and `offer`). An order that holds any real ticket is never counted and neither are its tickets (`mixedOrders`). The action `clearDemoTickets {}` removes exactly those tickets, their orders and their events, moves the removed tickets' used grams into the books (`prunedUsed`), empties the undo stack, logs `demo_tickets_cleared`, and gives `nothingToDo` when there are none. `SB.store.clearDemoLeftovers()` runs it and saves; `SB.store.keepDemoLeftovers()` remembers the owner's "keep them" answer in `smokebox.v1.demoLeftoversKept`. The store announces a failed save (and its recovery) to subscribers at once, and the shell redraws its red strip on every store notice.

### 8.3 Money, the service day and starter names (round 11)

**Money is whole cents.** `toCents(v) = round(v x 100 + a tiny nudge)`, so a typed 1.005 is 101 cents. Dish prices are stored in whole cents (`addMenuItem` and `updateMenuItem` round), tips and discounts are read to whole cents, and an order's food is the sum of `toCents(price) x qty` over its tickets that are not voided. `totalsFrom`: `discountC = min(toCents(discount), foodC)`, `taxableC = foodC - discountC`, `taxC = floor((taxableC x round(rate x 10000) + 500000) / 1000000)` (the rate to four decimals of a percent, half a cent rounds up), `totalC = taxableC + taxC`. Example: 1480.75 dollars at 10 percent is 148.075, so tax 148.08 (a float sum gave 148.07). A paid order keeps the totals frozen when it was paid; reopening and paying again works them out afresh at the rate then. Invariant I16 now checks, for a paid order, that subtotal, discount, tax, total and tip are whole cents and that `total = subtotal - discount + tax` exactly (older frozen totals pass: they were built from the same sum). There is one payment per order: no partial payments, split bills or refunds exist; a mistaken payment is corrected with `reopenOrder`. `test/money-time.test.mjs` compares the engine with an independent integer reference over thousands of random orders (rounds, voided rounds, discounts by amount and percent, tips by amount and percent, rates such as 7.25 and 8.875) and checks that the close-day sums equal the sum of the paid orders by method.

**The service day** (`U.serviceDate`) follows the wall clock: a moment before the day-start hour (default 4 am) belongs to the previous date. On the two 2026 daylight-saving nights (8 March, 1 November) the day still turns over at 4 am on the wall (subtracting four hours of real time moved it to 3 am or 5 am). A day closed twice writes two `day_closed` records; the later covers the whole day and `lastClose` holds the latest. A clock that goes back is absorbed by the store (time never decreases) and by the engine (event times never decrease); tickets are neither lost nor numbered twice.

**Starter names.** A brand-new empty kitchen gets neutral names for the stations (Kitchen, Prep, Fryer, Cold and drinks, Expo) and the menu sections (Mains, Sides, Snacks, Desserts, Drinks) through the owner-names mechanism (`SB.store.applyStarterNames`, called by the start-up and by `startOver` when it resets settings). The ids (`pit`, `sides`, `fry`, `cold`, `expo`; `meat`, `sandwich`, `side`, `fried`, `cold`) never change. Old kitchens, the demo, kitchens that have dishes and owners who chose their own names are left alone.

### 8.4 Service settings (round 12)

All new settings are absent by default and mean today's behavior; `defaultSettings()` and the golden hashes are unchanged.

- **`settings.service.counter`** (bool): counter service. When true and an order is paid (`payOrder`, or `createTicket` with `pay`), every live (active, not voided) ticket of that order is finished and bumped in the same transaction: its open items become `done` (stock is used as for any finished item, `stock_short` is recorded if short, no prep time is learned), carry `auto: true` and keep their honest `firedAt`; the ticket becomes `expedited` with `auto: true`; the events `item_done` (`workMs: 0, auto: true`) and `ticket_expedited` (`auto: true`) are written. Items and tickets already done or voided are left alone, so earlier rounds finished by hand keep their real times. `info.autoFinished` is the number of items finished. Reports leave `auto` tickets out of every speed statistic (pace index, anatomy, ticket time) and `auto` items out of work and response times, but they count as sales and in volume. The board can read `E.counterOn(settings)` to skip START and DONE wording.
- **`settings.service.chips`** (list of strings or absent): the customer chips on the order screen. Absent means the built-in `C.quickNames` list; an empty list means no chips. Up to `E.CHIP_MAX` (12) labels of 1 to `E.CHIP_LEN` (24) characters, tidied (spaces squeezed), no label twice in any case. `E.chipsOf(settings)` gives the list to show. Set it with the action `setChips { chips }` (undoable; `null` goes back to the built-in list) or with `updateSettings` (same checks, not undoable). A damaged list in a backup is reset.
- **`settings.ui.currency`** (string or absent): the money symbol, 1 to 3 letters or currency signs (`U.validCurrency`); absent or invalid means `$`. `U.fmtMoney` is the one formatter and reads it live (`U.currencySymbol()`, `U.setCurrency(c)`; the store sets it whenever the settings load or change). Exports and backups hold plain numbers.
- **Draft order** (store only, not an action): `SB.store.saveDraft(obj)`, `loadDraft()`, `clearDraft()`; key `smokebox.v1.orderdraft` (kitchen data, so the demo has its own); at most 20,000 characters; forgotten after 12 hours; not in backups; cleared by a successful `createTicket` from a person and by Start over.

### 8.5 PIN recovery code (round 12)

`SB.store.createRecoveryCode()` (async) makes a 10-character code ("ABCDE-FGHJK", letters and digits without I, O, 0 and 1, from the browser's secure random numbers), saves only its salted SHA-256 in `settings.office.recoveryHash`, and returns the code once for the screen to show; it needs a PIN (`pinRequired`) and works for a PIN set before codes existed; a new code replaces the old. `SB.store.recoverPin(code, newPinHash)` (async; `newPinHash` null removes the PIN) accepts the code in any case with spaces or dashes, sets the new PIN hash, spends the code, and clears the attempt count. Wrong codes give `wrongRecoveryCode` with `info.triesLeft`; five wrong codes lock recovery for 15 minutes (`recoveryLocked`, `info.waitMs`), even for the right code, and the count lives in `smokebox.v1.pinrecovery` so a reload does not reset it. No code made: `noRecoveryCode`. No secure hashing in the browser: `noCrypto`. `SB.store.hasRecoveryCode()` says whether one exists. The code is never saved, logged or put in a backup; the hash is in the settings and so in backups.

### 8.6 Cold items kept in a fridge (round 14)

A cooked-ahead product with `hold: 'cold'` can be marked `fridge: true` (off or absent by default, so every older kitchen, the sample and the demo behave exactly as before). The owner then types up to two limits, both optional and with no default number: `fridgeDays` (whole days, 1 to 30) and `outHours` (hours out of the fridge, 0.25 to 24). `updateIngredient` with null clears one. A batch of such a product copies the flag and both limits when it is made, plus `place` ('fridge' or 'line'), `madeOn` (the calendar date, day made = day 1), `lineMs` (finished time out of the fridge) and, while out, `lineSince`.

`coldTakeOut` and `coldReturn` (undoable, logged as `batch_out` and `batch_back` safety events) move it. The out clock starts at take-out, pauses on return and adds up over every stay; the move time never goes backwards if the clock is set back. The batch is thrown out (`fridgeDate` or `outTime`) when midnight after the last fridge day passes or the total out time passes the typed hours; with a limit left blank the app only tracks time and says "no limit set". While out, no temperature check is due; in the fridge the usual cold checks apply. A fridge batch has no quality stage and is not held to the 12 hour cabinet cap. `coldInfo(batch, now)` gives screens the facts; `SB.deadlines.coldLine` the plain words; the feed has `coldOut` and `coldDate` rows. Invariant I20 covers the fields. No rule is stated anywhere: the words say "your limit". Cooling batches also keep `stage1F` and `finalF`, the readings that reached each mark.

### 8.7 Start over and the hub outbox; extra safety entries (round 15)

When `startOver` succeeds it removes the saved outbox entries that came before the erase: their ids are marked as dropped (so another tab's saved copy cannot bring them back), only the `resetLive` entry stays queued so a hub is told, and with no transport the saved outbox key is removed. A refused or failed Start over leaves the queue alone. A cold move that ends its batch still answers `ok` (the move happened) with `info.discarded: true`, `info.discardReason` and plain `info.words`; one the catch-up already ended is refused as `batchNotServable`.

New safety-log entries, all in `SAFETY_EVENT`, so the safety log, retention and `correctSafety` pick them up unchanged: `logEquipmentTemp { unit: 'cooler'|'freezer'|'display'|'other', f, label?, who? }` writes `equip_temp`; `logThermometerCheck { f, method?: 'ice'|'boiling'|'other', who? }` writes `thermometer_checked`; `sanitizeDone` takes optional `ppm`, `product`, `where`; `discardBatch` takes an optional `note` and the new reason `datemark`. Everything is absent unless given.


### 8.8 Pilot numbers and "pull again" (round 16)

The pilot report (`35-pilot.js`) no longer turns an unknown cost into zero. A discard with no cost on record counts in `discards.costUnknownN`; `discards.cost` is the sum of the known ones, or `null` when discards exist and none has a cost (a pilot with no discards reads 0). The same holds per product and per reason, and the text and CSV say "cost unknown". The week figure is `null` when the cost is. Pulls drawn only from sample or starter batches are left out, like their discards. New numbers: `sounds.warnings` (distinct warnings), `sounds.warningsAcked`, `sounds.ackRate`, `undos` and `refused` (taps the screen reported as refused). `test/pilot-scenario.test.mjs` runs a simulated three day pilot against hand-kept tallies.

`pullAgain { ing?, g? }` logs a pull with nothing to fill in: the last pull that was not undone (same product and weight), that product's last weight when only `ing` is given, or a new weight with the last product when only `g` is given. It is `pullBatch` underneath, so undo and refusals are the same; with nothing to repeat it answers `nothingToDo` with `info.why = 'noPullYet'`. `SB.engine.lastPull(state, ing?)` returns `{ ing, g, t }` or null for a button label.

### 8.17 Independent-review fixes (branch night/a5-fix1)

- **Damaged saves (#1, #2).** The saved copy is never replaced unless a set-aside copy was really written. If the browser store is too full to keep the copy, the app starts in memory only, writes nothing over the damaged text, and the boot screen offers the old data as a download (`SB.store.damagedText()`; `releaseHold()` lets the owner continue after saving it). Records the checker throws away at load (tickets, orders, batches and so on) are first parked whole under `smokebox.v1.dropped` (kept 30 days; a newer repair replaces it), and the opening note says how many orders, tickets and batches were left out.
- **Clock (#5).** In a real kitchen a forward jump of the device clock over 36 hours is not followed. Time keeps counting from the last trusted time, `status().clockSuspect` says how far ahead the device clock reads, and the board asks the owner "Use the new time / Keep the old time". A jump that goes away again changes nothing. A saved clock is never adopted at load, and stamps in a loaded or restored kitchen more than 36 hours ahead of the device clock do not move it (`status().clockWrong`). Smaller gaps (a tablet asleep overnight) are followed as before. The demo is unchanged.
- **Money bounds (#8).** At load a menu price or ticket price above 1000 is reset (listed in `repaired`), a quantity above 20 is lowered, and paid-order money above 10 000 000 makes the order be dropped (and parked, see above). `payOrder` refuses a non-finite or absurd total. `SB.engine.totalsOf(items, opts)` gives the order screen the charge's own whole-cent totals.
- **Reopen (#10).** A paid order whose service day is already closed cannot be reopened (`dayClosed`): a sale stays in the day it was made, so it can never be counted in two `day_closed` records. A correction for such a sale is made in the owner's own books.
- **Start over (#16 part).** `startOver` needs `backupSaved: { filename, chars }` from the screen, else `backupRequired`.
- **Hub file (#3).** A `state.json` that is not valid JSON, or not a kitchen, is renamed `state.json.bad-<time>` before anything is written (and `/health` shows `dataProblem`); if it cannot be renamed the hub does not start. A file written by a different version (`unsupported version N`) is left untouched and the hub does not start, so the updater's health check fails and rolls back. Saves flush to disk before the rename, and `state.json.bak` keeps the save before the last (at most every 10 minutes).
- **Stalled streams (#7).** A screen whose unsent backlog passes 4 MB (`maxClientBacklog`) is cut off; it reconnects and gets a fresh copy.
- **Importer (#12).** Runs of spaces are collapsed before the line patterns run and a line over 1000 characters is marked "too long to be a dish" without being read. 40 000 spaces took 7 s; it is now milliseconds.
- **PIN and recovery code (#13).** New hashes are `pbkdf2:100000:<salt>:<hash>` (WebCrypto, a random 16-byte salt). Old unsalted `sha256:` hashes still work and a PIN is saved again in the new form after the next right entry; a recovery code is spent when used. A 4-digit PIN remains a door latch: anyone with a backup file or the device can still try all 10 000 PINs, now at about a tenth of a second each. Backups and the hub stream still carry the hash.

**Safety-setting changes and cold time (independent-review follow-up).** `updateSettings` writes one `safety_setting_changed` event (in `SAFETY_EVENT`, so it is kept like any safety record) for each changed number under `settings.safety`: `{ key, from, to }`, where `key` is the dotted path (for example `safety.hotHoldF`, `safety.coldHoldF`, `safety.cooling.stage1H`, `safety.tempCheckEveryMin`), and `from` and `to` are the stored values (degrees F, hours or minutes; `null` when a value was absent). Other changed keys still go into one `settings_changed { keys }` entry, which is not written when only safety numbers changed. A cold batch keeps `coldOutMs`, the total time it spent above the cold limit in earlier stretches; the discard time is `outSince + (aboveColdGraceH - coldOutMs)`, so one good reading no longer resets the grace time.

**Restore keeps what it replaced.** `importAll(text)` first stores a copy of the current kitchen in the last-good slot (`smokebox.v1.lastgood`) with `reason: 'before restore'`: the full history if the browser has room, else the small rolling size. Not taken for an empty kitchen or the demo, or when the browser has no room. The result is `lastResult().info = { repaired, beforeRestore: boolean, beforeRestoreAt, beforeRestoreKeepDays: 7 }`. The 6-hour refresh leaves that copy alone for 7 days; a close-day or start-over copy replaces it. `beforeRestoreInfo()` returns `{ takenAt, expiresAt }` or null; `undoRestore()` restores it (`'ok'` or `'noCopy'`) and keeps the kitchen it replaces the same way.

**Two tabs saving at once.** With tab sync on, a timed save first takes the Web Lock `smokebox-save-lock` (when `navigator.locks` exists), so only one tab at a time reads the save id, builds the text and writes it; the stale-copy check (`rebaseIfStale`) then runs inside the lock. Page-hide and direct `flush()` saves stay immediate (a closing page cannot wait). Without Web Locks, a tab writes a tag to `smokebox.v1.writer`, reads the tag and the save id back, and if another tab got in first it rebuilds on that copy and tries again (up to 3 times, then writes anyway). This is best effort, not a guarantee.

**Invisible characters and text caps.** `SB.util.cleanText(s)` (used by the engine's `cleanText`, the config `cleanName` and the menu importer's `clean`) removes text-direction controls (U+202A to U+202E, U+2066 to U+2069) and zero-width characters (U+200B, U+200C, U+2060, U+FEFF) before squeezing white space. A zero-width joiner (U+200D) is removed unless a pictograph stands on both sides (so family, heart-on-fire and rainbow-flag emoji keep their joiners). That also drops the joiner and non-joiner some scripts (Persian, Indic) use. A ticket note strips them too but keeps its line breaks. `validateBackup` (the restore and load door) now cleans and cuts: menu name 60 and short 24, ingredient name 60 and note 140, ticket and order customer 40, ticket note 140, ticket item name 60, short 24 and at most 10 modifiers of 60, batch label 40; each change is listed in `repaired`. The actions already refused too-long text (`badCustomer`, `noteTooLong`, `outOfBounds`).

**Close the month (engine and store).** Built from `docs/audit/close-month-design.md`, with these choices. It is never an engine action (so a hub cannot be sent it): `E.closeMonth(state, opts, now)` is a pure function and the store calls it.
- `E.monthPlan(state, { before: 'YYYY-MM-DD', keepDays = 35 }, now)` decides what may go. The real boundary is the earlier of `before` and today minus `keepDays` service days. A service day may go only if it is before the boundary and has a `day_closed` event. A finished ticket goes with its day. A paid or voided order goes when its service day and the day it was paid or voided both qualify and every ticket it still has goes too. Open orders and active tickets never go, nor does anything from today, the last `keepDays` days or an unclosed day. Of the events only plain activity of those days goes: every safety event (including the new `month_closed`), every `day_closed` and everything outside those days stays. Plan fields: `before` (the real boundary), `requestedBefore`, `from`, `days`, `tickets`, `orders`, `events`, `safetyEventsKept`, `dayRecordsKept`, `openTicketsKept`, `openOrdersKept`, `uncoveredDays` (old days with records but no day_closed: they stay), `paidTotal`.
- `E.closeMonth` removes them in one step: grams used by removed tickets go to the books' `prunedUsed` (I2 holds), the undo list is cleared, `state.archivedBefore` (YYYY-MM-DD, never moves back) is set, and one `month_closed { before, from, days, tickets, orders, events, safetyEventsKept, paidTotal, backup }` safety-class event is written. Invariant I21: `archivedBefore` is a real date. `E.archivedBefore(state)` and `E.isArchivedDay(state, day)` tell a page that a day with no records is archived, not missing; `dataset()` carries `archivedBefore`. Reports: `nothingToDo` when nothing qualifies.
- Store: `closeMonthPreview({ before, keepDays? })` returns `{ ok, report, preview }` (the plan without id lists) and changes nothing. `closeMonthExport({ before, keepDays? })` returns `{ ok, files: [{ name, kind, mime, text, chars, sha256 }], manifest }`: the full backup of the current kitchen first (`kind: 'backup'`), then `orders`, `tickets` and `days` CSV files for the records that would go (written with `SB.csv.text` when loaded), then a `manifest` file with counts and the sha256 and size of each part. It remembers the backup's sha256 and size and the plan. `closeMonthPrune({ before, keepDays?, confirmBackupSaved: { filename, chars, sha256 } })` refuses with `backupRequired` unless the proof matches the last export's backup exactly, `exportStale` if the plan changed since the export (a day passed, a record changed: export again), `notInDemo`, `hubKitchen` (this tablet works through a hub), `nothingToDo`, `badPatch`. It saves, keeps a copy of the whole kitchen in the last-good slot with reason `before month close` for 7 days (`beforeRestoreInfo()` shows it with its `reason`; `undoRestore()` puts it back), removes, and saves. If the save fails the kitchen in memory goes back to exactly what it was and the answer is `storageBlocked`. Success: `{ ok: true, info: { before, from, days, tickets, orders, events, safetyEventsKept, copyKept, copyKeepDays } }`. `importAll` of the backup file brings the whole month back.
- SHA-256: `SB.util.sha256Hex(text)` (UTF-8, plain code, synchronous) is what the proof must be made with.

**Several tabs (journal).** A browser can hand a tab an older copy of what another tab just wrote, so the save id alone cannot show that nothing was missed. Each saved copy now carries `ops` (the ids of the last 1,500 actions in it) and `era` (a new value whenever the whole kitchen is replaced on purpose: restore, reset, start over, close the month). A tab keeps its own actions of the last five minutes (at most 200). When it adopts another tab's copy, with the same era, it applies again any own action the copy's journal lacks, in the original order, and saves; a copy that lists nothing the tab does not already have is older, so the tab keeps its own state. A copy from another era replaces the tab's state. Nothing is ordered by a clock. About 0.3 s after a save the tab (`reconcile()`, also public) checks that its recent actions are in the saved copy. Tests: `test/tabs-skew.test.mjs` (2 to 5 tabs, clocks up to 36 hours apart, late reads).

**Close the month: days with sales after the close.** A day also stays whole when any order, payment, void or ticket of that day came after the day's last `day_closed` (so the close record does not hold it). Such days are listed in the plan's `uncoveredDays` and also in `lateSaleDays` (the reason "sales after the last close"). A day closed twice counts from its last close. `test/close-month-late.test.mjs` reconciles totals: cleared days by their `day_closed` record, kept days by their orders.

**Hub write-ahead log (main-track server).** Every action the hub applies is first appended to `<data file>.wal` and flushed to disk, with its answer; the saved file also holds the last 2,000 answers and `walN`, the number of log lines it already contains. On start the log lines newer than the file are applied again in order, so a crash loses nothing the screens were told, and a resent action (same `opId`) is answered `duplicate: true` and not applied twice. A half-written last line is ignored. A save empties the log. Tests: `test/hub-wal.test.mjs`, `test/review-fix-restart.test.mjs`.
**Endurance run.** `node --expose-gc tools/endurance.mjs --months 6 --seed 1,2,3 --kitchen all [--quota 2000000]` drives the real engine and store with a browser-like storage that has a size limit, for a blank own kitchen, a cook-ahead kitchen and a counter-service kitchen, and checks invariants, finite numbers, saved size, safety records and backup round trips every day (about two minutes per kitchen of six months; `test/endurance.test.mjs` runs 12 days, `ENDURANCE_LONG=1` the long run).

**History fill (before anything is dropped).** `store.historyFill()` returns `{ tickets, ticketsCap, events, eventsCap, bytes (the main save plus the last-good copy, in characters), quotaBytes (5,000,000 unless `init({ quotaBytes })` says otherwise), pct (percent of the tightest of the three limits), nearFull (pct >= 70), warn (pct >= 85), persisted (true, false or null), daysLeft (days at the recent pace until a limit, null under 3 days of history), keepDays, trimmedSince }`. At 250 tickets a day the browser space is the tightest limit (about 7 days), not the ticket cap. `trimmedSince` is null or `{ days, at, droppedBefore }`: service days dropped to make room since the owner last saw the notice (counted from the oldest ticket day in each good save; Close the month, restore, reset and Start over are not counted); `dataset().droppedBefore` carries the first day still kept. `historyNotice()` gives null or `{ kind: 'full' | 'trimmed', words }` for a one-time board notice (`'full'` once at 85 percent, back after the history fell under 60; `'trimmed'` after a drop) and `historyNoticeSeen(kind)` marks it shown (keys `smokebox.v1.histtrim`, `smokebox.v1.histnotice`). At the first start of a real kitchen the store asks the browser to keep its data (`navigator.storage.persisted()`, then `persist()`), the answer is `status().persisted` and `historyFill().persisted`.
- Close the month's default keep window is now adaptive (`E.adaptiveKeepDays`): `min(35, 35 percent of the days the limits can hold at this kitchen's pace)`, never under 3; the saved copy's own bytes per day count, not memory's. `monthPlan` reports `keepDays` and `keepDaysAuto`; the export fixes the window for the prune that follows. At 250 tickets a day it is 3 days; with Close the month every 3 days the endurance run never dropped a day (peak 83 percent).
- When the saved kitchen fills more than half the browser space the rolling last-good copy shrinks to 40 tickets and 300 events (it was 40 percent of a small kitchen's save).
- opIds never repeat in one page (the counter is no longer reset when the store starts again), which the multi-tab journal relies on.

**Compact saved form (fmt 2).** `SB.util.makePacker()` turns a state into a compact tree and back, losslessly (the plain JSON text of the unpacked state equals the plain JSON text of the original, key order and all; keys whose value is undefined are left out, as JSON does). Every object becomes `[schema + 1, value...]` where a schema is the exact list of its keys, every non-empty array `[0, item...]`, and strings under 22 enum-like keys (`menuId`, `zone`, `status`, `type`, `name`, ...) become a table reference (`\u0001` + base 36 number; a real string starting with that character is doubled). The tables only grow while the page lives, so an unchanged ticket, order, event or archive chunk is remembered by identity and not worked out again.
- The store saves `{ v: 1, fmt: 2, savedAt, rev, clock, ops, era, p: { d, s, x } }` instead of `{ ..., state }` when the kitchen has 300 or more tickets or 2,500 or more events (`init({ compact: 'auto' | 'always' | 'never' })`); smaller kitchens keep the plain form. `store.decodeSaved(payload)` gives the plain `{ ..., state }` shape of either form (tests and tools use it). A plain save loads unchanged and is upgraded by the next save; a compact save that cannot be read (damaged, or a newer `fmt`) takes the usual damaged-save path: the text is kept, the last good copy comes back. **Downgrade:** an older build cannot read `fmt: 2` and would set it aside as damaged; the compact text is kept for 30 days and the last-good copy (plain) is used, so a downgrade loses the days since that copy. Exports, backups, the rolling last-good copy and hub snapshots stay in the plain readable form.
- Measured on 5,000 tickets and 40,000 events: 56 percent of the plain size (6.7 against 12.0 million characters), first save 0.4 to 0.6 times, later saves 0.9 times, start-up 1.1 to 1.2 times the plain form's time (`node tools/compact-bench.mjs 5000`). At 250 tickets a day the 5 MB browser space now holds about 15 days before the first drop (it was 7), and Close the month's adaptive window rises with it (6 days instead of 3). `node tools/history-bytes.mjs` prints what a ticket costs by part: about 2,400 characters plain, 1,340 compact; the item_fired and item_done events are 30 percent of that and were left alone because metrics, undo and the event export read them.

**Restore paths on compact saves (audit, `test/restore-audit.test.mjs`).** Fixed: the packer no longer adopts the tables of a copy it reads (another tab's copy used to renumber the tables under rows it remembered, which could damage the next save); a compact save pasted into Restore is unpacked; the 7-day copy of a big kitchen (before restore, before month close) is saved compact so it fits; `store.parkedCopy()` ( `{ at, tickets, orders }` or null) and `store.restoreParked()` read the copy set aside as damaged, compact or plain. **Downgrade:** the previous build cannot read `fmt: 2`; it reports the save as unreadable, shows its last-good copy (menu, settings, PIN, safety records and the newest 300 tickets) with the toast "Your saved board could not be read, so Smokebox restored the last good copy from <time>. Orders and history after that time are missing. A copy of the damaged data was kept in this browser.", and keeps the compact text set aside for 30 days; going back to the newer build then finds it with `parkedCopy()` and `restoreParked()` brings the full history back (a screen for that is still to be built).

**Save cost (night/a5-savecost).** Measured in Chromium with the CPU slowed 6 times (`node tools/savecost-browser.mjs 1470 1,6`, 1,470 tickets of history, 2.0 million characters saved compact).
- The check that a tab's own recent actions are in the saved copy (`reconcile()`, 0.3 s after each burst of saves) used to read, unpack and validate the whole save: 240 to 410 ms at 6x after every burst. It now reads only the action-id list that sits near the start of the saved text (`peekOps`) and opens the whole save only when one of the tab's own actions is missing: 1 to 16 ms.
- `packer.packText(state)` builds the compact text from remembered pieces and the store hands it over with `storage.setText` (storages without `setText`, such as most test storages, still get the object): a save at 1x went from 36.7 to 13.7 ms; at 6x from 148 and 179 to 102 and 134 ms (the rest is the browser writing 2 MB). In Node with a memory storage a later save at 5,000 tickets is 0.13 times the plain form's time.
- Not done: skipping `validateBackup` and the invariants check at start-up on a save the tablet wrote itself. They take about 115 ms of a 2.8 s start-up at 6x and are the only guard against a damaged but readable save; a checksum would cost as much as it saves. Start-up is dominated by the browser parsing the page script (about 1.4 s at 6x) and by the header-fit layout code in the board (`headKey`, about 240 ms).
