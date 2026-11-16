/**
 * Alert Service
 * Diffs new run findings vs previous run, sends SFMC transactional alert email
 * when new CRITICAL/HIGH findings are detected above the org's threshold.
 */

const axios = require('axios');
const { runs, findings: findingsDB } = require('./db');
const { getAccessToken } = require('./sfmcAuth');

const SEND_DEF_KEY = 'QADemoV1_AuditAlert_SendDef';
const APP_URL = process.env.APP_URL || 'http://localhost:3001';

/**
 * Returns findings from the most recent completed run before `excludeRunId`.
 */
function getPreviousRunFindings(orgId, excludeRunId) {
  const allRuns = runs.list(orgId); // sorted desc by started_at
  const prevRun = allRuns.find(r => r.id !== excludeRunId && r.status === 'completed');
  if (!prevRun) return [];
  return findingsDB.forRun(prevRun.id);
}

/**
 * Returns findings that are new (not present in previous run by title+entity_id).
 */
function diffFindings(currentFindings, previousFindings) {
  const prevKeys = new Set(previousFindings.map(f => `${f.title}||${f.entity_id || ''}`));
  return currentFindings.filter(f => !prevKeys.has(`${f.title}||${f.entity_id || ''}`));
}

/**
 * Builds the findings HTML table for the email body.
 */
function buildFindingsHTML(findings) {
  if (findings.length === 0) return '<p style="color:#6b7280;font-size:13px;">No new findings.</p>';

  const rows = findings.map(f => `
    <tr>
      <td><span class="badge badge--${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td>${escapeHtml(f.category)}</td>
      <td>${escapeHtml(f.title)}</td>
      <td>${escapeHtml(f.entity_name || f.entity_id || '—')}</td>
    </tr>`).join('');

  return `
    <table class="findings">
      <thead>
        <tr>
          <th>Severity</th>
          <th>Category</th>
          <th>Finding</th>
          <th>Asset</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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
 * Sends an alert email via SFMC Transactional Messaging API.
 * creds: { clientId, clientSecret, subdomain, accountId }
 * org: full org record (needs name, alert_email, alert_threshold)
 * newFindings: array of finding objects
 * runId: current run ID
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
  const findingsHTML = buildFindingsHTML(newFindings);
  const runDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const threshold = org.alert_threshold || 'CRITICAL_AND_HIGH';

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
          FindingsHTML: findingsHTML,
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
 * Diffs findings, checks threshold, and sends alert if warranted.
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

module.exports = { maybeAlert, diffFindings, buildFindingsHTML };
