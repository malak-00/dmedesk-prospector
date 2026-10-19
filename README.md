# DME Desk Prospector

AI-powered lead intelligence and search platform for DME Desk.

The live application is hosted on **GitHub Pages** (`docs/`), powered by a **Cloudflare Worker** API (`worker/`), and backed by **Supabase PostgreSQL** (`sql/`). It indexes and queries NPPES provider records, applies DME taxonomy classifications, deduplicates and verifies provider identities, and provides claimed-lead management workflows, team notes, reminders, and CRM sync.

---

## Architecture & Implementation Status

Only one implementation in this repository is active:

| Component | Path | Technology | Status |
|---|---|---|---|
| **Frontend** | [`docs/`](./docs) | Vanilla HTML / JS / CSS (GitHub Pages) | **Live Frontend** |
| **Backend API** | [`worker/`](./worker) | Cloudflare Workers + Hono | **Live API** |
| **Database** | [`sql/`](./sql) | Supabase (PostgreSQL) | **Live Database** |
| **Data Ingestion** | [`scripts/`](./scripts) | Python 3.11+ CLI (NPPES ingest & refresh) | **Active Pipeline** |
| **Documentation** | [`documentation/`](./documentation) | Markdown documentation tree | **Canonical Docs** |
| *Apps Script* | [`appscript/`](./appscript) | Google Apps Script Web App | *Archived / Predecessor* |
| *Node Backend* | [`backend/`](./backend) | Node.js + Express | *Archived / Historical* |

> [!IMPORTANT]
> `appscript/` and `backend/` are preserved for historical reference and should not be used for new feature development or deployment.
>
> `docs/` is the deployed production web client; all project documentation must be written under [`documentation/`](./documentation).

---

## Repository Structure

```
dmedesk-prospector/
├── docs/                 # Live frontend deployed via GitHub Pages (index.html, app.js, config.js)
├── worker/               # Live API server running on Cloudflare Workers (Hono framework)
│   ├── src/index.js      # API entrypoint, routes, and auth middleware
│   ├── src/services/     # NPPES, CMS, Gemini brief, and company search orchestration
│   ├── src/repos/        # Supabase repositories (leads, users, taxonomies, progress)
│   └── scripts/          # Worker CLI scripts (e.g., seed-user.mjs)
├── sql/                  # Supabase schema definitions and versioned migrations (000–044+)
├── scripts/              # Data ingestion and operations tooling
│   ├── nppes_ingest/     # Python CLI for staging and applying monthly NPPES data
│   └── monthly_refresh.ps1 # Operational script for monthly data refresh cycles
├── documentation/        # Canonical repository documentation
│   ├── architecture/     # Live architecture specifications and system diagrams
│   ├── operations/       # Operational worklog (WORKLOG.md) and deployment records
│   ├── plans/            # Master roadmap (MASTER_PLAN.md) and technical feature specs
│   └── reference/        # Background references and migration records
└── [legacy]              # appscript/ and backend/ (historical reference only)
```

---

## Local Development Setup

### 1. Cloudflare Worker API (`worker/`)

The API requires **Node.js 18+** and Cloudflare's **Wrangler CLI**.

```bash
cd worker
npm install

# Configure local development environment variables
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars` with your Supabase credentials and JWT secret:
- `SUPABASE_URL`: Your Supabase project URL (`https://<project-ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role secret key (bypasses RLS on trusted server)
- `JWT_SECRET`: Random secure string for signing user session tokens
- `GEMINI_API_KEY` (optional): For AI lead brief generation

Start the Worker locally:

```bash
npm run dev
```

The API will run locally at `http://localhost:8787`.

To create or update a user account locally:
```bash
npm run seed-user
```

### 2. Frontend Dashboard (`docs/`)

The frontend is static and requires no compilation.

1. **Local API Connection**: If testing against your local worker, adjust `API_BASE_URL` in [`docs/config.js`](./docs/config.js):
   ```javascript
   const API_BASE_URL = "http://localhost:8787";
   ```
   *(Ensure production deployments point back to the live Cloudflare Worker URL).*

2. **Serve the Directory**: Use any static web server:
   ```bash
   npx serve docs
   # or Python: python -m http.server --directory docs 8000
   ```
   Open `http://localhost:3000` (or `http://localhost:8000`) in your browser.

---

## NPPES Data Ingestion & Refresh (`scripts/`)

The platform's provider directory is powered by official CMS NPPES data stored in Supabase. Monthly and weekly data releases are ingested via the zero-dependency Python CLI in [`scripts/nppes_ingest/`](./scripts/nppes_ingest/):

1. **Stage**: Streams and validates the CMS release into `nppes_refresh_staging` with cryptographic verification.
2. **Apply**: Copies staged records into `npi_records` via [`sql/007_nppes_refresh_lifecycle.sql`](./sql/007_nppes_refresh_lifecycle.sql), logging non-noop field changes to `provider_field_history`.

For complete ingestion commands and options, refer to [`scripts/README.md`](./scripts/README.md) and [`NPPES_INGEST_HANDOFF.md`](./NPPES_INGEST_HANDOFF.md).

---

## Database Migrations (`sql/`)

Database schema migrations live in [`sql/`](./sql/) in numbered sequential order (`000_*.sql` through `044_*.sql`).

- Migrations are applied in order to Supabase.
- Always check [`documentation/operations/WORKLOG.md`](./documentation/operations/WORKLOG.md) before making assumptions about deployed schema state.
- For detailed SQL architecture and table descriptions, see [`sql/README.md`](./sql/README.md).

---

## Documentation & Collaboration Guidelines

Before starting major features or reviewing architecture, consult the documentation tree:

- **[Documentation Index](./documentation/README.md)**: Entry point for engineering and AI agents.
- **[System Architecture](./documentation/architecture/ARCHITECTURE.md)**: Detailed request flow, auth model, and service layer overview.
- **[Master Plan](./documentation/plans/MASTER_PLAN.md)**: Roadmap, feature specs, and current project phases.
- **[Operations Worklog](./documentation/operations/WORKLOG.md)**: Chronological log of deployed schema updates, production milestones, and migrations.
