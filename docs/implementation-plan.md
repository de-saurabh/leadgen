# LeadGen — Implementation Plan (Investor-Demo POC)

_Last updated: 2026-10-28_

## 1. What we're building

A generic, multi-tenant platform for **any business**: schools, clubs, restaurants, clinics, salons and so on. The flow:

1. A customer fills in a short **form** (via link, QR code or embed).
2. A rule-based **WhatsApp bot** on the business's own number takes over. It uses the form answers as context.
3. The conversation ends in either a **qualified lead** or a **confirmed booking**.

Business owners manage everything in a **dashboard**. No LLM is used.

**POC goal:** an investor demo.

- Three pre-built sample businesses: a **clinic**, a **restaurant** and a **pub/club** (events).
- A few weeks of pre-filled sample data.
- One campaign **built live** during the pitch.

### Scope

| In the POC                                                                      | Later                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Campaign = a single question list. Each question is marked _form_ or _WhatsApp_ | Availability-aware slot picker inside the form                     |
| Personalization + skipping questions already answered                           | Branching on form answers                                          |
| Bookings on resources (people, tables, rooms, courts) and on one-off events     | Payment links                                                      |
| Capacity per slot; party size counting (toggle)                                 | Multiple WhatsApp numbers per business                             |
| Instant confirm, or approval per campaign                                       | Self-serve Meta Embedded Signup                                    |
| Reminders (default 3h before, configurable), cancel/reschedule                  | Managing templates from the dashboard                              |
| Shared inbox, human handoff and hand-back to the bot                            | Ad sources (Meta lead ads)                                         |
| Funnel + per-campaign + per-source analytics                                    | Full-featured simulator                                            |
| Roles: platform admin (impersonation), owner, manager, member                   | Multi-language within one campaign (use one campaign per language) |
| Manual WhatsApp number connection; templates created in Meta                    |                                                                    |
| Very basic WhatsApp simulator                                                   |                                                                    |

## 2. Tech stack

| Concern      | Choice                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Repo         | pnpm workspaces + Turborepo                                                                           |
| API          | Node 24, TypeScript, Express 5                                                                        |
| Web          | React + Vite, React Router, TanStack Query, Tailwind + shadcn/ui, Recharts (via shadcn charts)        |
| Shared       | `packages/shared`: Zod campaign schema, WhatsApp limits, placeholder rendering, types                 |
| DB           | PostgreSQL + Drizzle ORM (drizzle-kit migrations), JSONB for question lists and answers               |
| Jobs         | pg-boss (Postgres-backed; delayed jobs, retries)                                                      |
| Auth         | Better Auth: organization plugin (businesses, members, roles) and admin plugin (impersonation)        |
| Realtime     | SSE behind an event-bus abstraction (swappable for WebSockets later)                                  |
| Tests        | Vitest (unit + integration against a Docker Postgres)                                                 |
| Environments | Local: Docker Postgres + ngrok. Demo: a cloud host (TBD), kept host-neutral via Dockerfile + env vars |

## 3. Repo layout

```
apps/
  api/src/
    index.ts             # bootstrap: express, auth, routes, pg-boss, SSE
    env.ts               # zod-validated env
    db/                  # drizzle schema, client, migrations, seeds (demo)
    auth/                # better-auth config, role/permission helpers, impersonation guards
    routes/              # public (forms, webhook) + dashboard API (/api/*)
    services/
      engine/            # bot engine (channel-agnostic)
      booking/           # availability, slot locking, booking lifecycle
      campaigns/         # draft/publish/versioning
      whatsapp/          # Graph API client, template sends, number connection
      analytics/
      crypto.ts          # AES-256-GCM token encryption
    channels/            # Channel interface + whatsapp + simulator implementations
    jobs/                # pg-boss workers (inbound, send, reminders, stale-leads, approvals)
    events/              # event bus + SSE transport
  web/src/
    routes/              # dashboard pages
    features/            # builder, inbox, bookings, resources, analytics, admin, simulator
    lib/                 # api client, useLiveEvents(), auth client
    components/ui/       # shadcn
packages/
  shared/src/
    campaign/            # zod schema, question types, validation, render-mode resolution
    whatsapp/limits.ts   # all Meta limits in one place
    placeholders.ts      # {{name}}, {{answers.x}}, {{booking.*}}, {{business}}
    types.ts
docker-compose.yml       # postgres
docs/
```

