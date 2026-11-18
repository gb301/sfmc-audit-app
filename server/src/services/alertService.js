/**
 * Alert Service
 * Diffs new run findings vs previous run, sends SFMC transactional alert email
 * via REST Messaging API when new CRITICAL/HIGH findings are detected.
 */

const axios = require('axios');
const { runs, findings: findingsDB } = require('./db');
const { getAccessToken } = require('./sfmcAuth');

const SEND_DEF_KEY = 'QADemoV1_AuditAlert_SendDef_v2';
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

function getPreviousRunFindings(orgId, excludeRunId) {
  const allRuns = runs.list(orgId);
  const prevRun = allRuns.find(r => r.id !== excludeRunId && r.status === 'completed');
  if (!prevRun) return [];
  return findingsDB.forRun(prevRun.id);
}

function diffFindings(currentFindings, previousFindings) {
  const prevKeys = new Set(previousFindings.map(f => `${f.title}||${f.entity_id || ''}`));
  return currentFindings.filter(f => !prevKeys.has(`${f.title}||${f.entity_id || ''}`));
}

function buildFindingsSummary(findings) {
  return findings.map(f =>
    `[${f.severity}] ${f.category}: ${f.title}${f.entity_name ? ` (${f.entity_name})` : ''}`
  ).join('\n');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sends an alert email via SFMC REST Transactional Messaging API.
 */
async function sendAlertEmail(creds, org, newFindings, runId) {
  const { accessToken, restBaseUrl } = await getAccessToken(creds);
  const http = axios.create({
    baseURL: restBaseUrl,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });

  const critical = newFindings.filter(f => f.severity === 'CRITICAL');
  const high = newFindings.filter(f => f.severity === 'HIGH');
  const runDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const threshold = org.alert_threshold || 'CRITICAL_AND_HIGH';
  const findingsSummary = buildFindingsSummary(newFindings);

  const payload = {
    definitionKey: SEND_DEF_KEY,
    recipients: [
      {
        contactKey: `audit-alert-${org.id}`,
        to: org.alert_email,
        attributes: {
          OrgName: org.name,
          RunDate: runDate,
          NewFindingCount: String(newFindings.length),
          CriticalCount: String(critical.length),
          HighCount: String(high.length),
          FindingsSummary: findingsSummary,
          AppURL: APP_URL,
          AlertThreshold: threshold === 'CRITICAL_ONLY' ? 'Critical only' : 'Critical & High',
        },
      },
    ],
  };

  const { data } = await http.post('/messaging/v1/email/messages', payload);
  return data;
}

/**
 * Main entry point called after each audit run.
 * Returns { sent: bool, newCount: number, reason: string }
 */
async function maybeAlert(org, runId) {
  if (!org.alert_email) {
    return { sent: false, newCount: 0, reason: 'no_alert_email' };
  }

  const currentFindings = findingsDB.forRun(runId);
  const previousFindings = getPreviousRunFindings(org.id, runId);
  const newFindings = diffFindings(currentFindings, previousFindings);

  const threshold = org.alert_threshold || 'CRITICAL_AND_HIGH';
  const qualifying = threshold === 'CRITICAL_ONLY'
    ? newFindings.filter(f => f.severity === 'CRITICAL')
    : newFindings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');

  if (qualifying.length === 0) {
    return { sent: false, newCount: newFindings.length, reason: 'below_threshold' };
  }

  const creds = {
    clientId: org.client_id,
    clientSecret: org.client_secret,
    subdomain: org.subdomain,
    accountId: org.account_id,
  };

  await sendAlertEmail(creds, org, qualifying, runId);
  return { sent: true, newCount: qualifying.length, reason: 'alert_sent' };
}

module.exports = { maybeAlert, diffFindings };
