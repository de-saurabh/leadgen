# Demo runbook

How to set up, rehearse and run the investor demo. The story: _a customer fills a form, WhatsApp takes
over, and the conversation ends in a booking or a qualified lead; the owner sees it all live._

## Set up

1. Start the app (`pnpm dev`, or the deployed URL) with `TOKEN_ENCRYPTION_KEY` set.
2. Load the sample data: `pnpm demo:seed`. It is safe to run again: it removes the demo businesses and rebuilds them, and leaves everything else alone. `pnpm demo:reset` removes them without rebuilding.
3. Everyone in the demo signs in with the password in `DEMO_PASSWORD` (default in `apps/api/src/demo/seed.ts`, `DEFAULT_DEMO_PASSWORD`). Set your own before a public demo: `DEMO_PASSWORD=... pnpm demo:seed`.

| Business            | Role    | Email                                           |
| ------------------- | ------- | ----------------------------------------------- |
| City Care Clinic    | owner   | `citycare@demo.test`                            |
| City Care Clinic    | manager | `reception@demo.test`                           |
| City Care Clinic    | member  | `dr.rao@demo.test` (and `dr.shah@`, `dr.iyer@`) |
| Spice Route Kitchen | owner   | `spiceroute@demo.test`                          |
| Neon Pub & Club     | owner   | `neonpub@demo.test`                             |

The platform admin is `PLATFORM_ADMIN_EMAIL` from `.env`.

The sample data is about three weeks of leads, chats and bookings across sources, with realistic
drop-off, a few people waiting for a human, and upcoming bookings. It is reproducible: the same
every time you seed. The seeded WhatsApp numbers are fake, so nothing is sent for real until you
connect the real test number (Settings, then connect, then pick it on the campaign).

## The script (about 10 minutes)

1. **Owner view (City Care Clinic).** Home, then Analytics: the funnel (came in, replied, finished, booked), where people stop, which source (link, QR, embed) works best.
2. **Build a campaign live.** Campaigns, New. Add a question, mark one "form" and one "WhatsApp", pick the doctors it offers, publish. Show the live form and WhatsApp preview while editing, then the share link and QR.
3. **Be the customer.** Either open the public form on your phone with the Meta test number connected, or use **Try it** (the simulator) in the dashboard. Pick a doctor, a day and a time. The bot confirms.
4. **Watch it arrive.** Leads and Bookings update live, with no refresh. Open the lead to see the answers and the full chat.
5. **Talk to a human.** In the chat, type "human". The lead jumps to the top of Leads as "Needs a person". Reply from the dashboard, then hand it back to the bot.
6. **Reminders and changes.** Say "reschedule" or "cancel" in the chat. Mention that reminders go out 3 hours before by default and can be customised.
7. **Roles.** Sign in as `dr.rao@demo.test`: they see only their own bookings and no analytics or setup.
8. **Other businesses.** Spice Route (tables, party size, auto-assigned) and Neon Pub (events with a guest list). Same engine, different campaign.
9. **Platform admin.** Businesses, "view as" an owner: the banner says read-only, writes are blocked, and the audit log at the bottom of the Businesses page shows it.

## Rehearsal checklist

- [ ] `pnpm demo:seed` ran against the demo database just before the demo
- [ ] Each demo login works (owner, manager, doctor, admin)
- [ ] Analytics shows numbers on all three businesses
- [ ] **Try it** completes a booking and the booking appears under Bookings
- [ ] Live test: Meta test number connected, your phone added as a test recipient, a real form submission produces the template and then the bot
- [ ] The number was connected with its WhatsApp Business Account ID, and the access token is fresh (Meta's test tokens last about 24 hours)
- [ ] "Continue on WhatsApp" opens WhatsApp with the right number
- [ ] The API URL is public and HTTPS, and `BETTER_AUTH_URL` and the Meta webhook URL match it
- [ ] Wi-Fi fallback: the simulator works with no phone

## Known limits to mention (not hide)

- Template test mode: the opening message is Meta's generic `hello_world`; personalised text starts once the customer replies. Live mode needs approved templates.
- The Meta test number can message only people registered as test recipients (up to 5).
- No payments, one language, no template editor in the dashboard.
- Staff aren't notified yet when a customer cancels or reschedules; they see it in the lead and bookings.