## 4. Core domain model

### Campaign question list (`packages/shared/campaign`)

- Each question has an `id`, `key` (where the answer is saved), `label/prompt`, `type`, `channel: "form" | "whatsapp"`, `required`, and `options?`.
- Question types:

| Type                                                 | Form            | WhatsApp                                              |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------- |
| `short_text`, `long_text`, `email`, `number`, `date` | ✅              | ✅ (free-text reply, validated)                       |
| `single_choice`                                      | ✅ select/radio | ✅ buttons ≤3, list 4–10; >10 is invalid for WhatsApp |
| `yes_no`                                             | ✅              | ✅ 2 buttons                                          |
| `multi_choice`                                       | ✅              | ❌ form only                                          |
| `party_size`                                         | ✅              | ✅ (list 1–10, or number)                             |
| `pick_resource`, `pick_slot`, `pick_event`           | ❌ (later)      | ✅ dynamic, WhatsApp only                             |

- `name`, `phone` and `consent` are fixed form questions and always present.
- **Skip rule:** the bot asks WhatsApp questions in order and skips any whose `key` already has an answer.
- **Placeholders** in prompts, the confirmation and template params: `{{name}}`, `{{answers.<key>}}`, `{{booking.date}}`, `{{booking.time}}`, `{{booking.resource}}`, `{{business}}`.
- **Campaign settings:**
  - `goal: lead | booking`
  - opening template (name, language, param mapping)
  - reminder template + `reminderOffsets` (default `[180]` minutes)
  - `resourceSelection: customer_picks | auto_assign`
  - `countPartySize: boolean`
  - `requiresApproval: boolean`
  - human-handoff label + ack text + keywords
  - nudge text
  - confirmation text
- **Validation** (shared, used by the builder UI and by the API at publish time) enforces the WhatsApp limits:
  - reply buttons ≤3, title ≤20
  - list rows ≤10, row title ≤24, description ≤72, button ≤20
  - body ≤1024
  - templates selected for every message that may go outside the 24h window

### Tables (Drizzle)

- **Better Auth:** `user`, `session`, `account`, `organization` (= business), `member` (role), `invitation`.
- `business_settings`: `organization_id`, timezone, role label overrides, branding.
- `whatsapp_numbers`: business, `phone_number_id` (unique), `waba_id`, display number, `access_token_enc`, status.
- `campaigns`: business, slug (unique), name, `draft` JSONB, `published_version_id`, status.
- `campaign_versions`: campaign, version number, frozen `config` JSONB, `published_at`, `published_by`.
- `resources`: business, name, kind (person/table/room/court/other), `member_user_id?`, capacity, slot length (minutes), active.
- `resource_hours`: resource, weekday, start, end. Multiple rows allowed per day.
- `resource_time_off`: resource, start, end, reason.
- `events`: business, name, description, starts_at, ends_at, capacity, active.
- `campaign_resources` and `campaign_events`: what a campaign offers.
- `leads`: business, campaign, `campaign_version_id` (pinned), name, phone (normalized E.164 digits), source (`link|qr|embed|…` + utm), `answers` JSONB, `current_question_id`, status (`new|in_conversation|completed|needs_human|dropped`), `bot_paused`, `last_inbound_at` (24h window), timestamps.
- `bookings`: lead, resource _or_ event, starts_at, ends_at, party_size, status (`pending|confirmed|cancelled|rejected|no_show|completed`), `rescheduled_from_id`.
- `messages`: business, lead (nullable), `whatsapp_number_id`, `wa_message_id` (unique, used for dedupe), direction, type, body JSONB, delivery status, `sent_by_user_id` (human replies), channel (`whatsapp|simulator`).
- `lead_events`: lead, campaign, type (`submitted|first_reply|answered|completed|booked|handoff|dropped`), question_id, at. Drives the funnel and drop-off views.
- `audit_log`: actor_user_id, impersonated_user_id, business, action, entity, diff, at.

