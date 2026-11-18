/**
 * Alert Service
 * Diffs new run findings vs previous run, sends SFMC triggered alert email
 * via SOAP TriggeredSend when new CRITICAL/HIGH findings are detected.
 */

const axios = require('axios');
const xml2js = require('xml2js');
const { runs, findings: findingsDB } = require('./db');
const { getAccessToken } = require('./sfmcAuth');

const SEND_DEF_KEY = 'QADemoV1_AuditAlert_SendDef';
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

function buildFindingsHTML(findings) {
  if (findings.length === 0) return '<p style="color:#6b7280;font-size:13px;">No new findings.</p>';

  const rows = findings.map(f => `
    <tr>
      <td style="padding:4px 8px;font-weight:bold;color:${f.severity === 'CRITICAL' ? '#dc2626' : '#d97706'}">${escapeHtml(f.severity)}</td>
      <td style="padding:4px 8px">${escapeHtml(f.category)}</td>
      <td style="padding:4px 8px">${escapeHtml(f.title)}</td>
      <td style="padding:4px 8px">${escapeHtml(f.entity_name || f.entity_id || '—')}</td>
    </tr>`).join('');

  return `<table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead><tr style="background:#f3f4f6">
      <th style="padding:6px 8px;text-align:left">Severity</th>
      <th style="padding:6px 8px;text-align:left">Category</th>
      <th style="padding:6px 8px;text-align:left">Finding</th>
      <th style="padding:6px 8px;text-align:left">Asset</th>
    </tr></thead>
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

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a SOAP attribute element: <Attribute><Name>k</Name><Value>v</Value></Attribute>
 */
function soapAttr(name, value) {
  return `<Attribute><Name>${escapeXml(name)}</Name><Value>${escapeXml(String(value))}</Value></Attribute>`;
}

/**
 * Sends an alert email via SFMC SOAP TriggeredSend.
 */
async function sendAlertEmail(creds, org, newFindings, runId) {
  const { accessToken, soapBaseUrl } = await getAccessToken(creds);

  const critical = newFindings.filter(f => f.severity === 'CRITICAL');
  const high = newFindings.filter(f => f.severity === 'HIGH');
  const findingsHTML = buildFindingsHTML(newFindings);
  const runDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const threshold = org.alert_threshold || 'CRITICAL_AND_HIGH';
  const thresholdLabel = threshold === 'CRITICAL_ONLY' ? 'Critical only' : 'Critical &amp; High';

  const attributes = [
    soapAttr('OrgName', org.name),
    soapAttr('RunDate', runDate),
    soapAttr('NewFindingCount', newFindings.length),
    soapAttr('CriticalCount', critical.length),
    soapAttr('HighCount', high.length),
    soapAttr('FindingsHTML', findingsHTML),
    soapAttr('AppURL', APP_URL),
    soapAttr('AlertThreshold', thresholdLabel),
  ].join('\n          ');

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <s:Header>
    <a:Action s:mustUnderstand="1">Create</a:Action>
    <a:To s:mustUnderstand="1">${soapBaseUrl}/Service.asmx</a:To>
    <fueloauth xmlns="http://exacttarget.com">${accessToken}</fueloauth>
  </s:Header>
  <s:Body>
    <CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <Objects xsi:type="TriggeredSend">
        <TriggeredSendDefinition>
          <CustomerKey>${escapeXml(SEND_DEF_KEY)}</CustomerKey>
        </TriggeredSendDefinition>
        <Subscribers>
          <Subscriber>
            <EmailAddress>${escapeXml(org.alert_email)}</EmailAddress>
            <SubscriberKey>audit-alert-${escapeXml(org.id)}</SubscriberKey>
            <Attributes>
              ${attributes}
            </Attributes>
          </Subscriber>
        </Subscribers>
      </Objects>
    </CreateRequest>
  </s:Body>
</s:Envelope>`;

  const { data: responseXml } = await axios.post(
    `${soapBaseUrl}/Service.asmx`,
    envelope,
    {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'Create',
      },
      timeout: 20000,
    }
  );

  const parsed = await xml2js.parseStringPromise(responseXml, { explicitArray: false });
  const body = parsed['soap:Envelope']?.['soap:Body'] ?? parsed['s:Envelope']?.['s:Body'];
  const response = body?.CreateResponse;
  const status = response?.OverallStatus;

  if (status !== 'OK' && status !== 'TriggeredSend') {
    const msg = response?.Results?.StatusMessage || response?.Results?.[0]?.StatusMessage || status || 'Unknown SOAP error';
    throw new Error(`SOAP TriggeredSend failed: ${msg}`);
  }

  return { status, messageId: response?.RequestID };
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

module.exports = { maybeAlert, diffFindings, buildFindingsHTML };
