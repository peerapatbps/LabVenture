# LabVenture

LabVenture is an internal full-stack web application for laboratory workflow and water-quality operations. The project combines a React/Vite frontend with a Node.js/Express backend, local SQLite storage, AquaDAT integration, CAR tracking, chemical intake logging, and weekly algae-species recording.

## Stack

- Frontend: React 18, Vite, Tailwind CSS, React Query, React Router, Recharts
- Backend: Node.js, Express
- Database: SQLite via `node-sqlite3-wasm`
- Integrations: AquaDAT GraphQL, LINE notifications, internal EHR sync

## Project Structure

```text
client/   React application
server/   Express API, database, integrations, configuration
```

## Main Features

- Authentication flow with session-based access to the app
- Lab record entry by node and parameter group
- Scenario management for threshold-based workflows
- CAR logging with status tracking and admin/whitelist support
- Chemical intake recording
- Weekly algae-species recording with searchable species master data
- Local SQLite persistence plus external AquaDAT-related processing routes

## Prerequisites

- Node.js 18+ recommended
- npm

## Installation

Install dependencies for both apps:

```bash
cd server
npm install

cd ../client
npm install
```

## Running In Development

Start the backend:

```bash
cd server
npm run dev
```

Start the frontend in another terminal:

```bash
cd client
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8889`

## Production Build

Build the frontend:

```bash
cd client
npm run build
```

If `client/dist` exists, the Express server serves the built frontend automatically.

## Environment Notes

The backend expects environment variables for external integrations such as AquaDAT, LINE, and admin configuration. Sensitive values should be provided through a local `.env` file inside the server environment and should not be committed.

Examples of integration-related variables used by the codebase include:

- `PORT`
- `SUPERADMIN_NAME`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_GROUP_ID`

## Database

The backend initializes SQLite tables on startup, including:

- `scenarios`
- `node_records`
- `car_log`
- `car_steps`
- `car_whitelist`
- `chem_history`
- `algae_species`
- `algae_records`

## Notes

- `handoff.md` contains detailed implementation notes and session history.
- Large generated folders such as `node_modules` and runtime database files are intentionally excluded from git.