Times are stored in UTC and displayed in the business's timezone.

## 5. Key flows

### 5.1 Form → lead

1. `GET /f/:campaignSlug?src=qr|link|embed` renders the published version's form questions. It's server-rendered, light, and embeddable via `<iframe>` or a small `embed.js`.
2. `POST` validates using the shared schema and normalizes the phone (default country code from business settings). It then:
   - marks older active leads (same phone + campaign) as `dropped`
   - inserts the lead pinned to the current version
   - writes a `submitted` event
   - enqueues a `send-template` job.
3. The thank-you page shows "Check WhatsApp". It includes a `wa.me` link as a fallback.

### 5.2 Webhook → bot

1. `GET /webhook` handles verification.
2. `POST /webhook`:
   1. Verify `X-Hub-Signature-256` with `META_APP_SECRET`, using the raw body.
   2. Respond 200 immediately.
   3. For each `messages` item, `INSERT … ON CONFLICT DO NOTHING` on `wa_message_id`. Only new rows are enqueued as an `inbound` job.
   4. `statuses` items only update the delivery status of outbound messages.
3. The `inbound` worker:
   1. Routes `metadata.phone_number_id` → business.
   2. Matches the normalized `from` to that business's most recent active lead.
   3. Takes `pg_advisory_xact_lock(lead_id)` so messages from the same lead are processed one at a time, even across instances.
   4. Updates `last_inbound_at`.
   5. If `bot_paused`, it only stores the message and emits `message.received` for the inbox.
   6. Otherwise it calls the engine.

### 5.3 Engine (`services/engine`, channel-agnostic)

- **Input:** lead, pinned version config, and a normalized message (`reply{id,title}` / `button{payload}` / `text` / `other`).
- **Steps:**
  1. A handoff keyword or the handoff option → `needs_human`, `bot_paused`, ack, and a `handoff` event.
  2. If `new`, set `in_conversation` and ask the first unanswered WhatsApp question.
  3. Otherwise validate the reply against the current question:
     - Option ids are encoded as `<questionId>:<optionId>`, so taps on stale messages are detected.
     - Invalid or stale input → resend the question with the nudge.
  4. Save the answer and log an `answered` event. Move to the next unanswered question. When the list is done, finish according to the goal:
     - **lead:** completed + confirmation.
     - **booking:** create the booking (see 5.4) → confirmation (or "pending approval").
- **Output:** a list of outbound messages sent through a `Channel` interface (`whatsapp` or `simulator`).

### 5.4 Booking

- **Availability service:**
  - Slot generation: resource hours − time off, sliced by slot length.
  - Used capacity: the sum of `party_size` (or a count, when `countPartySize=false`) over `pending + confirmed` bookings.
  - Results are returned in the business timezone.
  - Auto-assign picks the first free resource among the campaign's resources.
- **Slot-picking sequence** in WhatsApp:
  1. (`pick_resource`, or "Any available") → day (next days with free slots, ≤10).
  2. → part of day (Morning / Afternoon / Evening, only if the day has more than 10 free slots).
  3. → time (≤10 rows plus a "Show later times" row).
- **Events:** `pick_event` lists upcoming events with remaining capacity ≥ party size. A single-event campaign skips the choice.
- **No overbooking:**
  1. Open a transaction and take `pg_advisory_xact_lock(hash(resource_id|event_id, starts_at))`.
  2. Re-check capacity, then insert.
  3. If the slot was taken in the meantime → "Sorry, that slot just filled up" and the slot list is re-offered.
- **Approval mode:** the booking is created as `pending` and the dashboard notifies a manager. Approve or reject → a `notify-approval` job messages the customer.
- **Cancel / reschedule:**
  - Quick-reply buttons appear on the confirmation and on reminders.
  - Reschedule re-enters the slot sequence and links the new booking via `rescheduled_from_id`.
  - Cancelling frees capacity.

