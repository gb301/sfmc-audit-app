/**
 * Alert Service
 * Diffs new run findings vs previous run, sends SFMC transactional alert email
 * via REST Messaging API when new CRITICAL/HIGH findings are detected.
 */

const axios = require('axios');
const { runs, findings: findingsDB } = require('./db');
const { getAccessToken } = require('./sfmcAuth');

const SEND_DEF_KEY = process.env.SFMC_ALERT_SEND_DEF_KEY || 'QADemoV1_AuditAlert_SendDef_v2';
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

const CB_ASSET_ID = process.env.SFMC_ALERT_CB_ASSET_ID ? Number(process.env.SFMC_ALERT_CB_ASSET_ID) : 1793555;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TABLE_LIMIT = 10;

function buildAlertHtml({ orgName, runDate, findings, appUrl, thresholdLabel }) {
  const critical = findings.filter(f => f.severity === 'CRITICAL');
  const high = findings.filter(f => f.severity === 'HIGH');

  // Show top 10 critical first, then fill remaining slots with high
  const topCritical = critical.slice(0, TABLE_LIMIT);
  const remainingSlots = TABLE_LIMIT - topCritical.length;
  const tableFindings = [...topCritical, ...high.slice(0, remainingSlots)];
  const hiddenCount = findings.length - tableFindings.length;

  const rows = tableFindings.map(f => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:8px 10px;font-weight:700;color:${f.severity === 'CRITICAL' ? '#dc2626' : '#d97706'};white-space:nowrap">${escapeHtml(f.severity)}</td>
      <td style="padding:8px 10px;color:#6b7280;font-size:12px;white-space:nowrap">${escapeHtml(f.category || '')}</td>
      <td style="padding:8px 10px">${escapeHtml(f.title)}</td>
      <td style="padding:8px 10px;font-size:12px;color:#6b7280">${escapeHtml(f.entity_name || f.entity_id || '')}</td>
    </tr>`).join('');

  const moreRow = hiddenCount > 0 ? `
    <tr>
      <td colspan="4" style="padding:10px;text-align:center;font-size:12px;color:#6b7280;background:#f9fafb;border-top:1px solid #e5e7eb">
        + ${hiddenCount} more finding${hiddenCount === 1 ? '' : 's'} &mdash; <a href="${escapeHtml(appUrl)}" style="color:#032D60;font-weight:600">view the full report</a>
      </td>
    </tr>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SFMC Audit Alert</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#032D60;border-radius:8px 8px 0 0;padding:24px 32px">
    <h1 style="color:#fff;font-size:20px;margin:0;font-weight:600">SFMC Audit Alert</h1>
    <p style="color:#c9d9e8;font-size:13px;margin:6px 0 0">${escapeHtml(orgName)} &mdash; ${escapeHtml(runDate)}</p>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e1e5eb;border-top:none">
    <p style="font-size:14px;color:#374151;margin:0 0 20px">A nightly audit detected <strong>${findings.length} new issue(s)</strong> requiring attention (threshold: ${escapeHtml(thresholdLabel)}).</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:12px 16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;text-align:center;width:48%">
          <div style="font-size:32px;font-weight:700;color:#dc2626">${critical.length}</div>
          <div style="font-size:12px;color:#991b1b;font-weight:600;margin-top:2px">CRITICAL</div>
        </td>
        <td style="width:4%"></td>
        <td style="padding:12px 16px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;text-align:center;width:48%">
          <div style="font-size:32px;font-weight:700;color:#d97706">${high.length}</div>
          <div style="font-size:12px;color:#92400e;font-weight:600;margin-top:2px">HIGH</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">SEVERITY</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">CATEGORY</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">FINDING</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">ASSET</th>
        </tr>
      </thead>
      <tbody>${rows}${moreRow}</tbody>
    </table>
    <div style="text-align:center">
      <a href="${escapeHtml(appUrl)}" style="background:#032D60;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:13px;font-weight:600;display:inline-block">View Full Report in SFMC Audit App</a>
    </div>
  </div>
  <div style="background:#f8f9fa;border:1px solid #e1e5eb;border-top:none;border-radius:0 0 8px 8px;padding:14px 32px">
    <p style="font-size:11px;color:#9ca3af;margin:0">Sent automatically by SFMC Audit App</p>
  </div>
</div>
<custom name="opencounter" type="tracking"/>
</body></html>`;
}

/**
 * Sends an alert email via SFMC REST Transactional Messaging API.
 * Patches the CB asset with rendered HTML first, since type-208 assets
 * don't support attribute substitution at send time.
 */
async function sendAlertEmail(creds, org, newFindings, runId) {
  // Use dedicated alert package credentials from env if provided, otherwise fall back to the org's own credentials
  const alertCreds = process.env.SFMC_ALERT_CLIENT_ID ? {
    clientId: process.env.SFMC_ALERT_CLIENT_ID,
    clientSecret: process.env.SFMC_ALERT_CLIENT_SECRET,
    subdomain: process.env.SFMC_ALERT_SUBDOMAIN,
    accountId: process.env.SFMC_ALERT_ACCOUNT_ID,
  } : creds;
  const { accessToken, restBaseUrl } = await getAccessToken(alertCreds);
  const http = axios.create({
    baseURL: restBaseUrl,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });

  const runDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const threshold = org.alert_threshold || 'CRITICAL_AND_HIGH';
  const thresholdLabel = threshold === 'CRITICAL_ONLY' ? 'Critical only' : 'Critical & High';

  const html = buildAlertHtml({ orgName: org.name, runDate, findings: newFindings, appUrl: APP_URL, thresholdLabel });
  const subject = `SFMC Audit Alert: ${newFindings.length} new issue(s) in ${org.name}`;

  // Patch the CB asset with the rendered HTML
  await http.patch(`/asset/v1/content/assets/${CB_ASSET_ID}`, {
    views: {
      subjectline: { content: subject },
      html: { content: html },
    },
  });

  // Cycle the send definition Inactive→Active so it picks up the new asset content
  // (transactional send definitions cache content at activation time)
  await http.patch(`/messaging/v1/email/definitions/${SEND_DEF_KEY}`, { status: 'Inactive' });
  await http.patch(`/messaging/v1/email/definitions/${SEND_DEF_KEY}`, { status: 'Active' });

  const { data } = await http.post('/messaging/v1/email/messages', {
    definitionKey: SEND_DEF_KEY,
    recipients: [{ contactKey: `audit-alert-${org.id}`, to: org.alert_email }],
  });
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
