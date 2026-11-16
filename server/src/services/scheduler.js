/**
 * Nightly scheduler — runs a full audit for each org and sends alert emails
 * for any new CRITICAL/HIGH findings via SFMC Transactional Messaging.
 *
 * Schedule: 02:00 local time every night (configurable via AUDIT_CRON env var).
 * To disable: set DISABLE_SCHEDULER=true.
 */

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { orgs, runs, findings: findingsDB, auditLog } = require('./db');
const { collectAll } = require('./sfmcCollector');
const { runAllRules, generateAISummary } = require('../engines/findingsEngine');
const { maybeAlert } = require('./alertService');

const SCHEDULE = process.env.AUDIT_CRON || '0 2 * * *';

async function runAuditForOrg(org) {
  const runId = uuidv4();
  runs.create({ id: runId, org_id: org.id, status: 'running' });
  auditLog.append({ org_id: org.id, run_id: runId, action: 'SCHEDULED_AUDIT_STARTED', actor: 'scheduler', detail: 'Nightly scheduled audit' });

  const creds = {
    clientId: org.client_id,
    clientSecret: org.client_secret,
    subdomain: org.subdomain,
    accountId: org.account_id,
  };

  try {
    runs.updateStatus(runId, 'running', 'Collecting data from SFMC...');
    const context = await collectAll(creds, ({ label, index, total }) => {
      runs.updateStatus(runId, 'running', `Collecting: ${label} (${index}/${total})`);
    });

    runs.updateStatus(runId, 'running', 'Analysing findings...');
    const rawFindings = runAllRules(context);

    runs.updateStatus(runId, 'running', 'Generating AI summary...');
    let aiSummary = null;
    try { aiSummary = await generateAISummary(context, rawFindings); } catch {}

    const withIds = rawFindings.map(f => ({ ...f, run_id: runId, org_id: org.id }));
    if (withIds.length > 0) findingsDB.insertMany(withIds);

    const summary = {
      counts: {
        CRITICAL: withIds.filter(f => f.severity === 'CRITICAL').length,
        HIGH:     withIds.filter(f => f.severity === 'HIGH').length,
        MEDIUM:   withIds.filter(f => f.severity === 'MEDIUM').length,
        LOW:      withIds.filter(f => f.severity === 'LOW').length,
      },
      context: {
        emails:         (context.emails      || []).length,
        journeys:       (context.journeys    || []).length,
        automations:    (context.automations || []).length,
        dataExtensions: (context.dataExtensions || []).length,
        sqlQueries:     (context.sqlQueries  || []).length,
        users:          (context.users       || []).length,
      },
      aiSummary,
      scheduled: true,
    };

    runs.complete(runId, JSON.stringify(summary));
    auditLog.append({ org_id: org.id, run_id: runId, action: 'SCHEDULED_AUDIT_COMPLETE', actor: 'scheduler', detail: `${withIds.length} findings` });

    // Send alert email if new critical/high findings exist
    try {
      const alertResult = await maybeAlert(org, runId);
      auditLog.append({
        org_id: org.id,
        run_id: runId,
        action: 'ALERT_EMAIL',
        actor: 'scheduler',
        detail: alertResult.sent
          ? `Alert sent to ${org.alert_email} (${alertResult.newCount} new findings)`
          : `No alert sent: ${alertResult.reason}`,
      });
    } catch (alertErr) {
      auditLog.append({ org_id: org.id, run_id: runId, action: 'ALERT_EMAIL_ERROR', actor: 'scheduler', detail: alertErr.message });
    }

  } catch (err) {
    runs.fail(runId, err.message);
    auditLog.append({ org_id: org.id, run_id: runId, action: 'SCHEDULED_AUDIT_FAILED', actor: 'scheduler', detail: err.message });
  }
}

async function runScheduledAudits() {
  const allOrgs = orgs.list();
  if (allOrgs.length === 0) return;
  console.log(`[scheduler] Starting nightly audit for ${allOrgs.length} org(s)`);
  for (const org of allOrgs) {
    try {
      await runAuditForOrg(org);
    } catch (err) {
      console.error(`[scheduler] Uncaught error for org ${org.id}:`, err.message);
    }
  }
  console.log('[scheduler] Nightly audit complete');
}

function start() {
  if (process.env.DISABLE_SCHEDULER === 'true') {
    console.log('[scheduler] Disabled via DISABLE_SCHEDULER=true');
    return;
  }
  cron.schedule(SCHEDULE, runScheduledAudits, { timezone: 'UTC' });
  console.log(`[scheduler] Nightly audit scheduled: ${SCHEDULE} UTC`);
}

module.exports = { start, runScheduledAudits, runAuditForOrg };