### 5.5 Reminders and the 24h window

- On booking confirm, schedule one pg-boss job per `reminderOffsets` entry (`startAfter = starts_at − offset`).
- Each job checks the booking is still confirmed and unchanged before sending, so cancelled or rescheduled bookings get no stale reminders.
- **Template vs free-form:**
  - Within 24h of `last_inbound_at`: free-form interactive messages are allowed.
  - Outside that window: only the campaign's **reminder template** (created in Meta, with quick-reply buttons Confirm / Reschedule / Cancel).
  - The same rule gates the shared-inbox composer.
- A `stale-leads` cron job marks leads as `dropped` after 24h of inactivity in `new`/`in_conversation`.

### 5.5a Template test mode (POC default)

- `WHATSAPP_TEMPLATE_MODE=test|live`, defaulting to `test`.
- **In test mode:**
  - Every template send uses Meta's pre-approved `hello_world` (`en_US`, no params), whatever the campaign has configured. No template approval is needed.
  - **Kick-off:** the thank-you page shows a big "Continue on WhatsApp" button: a `wa.me/<business number>?text=Hi` link with a lead reference. When the customer taps it, their message opens the 24h window and the bot starts right away with the full personalized flow.
  - **Reminders** are sent as free-form interactive messages when the 24h window is open, which is always the case for bookings made during the demo. When the window has closed, the system falls back to `hello_world` and logs a warning.
- **Live mode:** the configured opening and reminder templates (with params and quick-reply buttons) are used, as described in 5.5.
- The builder still lets owners pick a template name and map params. In test mode it shows a "Test mode: hello_world will be sent" note.

### 5.6 Shared inbox and handoff

- A conversation list (needs-human first), the thread view, and the lead's answers and booking side by side.
- Owner/manager replies go through the API and are logged with `sent_by_user_id`.
- When the 24h window has closed, the composer only allows a template.
- **"Hand back to bot"** clears `bot_paused`, sets the status to `in_conversation`, and re-asks the current question.
- Live via SSE: `message.received`, `lead.updated`, `booking.created/updated`.

### 5.7 Roles and permissions

- Roles: `platform_admin` (Better Auth admin role), then the organization roles `owner`, `manager` and `member`. Display labels can be renamed per business.

|                                         | Owner | Manager | Member      |
| --------------------------------------- | ----- | ------- | ----------- |
| Campaigns, resources, settings, numbers | ✏️    | 👁       | —           |
| All leads, bookings, inbox              | ✏️    | ✏️      | —           |
| Bookings on their linked resources      | ✏️    | ✏️      | 👁/✏️ status |
| Analytics                               | ✅    | ✅      | —           |

- Every API route uses a `requireRole()` / scope helper. Member queries are always filtered by `resources.member_user_id`.
- **Impersonation** (admin plugin):
  - Banner in the UI.
  - **Read-only by default**: a server-side guard rejects writes unless "enable edits" is turned on for the session.
  - Auto-expires after 30 minutes.
  - Every start, stop and write during impersonation goes to `audit_log`.

### 5.8 Realtime

- `events/bus.ts` (an in-process EventEmitter; Postgres LISTEN/NOTIFY later) → `events/sse.ts` (`GET /api/events`, scoped per business and role).
- The web hook `useLiveEvents()` invalidates TanStack Query keys.

### 5.9 Basic simulator

- A dashboard panel: pick a published campaign, enter a fake name and phone, then chat.
- It creates a lead with `source=simulator` and uses the `simulator` channel. Outbound messages are stored and pushed over SSE, and rendered as simple bubbles and buttons.
- It runs the same engine and booking code. Simulator leads are excluded from analytics by default.

## 6. Dashboard pages

- Login / invitation accept.
- **Overview:** today's bookings, new leads, needs-human count, mini-funnel.
- **Campaigns:**
  - list
  - builder: question list (add/reorder/delete, form ↔ WhatsApp toggle, options, settings, template picker + param mapping), with a **live preview** (form tab + WhatsApp tab, sharing render logic from `packages/shared`)
  - publish (creates a version)
  - share: link, QR (PNG download), embed snippet
