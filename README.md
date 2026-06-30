# CompBandEquityAuditor

A pay-equity governance platform for total-rewards teams. CompBandEquityAuditor ingests a company's headcount and compensation data, lets the team design and version compensation bands, computes every employee's compa-ratio and range penetration, runs deterministic cohort pay-gap analysis with explainable factor decomposition, simulates the exact remediation budget needed to close gaps, guards new-hire offers against band compression, plans merit cycles against a fixed budget, and produces a timestamped, board-ready evidence pack for pay-transparency filings.

Everything is deterministic math over uploaded data, with no black-box ML. The numbers are fully reproducible and defensible in front of a board or a regulator. A built-in sample seeder produces a synthetic org with realistic bands and deliberately planted outliers so the entire pipeline is demoable on first sign-in.

See [docs/idea.md](docs/idea.md) for the full feature specification.

## Features

- Employee and compensation data intake with CSV/JSON upload, column mapping, validation, currency normalization, de-duplication, and versioned dataset snapshots.
- Version-controlled comp-band designer keyed by level, role-family, and geo, with overlap linting, geo differentials, effective dating, and diffing.
- Compa-ratio and range-penetration engine with anomaly flagging, quartile classification, distribution stats, and reproducible engine runs.
- Deterministic cohort pay-gap analysis with raw and adjusted gaps, explainable factor decomposition, cohort builder, and drill-down.
- Remediation cost simulator with per-person adjustments, what-if scenarios, constraints, phasing, scenario comparison, and line-item export.
- Board-ready, timestamped evidence packs for pay-transparency filings.

## Stack

- **Backend:** Hono on Node (TypeScript, ESM), Drizzle ORM over Neon Postgres.
- **Frontend:** Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, App Router.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js proxy route resolves the session server-side and forwards an `X-User-Id` header to the backend.
- **Package manager:** pnpm (Node), used for both backend and web.

## Local Development

Prerequisites: Node 22.x, pnpm, and a Postgres database (Neon recommended). Provision the database schema out-of-band before first boot, the app seeds sample data but does not create its own tables.

### Backend

```bash
cd backend
pnpm install
pnpm dev
```

The backend serves the API at `http://localhost:3001` with a health check at `/health` and all endpoints under `/api/v1`.

### Web

```bash
cd web
pnpm install
pnpm dev
```

The frontend runs at `http://localhost:3000`.

### Docker Compose

To bring backend and web up together:

```bash
docker compose up --build
```

## Environment Variables

### Backend (`backend/.env`)

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
```

### Web (`web/.env.local`)

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`NEXT_PUBLIC_API_URL` is the only `NEXT_PUBLIC_*` variable and is baked into the bundle at build time. The two `NEON_AUTH_*` variables are server-only.

## Pricing

All features are free for signed-in users. Sign in to access the full platform.
