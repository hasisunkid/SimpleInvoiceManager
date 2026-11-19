# SimpleInvoice Manager

Small web app for tradespeople (Handwerker) to write, manage and track invoices – mainly from a
smartphone. Runs as a **Home Assistant App** on top of the HA MariaDB app, or standalone with
Docker Compose. Requirements: [.claude/REQUIREMENTS.md](.claude/REQUIREMENTS.md).

**Status:** milestones **M0 – Skeleton** and **M1 – Auth & users** done (see [Milestones](#milestones)).

## Quick start (Docker Compose)

```bash
docker compose up --build --wait
open http://localhost:8099          # log in as admin / admin-local-dev (change it when asked)
curl http://localhost:8099/api/health
docker compose --profile tools up -d adminer   # optional DB UI on http://localhost:8080
```

Defaults are for local use only; override them in a `.env` file (see [.env.example](.env.example)).

## Development

Requirements: Node.js ≥ 24 (CI uses 26), Docker (for integration tests and the dev database).

```bash
npm install
docker compose up -d db                 # MariaDB on localhost:3306

# Terminal 1 – API on :8099 (TypeScript sources, auto-reload)
DB_HOST=127.0.0.1 DB_USER=simpleinvoice DB_PASSWORD=simpleinvoice npm run dev:backend
# Terminal 2 – UI on :5173 with /api proxied to :8099
npm run dev:frontend
```

| Command                 | What it does                                                 |
| ----------------------- | ------------------------------------------------------------ |
| `npm test`              | Unit + integration tests (starts MariaDB via Testcontainers) |
| `npm run test:coverage` | Same, with coverage gate ≥ 90 % for `packages/domain`        |
| `npm run lint`          | ESLint + Prettier check                                      |
| `npm run typecheck`     | `tsc -b` + `vue-tsc`                                         |
| `npm run build`         | Compile packages and backend, bundle frontend                |
| `npm run format`        | Prettier write                                               |

To run integration tests against an already running MariaDB instead of a container:
`TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=root npm test`.

## Configuration (AR-16)

The app is configured **only** through environment variables. In Home Assistant mode,
`ha-app/run.sh` (M7) maps the HA options and MariaDB service credentials onto them.

| Variable                  | Default         | Meaning                                                     |
| ------------------------- | --------------- | ----------------------------------------------------------- |
| `DB_HOST` / `DB_PORT`     | – / `3306`      | MariaDB server (required host)                              |
| `DB_USER` / `DB_PASSWORD` | – / empty       | Credentials; user needs `CREATE DATABASE` or an existing DB |
| `DB_NAME`                 | `simpleinvoice` | Own database, created if missing. `homeassistant` refused.  |
| `DATA_DIR`                | `./.data`       | Logo and PDFs (`/data` in the container)                    |
| `SESSION_SECRET`          | random          | ≥ 32 chars; if unset, sessions end on restart               |
| `INITIAL_ADMIN_PASSWORD`  | random          | First-start password of `admin`; random one is logged once  |
| `PORT`                    | `8099`          | HTTP port                                                   |
| `LOG_LEVEL`               | `info`          | `fatal` … `trace`, `silent`                                 |
| `SEED_DEMO`               | `false`         | Seed demo data (M3+)                                        |

## Architecture

```
apps/backend      Fastify 5 API, Knex migrations, (later) PDF renderer – serves the built SPA
apps/frontend     Vue 3 + Vite SPA, mobile-first, hash routing, relative URLs (Ingress)
packages/domain   Pure TypeScript: money (integer cents), dates, later invoice calculation
packages/i18n     de / pl / en translations for UI and PDF (German = reference shape)
docker/           Multi-stage Dockerfile (amd64 + arm64)
docs/adr/         Architecture decision records
```

- One container: backend serves `apps/frontend/dist` and the API under `/api`.
- `GET /api/health` – 200 when DB reachable and migrations applied, else 503.
- `GET /api/openapi.json` – OpenAPI 3 document generated from the route schemas.
- Migrations run automatically at startup, forward-only.
- Auth: own users (argon2id), DB sessions in an HttpOnly cookie, CSRF header, default-deny
  route guard, login throttling – see [ADR 0005](docs/adr/0005-authentication.md).
- Every error response is `{ "error": "<CODE>", "message": "…" }`; the UI translates the code.
- Logs are JSON on stdout; SIGTERM triggers a graceful shutdown.

Design decisions: [docs/adr/](docs/adr/).

## Milestones

| #   | Milestone                    | Status  |
| --- | ---------------------------- | ------- |
| M0  | Skeleton                     | ✅ done |
| M1  | Auth & users                 | ✅ done |
| M2  | Company, style, numbering    | next    |
| M3  | Customers & catalogue        |         |
| M4  | Invoice editor & calculation |         |
| M5  | PDF                          |         |
| M6  | Lifecycle & overview (+ E2E) |         |
| M7  | Home Assistant App           |         |
| M8  | Hardening                    |         |

### M0 demo note

`docker compose up --build --wait` builds the image, starts MariaDB, creates the
`simpleinvoice` database, applies migration `0001_app_user`, and serves the (not yet functional)
login page in de/pl/en on http://localhost:8099. Health check: `{"status":"ok",...}`.

### M1 demo note

On first start the app creates `admin` (password from `INITIAL_ADMIN_PASSWORD`, or a random
one printed once in the log) and forces a password change at first login. Afterwards:

- **Users** tab (admins only): create users with a start password (they must change it at first
  login), edit name / role / language, reset passwords, deactivate and reactivate. The last
  active admin cannot be demoted or deactivated.
- **Profile** tab: own UI language (de / pl / en or "same as browser") and password change;
  changing the password signs out all other devices.
- "Stay signed in" keeps the session for 30 days, otherwise 12 hours. Five wrong passwords lock
  the username for one minute.