- **Leads:** filterable table (campaign, source, status) and a detail view with answers, timeline and messages.
- **Bookings:** day/week list (calendar-lite), approve/reject, cancel, no-show.
- **Inbox.**
- **Resources & events:** CRUD, weekly hours editor, time off.
- **Analytics:** funnel, drop-off by question, per-campaign and per-source tables and charts, date range.
- **Settings:** business profile, timezone, role labels, team members (invite, role), WhatsApp number (owner sees it masked; admin connects it).
- **Admin (platform):**
  - businesses list
  - create business + owner invite
  - connect a WhatsApp number (phone_number_id, WABA id, token → encrypted, subscribe app, test send)
  - impersonate
  - audit log
- **Simulator.**

## 7. Milestones

**Status:** M0, M1 and M2 are done, and M3 is built (live Meta test pending), M4 is built, and M5 is built (browser check pending). Notes on how M1 differs from the plan:

- **Owners are created with credentials, not invited.** There's no email sending in the POC, so the admin creates the owner account and gets a generated password to hand over (shown once). Invitations by link arrive with team management (M7).
- **Tables arrive with the milestone that needs them.** M1 migrated the auth tables and `business_settings` only; WhatsApp numbers, campaigns, resources, leads and bookings are added in M3–M5.
- **Self-service sign-up and business creation are blocked over HTTP** (a Better Auth `before` hook); only the platform admin's routes create accounts and businesses.

M2 notes:

- `name`, `phone` and `consent` are implicit, so a campaign's question list holds only the custom questions (those keys are reserved).
- Choice answers are stored as option ids and shown as labels through `displayAnswers`.
- Validation issues carry a severity. A missing reminder template is a warning, not a blocker, so test-mode demo campaigns still publish.
- Dates are read as `YYYY-MM-DD` or `DD/MM/YYYY`.

