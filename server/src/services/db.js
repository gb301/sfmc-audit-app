/**
 * SQLite persistence layer for orgs, audit runs, findings, and audit log.
 * On Heroku, swap better-sqlite3 for pg (Postgres) using the same interface.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../../audit.db');
const db = new Database(DB_PATH);

// WAL mode for concurrent reads
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    subdomain   TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    account_id  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    last_used   TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_runs (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES orgs(id),
    status      TEXT NOT NULL DEFAULT 'pending',
    phase       TEXT,
    started_at  TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    summary_json TEXT,
    FOREIGN KEY(org_id) REFERENCES orgs(id)
  );

  CREATE TABLE IF NOT EXISTS findings (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES audit_runs(id),
    org_id      TEXT NOT NULL,
    severity    TEXT NOT NULL,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    detail      TEXT,
    remediation TEXT,
    entity_type TEXT,
    entity_id   TEXT,
    entity_name TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      TEXT,
    run_id      TEXT,
    action      TEXT NOT NULL,
    actor       TEXT DEFAULT 'system',
    detail      TEXT,
    ts          TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS context_cache (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL,
    data_type   TEXT NOT NULL,
    payload     TEXT NOT NULL,
    collected_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Orgs ──────────────────────────────────────────────────────────────────────

const orgs = {
  list: () => db.prepare('SELECT id, name, subdomain, client_id, account_id, created_at, last_used FROM orgs ORDER BY last_used DESC').all(),
  get: (id) => db.prepare('SELECT * FROM orgs WHERE id = ?').get(id),
  create: (org) => db.prepare('INSERT INTO orgs (id,name,subdomain,client_id,client_secret,account_id) VALUES (@id,@name,@subdomain,@client_id,@client_secret,@account_id)').run(org),
  update: (id, fields) => db.prepare('UPDATE orgs SET name=@name, subdomain=@subdomain, client_id=@client_id, client_secret=@client_secret, account_id=@account_id WHERE id=@id').run({ id, ...fields }),
  touch: (id) => db.prepare("UPDATE orgs SET last_used=datetime('now') WHERE id=?").run(id),
  delete: (id) => db.prepare('DELETE FROM orgs WHERE id=?').run(id),
};

// ── Audit Runs ────────────────────────────────────────────────────────────────

const runs = {
  list: (orgId) => db.prepare('SELECT * FROM audit_runs WHERE org_id=? ORDER BY started_at DESC LIMIT 20').all(orgId),
  get: (id) => db.prepare('SELECT * FROM audit_runs WHERE id=?').get(id),
  create: (run) => db.prepare('INSERT INTO audit_runs (id,org_id,status) VALUES (@id,@org_id,@status)').run(run),
  updateStatus: (id, status, phase) => db.prepare('UPDATE audit_runs SET status=?, phase=? WHERE id=?').run(status, phase || null, id),
  complete: (id, summaryJson) => db.prepare("UPDATE audit_runs SET status='complete', phase=NULL, completed_at=datetime('now'), summary_json=? WHERE id=?").run(summaryJson, id),
  fail: (id, msg) => db.prepare("UPDATE audit_runs SET status='failed', phase=? WHERE id=?").run(msg, id),
};

// ── Findings ──────────────────────────────────────────────────────────────────

const findings = {
  forRun: (runId) => db.prepare('SELECT * FROM findings WHERE run_id=? ORDER BY severity DESC, category').all(runId),
  forOrg: (orgId, limit = 100) => db.prepare('SELECT * FROM findings WHERE org_id=? ORDER BY created_at DESC LIMIT ?').all(orgId, limit),
  critical: (orgId) => db.prepare("SELECT * FROM findings WHERE org_id=? AND severity IN ('CRITICAL','HIGH') ORDER BY severity DESC, created_at DESC").all(orgId),
  insertMany: db.transaction((rows) => {
    const stmt = db.prepare('INSERT INTO findings (id,run_id,org_id,severity,category,title,detail,remediation,entity_type,entity_id,entity_name) VALUES (@id,@run_id,@org_id,@severity,@category,@title,@detail,@remediation,@entity_type,@entity_id,@entity_name)');
    for (const row of rows) stmt.run(row);
  }),
};

// ── Audit Log ─────────────────────────────────────────────────────────────────

const auditLog = {
  append: (entry) => db.prepare('INSERT INTO audit_log (org_id,run_id,action,actor,detail) VALUES (@org_id,@run_id,@action,@actor,@detail)').run(entry),
  list: (orgId, limit = 200) => db.prepare('SELECT * FROM audit_log WHERE org_id=? ORDER BY ts DESC LIMIT ?').all(orgId, limit),
  all: (limit = 500) => db.prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?').all(limit),
};

// ── Context Cache ─────────────────────────────────────────────────────────────

const contextCache = {
  set: (id, orgId, dataType, payload) => db.prepare('INSERT OR REPLACE INTO context_cache (id,org_id,data_type,payload,collected_at) VALUES (?,?,?,?,datetime("now"))').run(id, orgId, dataType, JSON.stringify(payload)),
  get: (orgId, dataType) => {
    const row = db.prepare('SELECT * FROM context_cache WHERE org_id=? AND data_type=? ORDER BY collected_at DESC LIMIT 1').get(orgId, dataType);
    return row ? JSON.parse(row.payload) : null;
  },
  clear: (orgId) => db.prepare('DELETE FROM context_cache WHERE org_id=?').run(orgId),
};

module.exports = { db, orgs, runs, findings, auditLog, contextCache };
