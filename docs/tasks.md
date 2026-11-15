# LeadGen — Task list

_Created 2026-11-15 from the browser audit of everything marked "built". Tick items as they are finished and verified in the browser. Add the commit hash when done._

Legend: **P1** do next · **P2** soon · **P3** later. Source: **A** = found in the browser audit, **D** = deferred earlier.

## 1. Bugs found in the audit

- [x] **P1 · A** Dialogs too narrow: bookable person, event and Share dialogs clip hours rows and buttons and scroll sideways (`DialogContent` keeps `sm:max-w-sm`; pass a wider class) (718b588)
- [x] **P1 · A** New booking campaigns keep the lead-style confirmation ("will be in touch shortly") with no date/time; switching the goal to booking should swap in a booking default (718b588)
- [x] **P1 · A** Lead page Answers shows raw option ids (`check_up`) instead of labels ("Check-up"); API returns raw `value` (718b588)
- [x] **P1 · A** New leads don't appear live: no event is published when a lead is created (form or simulator), only on messages (718b588)
- [ ] **P2 · A** Native `window.confirm` popups on Team Remove and on Delete for people and events: replace with the app's own confirm dialog
- [ ] **P2 · A** Cancelling a booking from the dashboard has no confirmation at all
- [ ] **P2 · A** Public form and thank-you page are plain white/green: restyle to match Aurora (light and dark)
- [ ] **P2 · A** Builder validation messages show raw keys (`pick_resource`, `pick_slot`): write friendly text
- [ ] **P3 · A** Home tile says "appointments" for restaurants and pubs: use "bookings"
- [ ] **P3 · A** "Leads per day" with one or two days draws a giant bar: cap bar width
- [ ] **P3 · A** Leads table is clipped on phones: allow horizontal scroll or stack rows
- [ ] **P3 · A** "not for your role" text clipped in the member's Home capability grid
- [ ] **P3 · A** A future booking can be marked Done: only allow once it has started
- [ ] **P3 · A** Builder WhatsApp preview shows "Your Business" and the wrong confirmation for booking campaigns
- [ ] **P3 · A** Select dropdown popups look translucent and overlap the controls below

## 2. Admin and platform

- [ ] **P1 · A** "View as" in the UI: admin API to list a business's users, a button on the Businesses page, redirect into the business, Exit via the banner
- [ ] **P2 · A** "Enable edits" toggle for impersonation (plan: read-only by default), still audited
- [ ] **P2 · A** Admin can connect a WhatsApp number for a business (plan item; today only owners can)
- [ ] **P2 · A** A way to delete or disable a business (test data can't be removed from the UI)
- [ ] **P1 · A** Exclude simulator leads from analytics by default (plan item)

## 3. Missing owner features

- [ ] **P1 · A** Business settings page: name, timezone, role labels (`PATCH /api/business` already exists)
- [ ] **P1 · A** Change password for signed-in users, plus a reset path for owners and staff
- [ ] **P2 · A** Home: today's bookings and needs-a-person count (plan's Overview)
- [ ] **P2 · A/D** Reminder-template editor in the campaign builder
- [ ] **P2 · A** Show delivery and read status on messages in the chat
- [ ] **P2 · A** Leads: filter by campaign and source in the UI
- [ ] **P3 · A** Lead detail: timeline of events (submitted, replied, answered, booked)
- [ ] **P2 · D** Notify staff when a customer cancels or reschedules
- [ ] **P3 · D** Skippable optional WhatsApp questions
- [ ] **P3 · A** Pagination for leads (cap 300) and bookings (cap 500)

## 4. Robustness and security

- [ ] **P2 · D** Durable inbound webhook processing (a crash between ack and processing loses the message)
- [ ] **P2 · D** Rate limit the public form; check login rate limiting
- [ ] **P2 · A** Security headers (helmet) and an explicit CORS setup
- [ ] **P3 · A** Shared event bus for multi-instance deploys (current bus is in-process)

## 5. Environment and housekeeping

- [ ] **P1 · A** Windows reserves port 3000 right now: make the dev port configurable without editing `.env` (or change the default)
- [ ] **P2 · A** Re-seed demo data before any demo (seed is anchored to 6 Nov, events are ageing); consider seeding relative to "today" on every run
- [ ] **P2 · A** Remove the "Audit Test Co" test business and its users
- [ ] **P2** Meta test token expires daily: re-enter in Settings (account ID 29339031162387273); redo the tunnel on the new API port
- [ ] **P2** Clinic demo campaign still points at the real Meta number: `pnpm demo:seed` resets it
- [ ] **P2** Push `master`/`main` so GitHub has a default branch (only `m0-foundation` is pushed)
- [ ] **P2** Confirm CI (`ci.yml`) runs green on GitHub

## 6. Verification still owed

- [ ] **P1 · A** Reschedule, cancel and human handoff over real WhatsApp
- [ ] **P2 · A** A real reminder being sent at the offset
- [ ] **P2 · A** Decline path on an approval booking
- [ ] **P2 · A** QR PNG download and the embed snippet on a real page
- [ ] **P2 · A** Light mode on Settings, Team, Bookable dialogs, Simulator and Login
- [ ] **P3 · A** Browser-level (end-to-end) tests for the main flows; the web app only has logic unit tests

## 7. Launch

- [ ] **P2 · D** Choose a cloud host and rehearse the demo end to end (`docs/demo-runbook.md`)
- [ ] **P3** Switch to live template mode: create and approve the opening and reminder templates in Meta
