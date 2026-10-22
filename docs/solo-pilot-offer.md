# Smokebox Solo: pilot offer and readiness

**Status: proposed, not a commercial launch offer.** This document separates what the current app does from what still needs owner, pilot-site, device, and professional review. A passing software test is not evidence of market demand or food-safety compliance.

## Proposed first customer

Start with an owner-operated, single-location barbecue restaurant that cooks meat ahead, holds it in a cabinet, and slices or portions it for orders. The pilot assumes one person can configure the menu and safety settings, and one tablet can stay visible near the pit or cutting station.

This is a hypothesis, not validated customer research. Do not extend the offer to general restaurants, multi-location operators, or kitchens that require live POS/order-channel integration until the pilot says the core problem and workflow are worth pursuing.

## What Solo includes

- One self-contained HTML app on one device; the core app works offline.
- Ticket entry, kitchen station views, a hold cabinet, 86 board, recorded payments, and a local back office.
- Local browser storage, user-managed backup and restore, and CSV exports.
- A proposed observational pilot beside the restaurant's existing ordering and safety procedures.

Solo does **not** process card payments, connect to a POS or delivery service, or synchronize separate devices. Payments are recorded in Smokebox and still need to be handled through the restaurant's existing payment process. Browser tabs on one device may share state; separate devices do not.

## Pilot-only operating boundaries

- Run beside the restaurant's existing system. Do not make Smokebox the only order record or safety control during the first service.
- The board can warn only while its page is in front and the device screen is awake. A locked screen stops its JavaScript timers. Audio, speech, wake lock, hidden-page behavior, and alternate browsers have not been verified on a real pilot device.
- Follow local health-code requirements and the restaurant's established procedures. Smokebox is a helper, not a food-safety authority. If a warning is missing or conflicts with procedure, follow procedure and record the discrepancy.
- Automated browser checks have used Chromium and Playwright. There is no supported-device/browser matrix yet. Check the actual tablet, operating system, browser, speaker, network conditions, and screen placement before service.

## Data, backup, and device replacement

Live state and settings are saved in the browser on the device. The app has no service that syncs separate devices. A backup can include orders, ticket/customer details, settings, and the PIN lock; treat the file as sensitive, store it securely, and limit access. CSV exports may also contain operational or sales information.

Before service, download a backup and confirm where it is stored. After service, download the Pilot report and another backup before resetting live data. To move to a replacement device, open Smokebox there and import the backup through the Data page; verify the restored menu, settings, PIN, and data before relying on it. Keep the original device and backup until that check is complete.

Browser storage can be cleared, blocked, or evicted. A backup is the recovery path, not a guarantee that browser storage will persist. The Data page reports when saving is blocked; do not run a pilot until saving works and a backup has been tested.

## Setup and handoff

Before each pilot, the owner and site contact must:

1. Identify the target tablet and browser; confirm the app can save and restore data.
2. Set the proposed monthly price in writing before asking whether the owner would pay.
3. Enter the real menu, costs, yields, portion sizes, service hours, hold limits, and warning start time. Confirm every starter estimate with the restaurant.
4. Check safety settings with the local health department or the restaurant's qualified safety lead.
5. Install/open the single-file app, allow warning audio with a user gesture, test the actual speaker from the pit, and test the screen-awake setup.
6. Place the device where the responsible cook can see it and log pulls without leaving the work area.
7. Turn off demo traffic and the accelerated clock, then take and verify a clean backup.
8. Run the tablet checks and observer-only lunch-rush protocol in `pilot-protocol.md`; record failures rather than coaching users through them.

The first pilot is assisted setup, not self-service onboarding. The owner must decide who responds to pilot questions, how quickly, and what happens if the app or device fails during service.

## Commercial decisions still required

| Decision | Current status |
|---|---|
| Pilot monthly price and billing method | Not set. The pilot protocol and observer sheet intentionally have a blank; the owner must choose a real price before the visit. |
| Pilot restaurant and named site contact | Not selected. |
| Official device/browser support | Not established; real Safari/iPad and Android tablet checks remain outstanding. |
| Customer support channel, hours, response target, and escalation | Not defined. |
| Privacy notice, retention/deletion policy, and handling of backup files | Not reviewed or published. Do not claim regulatory compliance. |
| Software terms, liability allocation, and insurance | Require appropriate professional review, especially because food-safety guidance is present. |
| Update delivery, version identification, rollback, and replacement-device service | Not defined as a customer process. The app can be built as a single file, but that is not a managed update service. |

Do not call the product commercially supported or quote settled terms until these decisions are made and documented.

## Go/no-go evidence

Use the four stop conditions and measures in `pilot-protocol.md`: owner-reported discard cost at least one month's fixed price, at least 50% pull logging against the observer's cut count, warnings heard from the pit, and stated willingness to pay something. Also record false or missing warnings, cook actions, setup failures, and whether the software disrupted service.

One observed service can disprove the current hypothesis; it cannot establish broad-market demand, safety, or reliable performance across devices. If a gate fails, pause feature work and rethink the customer or value proposition. If all pass, fix issues observed in service and repeat validation before considering connected mode or POS integration.
