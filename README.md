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

### First-run checklist

Before the app is fully functional you need three things:

| # | What | Where |
|---|------|-------|
| 1 | **Anthropic API key** | [console.anthropic.com](https://console.anthropic.com) → API Keys → add to `.env` as `ANTHROPIC_API_KEY` |
| 2 | **SFMC org credentials** | SFMC Setup → Installed Packages → create a package (see [SFMC installed package setup](#sfmc-installed-package-setup) below) → add via the app's **Manage Orgs** dialog |
| 3 | **Alert recipient email** | Once the app is running, go to the **Alerts** tab → Alert Delivery → enter your email and save |

Items 1 and 2 are required to run audits. Item 3 is optional — without it the nightly scheduler still runs but no alert email is sent.

### Prerequisites

- Node.js 20+
- An SFMC installed package (OAuth 2.0 Server-to-Server) — see setup below
- An Anthropic API key (for AI summaries — the app works without it, with a fallback message)

### Install and run

```bash
git clone <your-repo>
cd sfmc-audit-app
cp .env.example .env
# edit .env — add ANTHROPIC_API_KEY and APP_URL at minimum
npm install          # installs server deps + triggers client install via postinstall
npm run dev          # starts server on :3001
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
| `APP_URL` | Recommended | Public URL of the app — used in alert email CTA links |
| `ANTHROPIC_API_KEY` | Recommended | Claude AI for executive summaries (checklist item 1) |
| `SESSION_SECRET` | Recommended | Random hex string for session signing |
| `DB_PATH` | No | SQLite file path (default: `./audit.db`) |
| `SFMC_ALERT_CLIENT_ID` | Alert emails | Installed package Client ID with write scopes |
| `SFMC_ALERT_CLIENT_SECRET` | Alert emails | Installed package Client Secret |
| `SFMC_ALERT_SUBDOMAIN` | Alert emails | MC subdomain (from `https://{{subdomain}}.marketingcloudapis.com`) |
| `SFMC_ALERT_ACCOUNT_ID` | Alert emails | Business Unit MID |
| `SFMC_ALERT_CB_ASSET_ID` | Alert emails | Content Builder HTML email asset ID |
| `SFMC_ALERT_SEND_DEF_KEY` | Alert emails | Transactional send definition key |

---

## SFMC installed package setup

### Audit package (required — add credentials via Manage Orgs)

1. In Marketing Cloud, go to **Setup → Apps → Installed Packages → New**
2. Add an **API Integration** component, type **Server-to-Server**
3. Enable scopes:
   - Channels: Email (Read)
   - Contacts: List and Subscribers (Read)
   - Data: Data Extensions (Read), Journeys (Read), Automations (Read)
   - Users: Accounts (Read)
4. Save and copy the **Client ID**, **Client Secret**, and **Subdomain** (from your MC instance URL: `https://{{subdomain}}.marketingcloudapis.com`)
5. For a child Business Unit, also copy the **MID** (Account ID)
6. Add these credentials in the app via **Manage Orgs**

### Alert email package (optional — required only for nightly alert emails)

The alert email system requires a separate installed package with write access to Content Builder and Transactional Messaging. You can reuse the same package as above if you add the extra scopes, or create a dedicated one.

**Additional scopes needed:**
- Channels: Email (Read + Write)
- Assets: Documents and Images (Read + Write)
- Assets: Saved Content (Read + Write)
- Messaging: (Read + Write)

**One-time Content Builder setup:**
1. In Content Builder, create a new **HTML Email** asset — paste in any placeholder HTML to start
2. Note the asset's numeric **ID** (visible in the URL when editing it)
3. Create a **Transactional Send Definition** via Setup → Transactional Messaging (or the REST API), pointing at the asset above
4. Note the **Definition Key**
5. Add all four values to `.env` (see [Environment variables reference](#environment-variables-reference))

Once the alert package credentials and asset IDs are in `.env`, set your recipient email in the app's **Alerts → Alert Delivery** section. The nightly scheduler (02:00 UTC) will send an alert email whenever new Critical or High findings are detected.

---

## Security notes

- Org credentials (Client ID / Secret) are stored in the SQLite database. Use environment variables or a secrets manager for the `DB_PATH` in production, and ensure the database file is not publicly accessible.
- The app rate-limits API calls to 120 requests/minute.
- All SFMC API calls use short-lived OAuth2 tokens (20-minute TTL) cached in memory.
- The app does **not** write to your SFMC org — all operations are read-only.
