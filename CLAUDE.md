# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LabVenture** is a water treatment plant lab data recording system for MWA (Metropolitan Waterworks Authority). It integrates with **AquaDAT** (MWA's SCADA/telemetry platform) to record, validate, and report water quality parameters across multiple stations (RWS, CDS, CWS, FWS, TPS, DPS, QWS).

The UI is bilingual but Thai-dominant. The codebase has two distinct dashboards — **Scientist** (full access, data entry) and **Operator** (shift-based monitoring with widget layout).

---

## Development Commands

### Server (Express + Node)
```bash
cd server
npm run dev        # node --watch index.js  (auto-restart on change)
npm start          # production start
```

### Client (React + Vite)
```bash
cd client
npm run dev        # Vite dev server on localhost:5173
npm run build      # build → client/dist/
```

In development, Vite proxies API calls to the server on port 8889. In production the React build is served by Express under `/labventure/` and all API calls are prefixed with `/labventure` automatically (see `client/src/api.js`).

---

## Architecture

### Stack
- **Server**: Node.js + Express (CommonJS), `node-sqlite3-wasm` (SQLite), `exceljs`, `node-fetch`
- **Client**: React 18, Vite, Tailwind CSS, TanStack Query v5, Recharts, `@nivo/sankey`, `react-grid-layout`
- **External**: AquaDAT REST API (read sensor data) + AquaDAT GraphQL API (write remarks/records)

### Key Directories
```
server/
  index.js              — app entry; route mounting; serves client/dist in prod
  services/db.js        — SQLite init, all table DDL, runtime migrations
  services/aquadat.js   — AquaDAT REST (read) + GraphQL (write) client
  services/aquadatHistory.js — polling historical AquaDAT data into aquadat_snapshots
  services/stageMonitor.js   — polls BellBeast proxy for stage number (1 = normal)
  services/dailyReport.js    — computes daily production summary from node_records
  services/dailyValidator_*.js — per-station validation logic (RWS, TPS, FWS, CWS, CHEM)
  services/excelWriter.js    — writes node_records to the Excel template files
  services/line.js           — LINE Notify push for CAR alerts
  config/
    app_settings.json   — runtime toggles (epidemic mode, marquee text, chem costs, etc.)
    aquadat_patterns.json — param patterns for scraping AquaDAT data
    schedule_overrides.json — manual overrides for recording schedule
    scenario_*.json     — threshold sets for each water quality scenario

client/src/
  api.js                — fetch wrapper (get/post/put/patch/del); BASE prefix logic
  App.jsx               — route definitions + role-based access guard (RequireAuth)
  pages/Dashboard.jsx   — Scientist dashboard (node groups, aquadat stations, streak charts)
  pages/Record.jsx      — Scientist data entry form
  pages/OpDashboard.jsx — Operator dashboard (shift calendar, station tiles, widget grid)
  pages/OpRecord.jsx    — Operator data entry form
  pages/CARLog.jsx      — Corrective Action Report log + status workflow
  pages/ChemIntake.jsx  — Chem lab QC tabs: board · receive bottles · mix (many composites per sample, overlapping) · analysis (final per composite, changeable, tagged) · external lab · สคบ-14 (pick composites) · cases · operator offset; every step undoable with reason; parts in pages/chemlab/
  pages/Report.jsx      — Daily production report viewer
  pages/ConfigEditor.jsx — Admin config editor for app_settings.json
  config/chartConfig.js — Chart thresholds, mini-chart filter definitions
```

### Data Flow
1. **Read path**: Server fetches AquaDAT sensor data via REST → stored in `aquadat_snapshots` table → served to client via `/api/aquadat/*` and `/api/data/*`.
2. **Write path**: Scientist/Operator submits form → `node_records` table → server writes to AquaDAT GraphQL and queues Excel write → failure queues (`aquadat_queue`, `excel_queue`) retry automatically.
3. **Progress tracking**: `/api/progress` computes slot completion status from `node_records` against the recording schedule (2-hourly slots + daily). Client renders dot indicators per parameter group.
4. **CAR system**: Out-of-threshold values trigger CAR entries in `car_log` with a numeric `status_code` workflow (10=issued → 20=responded → 30=approved → 50=validated → 60=closed).

### Role System
Roles: `scientist`, `operator`, `executive_3a`, `executive_3b`, `observer`, `superadmin`. Defined in `App.jsx`:`ROLE_PAGES`. Cookie-based auth (`/api/auth/me`). Superadmin name is set via `SUPERADMIN_NAME` env var.

### Scenarios
The active threshold scenario is read from `scenarios` table. Changing the active scenario switches which `scenario_*.json` file provides alert thresholds for CAR auto-generation.

---

## Environment Variables (`.env` in `server/`)

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 8889) |
| `AQUADAT_REST_BASE` | AquaDAT REST API base URL |
| `AQUADAT_GRAPHQL_URL` | AquaDAT GraphQL endpoint |
| `AQUADAT_USER` / `AQUADAT_PASS` | AquaDAT credentials |
| `SUPERADMIN_NAME` | Thai name string of the permanent superadmin |
| `BELLBEAST_STAGE_URL` | BellBeast proxy stage endpoint |
| `LINE_NOTIFY_TOKEN` | LINE Notify token for CAR push alerts |

---

## Important Patterns

- **DB access**: always import `getDb()` from `server/services/db.js`; never create a new Database instance. Schema migrations run inline in `initDb()`.
- **Time**: server always uses Thai time (GMT+7). Use `nowTH()` from `db.js` for `created_at` / timestamp columns.
- **API client**: client uses `get/post/put/patch/del` from `src/api.js` — never raw `fetch`. These automatically prefix `/labventure` in production.
- **TanStack Query**: all data fetching on the client goes through `useQuery` / `useMutation`. Cache invalidation is intentional — check `queryClient.invalidateQueries` calls when adding write endpoints.
- **Form templates** (blank `.xlsx`/`.docx` forms the exporters fill, e.g. `*_theme.xlsx`, `MH_report_theme.xlsx`, สคบ/สบค forms) live in `server/templates/`. `server/data/` is for working data only (monthly DailyLab files, Algae2569.xlsx, pm_files).
- **Excel template**: `excelWriter.js` writes into a shared Excel file. Failures enqueue to `excel_queue` for retry, not crash.
- **Chem lab**: `/api/chem-lab/*` (`routes/chemLab.js`) proxies to Uroboros `/api/chemlab/*` at `http://localhost:8888` (Uroboros port; :443 is BellBeast). LAB_* tables live in `chemlab.db` beside `Uroboros.exe` — never in `data.db` (replaced from Drive) or `chem.db` (file-swapped, read-only; active file resolved via `media\chem.current.txt`). `services.json` `chem_lab.mock=true` → in-process `services/chemLabMock.js`. Contract: `handoff/chem_lab_backend_spec.md`.
- **Config hot-reload**: `app_settings.json` and scenario JSON files are read from disk on each request (no restart needed for config changes).
