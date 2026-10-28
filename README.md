# LeadGen

Form → WhatsApp conversation platform for any business: a customer fills a short form, a
rule-based WhatsApp bot takes over, and the conversation ends in a qualified lead or a booking.
Owners manage everything in a dashboard.

See [docs/implementation-plan.md](docs/implementation-plan.md) for scope, architecture and milestones.

## Repo layout

| Path              | What                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `apps/api`        | Express 5 API (TypeScript), webhooks, bot engine, background jobs   |
| `apps/web`        | React + Vite dashboard (Tailwind, shadcn/ui, TanStack Query)        |
| `packages/shared` | Code shared by both: campaign schema, WhatsApp limits, placeholders |
| `docker/`         | Local Postgres init scripts                                         |

## Prerequisites

- Node 24+
- pnpm 11 (`corepack enable` picks the version from `package.json`)
- Docker (for local Postgres)

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 18 on localhost:5433 (+ leadgen_test database)
pnpm dev            # API on :3000, dashboard on :5173 (proxies /api to the API)
```

Open http://localhost:5173 — the status page shows whether the API and database are reachable.

## Scripts

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Run API + dashboard in watch mode                   |
| `pnpm build`        | Build all packages                                  |
| `pnpm test`         | Run all Vitest suites                               |
| `pnpm typecheck`    | Type-check all packages                             |
| `pnpm lint`         | ESLint                                              |
| `pnpm format`       | Prettier (write)                                    |
| `pnpm check`        | Format check + lint + typecheck + test (used in CI) |
| `pnpm db:up / down` | Start / stop local Postgres                         |

## Production image

A single Docker image builds everything and runs the API, which also serves the built dashboard:

```sh
docker build -t leadgen .
docker run -p 3000:3000 -e DATABASE_URL=postgres://… leadgen
```