M3 notes (built and tested against a fake Meta and in dry-run mode on the dev server; the live run with Meta's test number is still to do):

- **No pg-boss yet.** The webhook acknowledges first and processes afterwards in the same process, serialised per lead by an advisory lock. The opening template is sent the same way. pg-boss arrives with M6, where reminders need scheduled jobs. The known gap: a crash between the acknowledgement and processing loses that message.
- **Channel interface.** The engine returns channel-neutral messages and `services/conversations.ts` delivers them through a `GraphClient`. The M9 simulator will plug in at that seam.
- **Numbers and campaigns have an API but no UI** until M4. Subscribing the Meta app to the number's webhooks stays a manual step in Meta.
- **Booking questions hand over to a person** only when a campaign has nothing left to offer (see M5).
- **Optional WhatsApp questions can't be skipped yet.** The bot asks every WhatsApp question.
- **Spam on the public form** is limited to a honeypot field. Rate limiting is still to do.

M4 notes:

- **Where things live.** The campaign list and builder are at `/campaigns`, and WhatsApp number connection is at `/settings`. The builder has a question editor, settings, a live form and WhatsApp preview built from the same code the bot uses, save draft, publish, and share (tagged link, QR PNG, embed snippet).
- **Share links use `BETTER_AUTH_URL`.** Set it to the public (ngrok) address before sharing with anyone else. The dialog warns while it points at localhost.
- **No reminder-template editor yet.** The booking card edits reminder times, but the reminder template can't be set from the UI until booking is built (M5/M6). The validator warns when one is missing.
- **Checked in a browser:** sign in, connect a number, create from the clinic starting point, publish, and the share dialog with its QR code. Adding, reordering and deleting questions are covered by unit tests of the editing helpers, not yet clicked through.
- **Owners connect their own number** in Settings, where the plan had the platform admin doing it. Both work, since the API only needs the settings permission.

M5 notes (tested over the fake WhatsApp for the clinic, restaurant and pub campaigns, approval mode, and a five-way race for one slot):

- **Booking happens when the customer picks.** The slot or event is booked at the moment of the tap, under an advisory lock on the resource and start time, with the availability re-checked. A customer who then abandons the chat keeps the booking until M6's stale-lead job releases it. If the slot was just taken, the bot says so and offers the times again.
- **Slot picking follows the agreed sequence**: resource (or "Any available"), then day (up to 10), then part of day only when a day has more than 10 free times, then times (9 plus "Show later times" when there are more than 10). Where a single resource or event exists, the choice is skipped.
- **Capacity.** Pending and confirmed bookings hold capacity. With `countPartySize` on, the party size counts, so two parties can share a table until it's full. The horizon is 14 days with 60 minutes' notice (constants in `services/booking.ts`).
- **Approval.** With `requiresApproval`, the booking is created pending and the customer gets a "request sent" message. Approve, decline, cancel, done and no-show are in `PATCH /api/bookings/:id`, which messages the customer for the first three. If WhatsApp refuses (for example the 24-hour window closed) the change is kept and the dashboard says the customer wasn't messaged.
- **Dashboard.** `/bookable` manages people and places (weekly hours with split shifts, time off) and events. The campaign builder has a "What customers can book" card for booking campaigns, saved on its own (offerings aren't versioned). `/bookings` lists bookings with the approve/decline actions. Times are entered and shown in the business's time zone.
- **Not done:** members only see their own bookings in the API (scoped by the linked resource), but there's no team UI to link staff to resources until M7. Rescheduling is M6.

Each milestone ends in something demoable.

| #   | Milestone                           | Contents                                                                                                                                                                                                        | Done when                                                                                                                                           |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | **Foundation**                      | pnpm + Turborepo monorepo, the three packages, docker-compose Postgres, env validation, ESLint/Prettier, Vitest, Dockerfiles, CI-lite (`pnpm typecheck test`)                                                   | `pnpm dev` runs API + web; health check against the DB                                                                                              |
| M1  | **Data + auth**                     | Drizzle schema + migrations, Better Auth (email/password, organization, admin), role helpers, admin seed script, login UI shell                                                                                 | Admin logs in, creates a business with its owner account, and the owner logs in scoped to their business                                            |
| M2  | **Shared campaign core**            | Zod schema, question types, WhatsApp-limit validation, render-mode resolution, placeholders, skip logic, with thorough unit tests                                                                               | Example configs for clinic/restaurant/pub validate; the invalid-config tests pass                                                                   |
| M3  | **WhatsApp + lead flow end-to-end** | Number connection (encrypted token, subscribe app), Graph client, public form + sources, template send job, webhook (signature, dedupe, routing), inbound worker, engine for the `lead` goal, Channel interface | Submitting the form on a phone gets a template, and the bot asks, skips and personalizes through to completion. Messages logged, duplicates ignored |
| M4  | **Builder**                         | Campaign list, question-list editor, settings, template mapping, live form + WhatsApp preview, draft/publish/versioning, share (link, QR, embed)                                                                | An owner builds and publishes a new campaign in under 5 minutes, and in-progress leads stay on the old version                                      |
| M5  | **Booking**                         | Resources/hours/time-off/events UI, availability service, slot-picking sequence, event picking, party size, locking, approval mode, confirmation                                                                | Clinic, restaurant and pub bookings work over WhatsApp. A concurrency test proves no overbooking                                                    |
| M6  | **After booking**                   | Reminder scheduling (offsets), reminder template, 24h-window logic, cancel/reschedule, stale-lead job                                                                                                           | Reminder arrives at the configured offset, and cancel/reschedule work from it                                                                       |
| M7  | **Operations dashboard**            | Leads, bookings (role-scoped), shared inbox, handoff/hand-back, SSE live updates                                                                                                                                | A WhatsApp booking appears live. "Talk to a human" is flagged, answered from the inbox and handed back. A member sees only their own bookings       |
| M8  | **Analytics + admin**               | `lead_events` aggregation, funnel/drop-off/per-campaign/per-source views, impersonation (banner, read-only guard, expiry), audit log                                                                            | Analytics look right on the seed data, and impersonation writes are blocked unless edits are enabled, then audited                                  |
| M9  | **Simulator + demo polish**         | Basic simulator, demo seed (3 businesses, resources/events, campaigns, ~4 weeks of realistic leads/bookings/messages/events), `pnpm demo:reset`, UI polish pass, demo runbook, cloud deploy                     | A full rehearsal of the demo script runs cleanly on the cloud host                                                                                  |

Rough order of effort: M2 and M5 carry the most logic, and M4 and M7 the most UI.

## 8. Demo seed (M9)

| Business                   | Resources / events                                             | Campaign(s)                                                                                                      | Shows                                       |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **City Care Clinic**       | 3 doctors (linked members), 15-min slots, capacity 1           | "Book a consultation": form (name, phone, reason) → WhatsApp (pick doctor or "Any available", day, time)         | Picking a person, reminders, member scoping |
| **Spice Route Restaurant** | 6 tables (2/4/6 seats; capacity = seats), 90-min slots         | "Reserve a table": form (name, phone, party size) → WhatsApp (day, part of day, time); auto-assign table         | Party size, auto-assign, time paging        |
| **Neon Pub & Club**        | Events: DJ Night, Bollywood Night, Diwali Night (capacity 150) | "Book an event" (pick event) + "Diwali Night" single-event campaign; approval for party > 8 via campaign setting | Events, both campaign modes, approval       |

- History: ~4 weeks of leads across sources with realistic drop-off, bookings across statuses, a few needs-human threads, and messages.
- Clearly marked as sample data (`seed=true`) so it can be reset.

## 9. Environment variables

```
DATABASE_URL
BETTER_AUTH_SECRET, BETTER_AUTH_URL
TOKEN_ENCRYPTION_KEY          # 32-byte base64, AES-256-GCM
META_APP_ID, META_APP_SECRET  # webhook signature
WEBHOOK_VERIFY_TOKEN
GRAPH_API_VERSION=v26.0
WHATSAPP_TEMPLATE_MODE=test   # test = always hello_world; live = configured templates
PUBLIC_BASE_URL               # form links, QR, webhook
WEB_ORIGIN                    # CORS / cookies
PORT
PLATFORM_ADMIN_EMAIL          # seed
```

Per-business WhatsApp credentials live in the DB (encrypted), not in env.

## 10. Testing

- **Unit (Vitest):**
  - shared schema/validation/limits/placeholders/skip logic
  - engine state transitions (table-driven)
  - availability slicing (timezones, DST-free zones + one DST zone)
  - phone normalization
  - token crypto
- **Integration (Docker Postgres):**
  - webhook dedupe + routing
  - concurrent booking of the last slot (N parallel attempts → exactly capacity succeed)
  - versioning (edit during an active conversation)
  - role scoping per API route
  - impersonation read-only guard
  - reminder job skipped after cancel
- **Manual E2E checklist** per milestone on a real phone (Meta test number) plus the simulator.

## 11. Risks and notes

- **Meta test number:** sends only to ≤5 pre-registered recipients. The demo bookings happen on your phone(s). If investors are to scan the QR themselves, a real verified business number is needed.
- **Templates:** the POC runs in **template test mode** (5.5a): only `hello_world`, no approvals needed. The opening message is therefore generic, and personalization starts once the customer taps "Continue on WhatsApp". Switching to live mode later requires creating the opening and reminder templates in Meta and getting them approved.
- **Better Auth plugin APIs** (organization roles, admin impersonation): check against the current docs at M1 and adapt the guards if needed.
- **Hosting is undecided:** stay host-neutral and decide before M9.
- **Graph API version:** v26.0 is the latest announced as of July 2026. Keep it in env.

## 12. Immediate next steps

1. Convert the repo to pnpm + Turborepo (M0). Remove the npm `package-lock.json` and the express deps added earlier at the root.
2. Create the Meta app and test number, and register your demo phone(s) as test recipients. Template test mode means nothing needs approval.
3. Start M1 and M2 in parallel (auth/schema and the shared campaign core are independent).
