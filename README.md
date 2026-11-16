# SFMC Audit App

A hosted web application for auditing Salesforce Marketing Cloud instances. Connect any SFMC org, run a full account scan, and get AI-generated findings and recommendations across 7 dashboard sections.

---

## Features

| Tab | What it does |
|-----|-------------|
| **Retrieve Data** | Full account scan — emails, journeys, automations, DEs, SQL queries, users, send history |
| **Context** | Browse every collected object by type |
| **Findings** | Filtered findings table with severity breakdown charts |
| **Alerts** | CRITICAL + HIGH findings at a glance |
| **Testing Center** | Spot-test a single email, journey, or automation by ID |
| **Audit Log** | Full record of all scans and operations |
| **Summary** | AI executive summary (Claude claude-sonnet-4-6) + charts |

---

## Local development

### Prerequisites

- Node.js 20+
- An SFMC installed package with API Integration (OAuth 2.0 Server-to-Server), scopes: `email_read`, `journeys_read`, `automations_read`, `data_extensions_read`, `accounts_read`, `users_read`
- An Anthropic API key (for the AI summary — the app works without it, with a fallback message)

### Install and run

```bash
git clone <your-repo>
cd sfmc-audit-app
cp .env.example .env
# edit .env — add your ANTHROPIC_API_KEY
npm install          # installs server deps + triggers client install via postinstall
npm run dev          # starts server on :3000, React dev server on :3001
```

Open [http://localhost:3001](http://localhost:3001) and add your first org via **Manage Orgs**.

---

## Project structure

```
sfmc-audit-app/
├── server/
│   └── src/
│       ├── index.js                  Express server
│       ├── routes/
│       │   ├── orgs.js               Org CRUD + credential validation
│       │   └── audit.js              Scan orchestration + findings API
│       ├── services/
│       │   ├── db.js                 SQLite (better-sqlite3) persistence
│       │   ├── sfmcAuth.js           OAuth2 token management + REST/SOAP clients
│       │   └── sfmcCollector.js      Per-object SFMC data fetchers
│       └── engines/
│           └── findingsEngine.js     Rule-based findings + Claude AI summary
├── client/
│   └── src/
│       ├── App.js                    Routing + nav shell
│       ├── context/OrgContext.js     Global org state
│       ├── utils/api.js              API call helpers (axios)
│       ├── pages/                    One component per tab
│       └── components/OrgModal.jsx   Org add/remove dialog
├── Procfile                          Heroku process declaration
├── .env.example                      Environment variable template
└── package.json                      Root monorepo scripts
```

---

## Deploying to Heroku

### 1. Create a Heroku app

```bash
heroku login
heroku create your-sfmc-audit-app
```

### 2. Set environment variables

```bash
heroku config:set NODE_ENV=production
heroku config:set ANTHROPIC_API_KEY=sk-ant-api03-...
heroku config:set SESSION_SECRET=$(openssl rand -hex 32)
```

### 3. Deploy

```bash
git add .
git commit -m "Initial deploy"
git push heroku main
```

The `Procfile` runs `node server/src/index.js`. The `postinstall` script builds the React client automatically during `npm install` on Heroku.

### 4. Persistent database (important for production)

By default the app uses SQLite at `./audit.db`. **SQLite on Heroku's ephemeral filesystem is wiped on every dyno restart** — org credentials and scan history will be lost.

**For production use, migrate to PostgreSQL:**

1. Add the Heroku Postgres addon:
   ```bash
   heroku addons:create heroku-postgresql:essential-0
   ```
2. The `DATABASE_URL` env var is set automatically.
3. Replace `better-sqlite3` in `server/src/services/db.js` with the `pg` package using the same interface. A reference migration is provided in `server/src/services/db.postgres.js` (see below for the approach).

**Quick Postgres migration approach** (`db.js` swap):

```bash
npm install pg
heroku config:set DB_TYPE=postgres
```

Then update `db.js` to branch on `process.env.DB_TYPE`:
```javascript
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
```
All `db.prepare(...).run(...)` calls become `pool.query(sql, params)` — the schema SQL is identical.

### 5. Scale up (optional)

```bash
heroku ps:scale web=1
heroku open
```

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (Heroku sets this automatically) |
| `NODE_ENV` | Yes (prod) | Set to `production` to serve the React build |
| `ANTHROPIC_API_KEY` | Recommended | Claude AI for executive summaries |
| `SESSION_SECRET` | Recommended | Random hex string for session signing |
| `DB_PATH` | No | SQLite file path (default: `./audit.db`) |

---

## SFMC installed package setup

1. In Marketing Cloud, go to **Setup → Apps → Installed Packages → New**
2. Add an **API Integration** component, type **Server-to-Server**
3. Enable scopes:
   - Channels: Email (Read)
   - Contacts: List and Subscribers (Read)
   - Data: Data Extensions (Read), Journeys (Read), Automations (Read)
   - Users: Accounts (Read)
4. Save and copy the **Client ID**, **Client Secret**, and **Subdomain** (from your MC instance URL: `https://{{subdomain}}.marketingcloudapis.com`)
5. For a child Business Unit, also copy the **MID** (Account ID)

---

## Security notes

- Org credentials (Client ID / Secret) are stored in the SQLite database. Use environment variables or a secrets manager for the `DB_PATH` in production, and ensure the database file is not publicly accessible.
- The app rate-limits API calls to 120 requests/minute.
- All SFMC API calls use short-lived OAuth2 tokens (20-minute TTL) cached in memory.
- The app does **not** write to your SFMC org — all operations are read-only.
