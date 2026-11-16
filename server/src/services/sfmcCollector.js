/**
 * SFMC Data Collector
 * Fetches all relevant objects from an org for audit purposes.
 * Each method returns a typed, normalised array.
 */

const axios = require('axios');
const xml2js = require('xml2js');
const { restClient, soapEnvelope } = require('./sfmcAuth');

const xmlParser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });

async function parseSoap(xml) {
  return xmlParser.parseStringPromise(xml);
}

// ── REST helpers ──────────────────────────────────────────────────────────────

async function getAllPages(client, path, pageSize = 50) {
  const results = [];
  let page = 1;
  while (true) {
    const { data } = await client.get(path, { params: { $page: page, $pageSize: pageSize } });
    const items = data.items || data.results || data.definitions || data.interactions || [];
    results.push(...items);
    if (items.length < pageSize || !data.links?.next) break;
    page++;
  }
  return results;
}

// ── Email Assets ──────────────────────────────────────────────────────────────

async function collectEmailAssets(creds) {
  const client = await restClient(creds);
  const { data } = await client.post('/asset/v1/content/assets/query', {
    query: { property: 'assetType.name', simpleOperator: 'in', value: ['htmlemail', 'templatebasedemail', 'textonlyemail'] },
    page: { page: 1, pageSize: 200 },
    fields: ['id', 'name', 'assetType', 'category', 'createdDate', 'modifiedDate', 'status', 'views'],
  });

  return (data.items || []).map(a => ({
    id: String(a.id),
    name: a.name,
    type: a.assetType?.name,
    categoryId: a.category?.id,
    categoryName: a.category?.name,
    createdDate: a.createdDate,
    modifiedDate: a.modifiedDate,
    hasHTML: !!a.views?.html?.content,
    htmlContent: a.views?.html?.content || '',
    subjectLine: a.views?.subjectline?.content || '',
  }));
}

// ── Data Extensions ───────────────────────────────────────────────────────────

async function collectDataExtensions(creds) {
  const client = await restClient(creds);
  const items = await getAllPages(client, '/data/v1/customobjects', 100);
  return items.map(de => ({
    id: de.objectID || de.customerKey,
    customerKey: de.customerKey,
    name: de.name,
    categoryId: de.categoryId,
    isSendable: de.isSendable,
    rowCount: de.rowCount,
    createdDate: de.createdDate,
    modifiedDate: de.modifiedDate,
  }));
}

// ── Journeys ──────────────────────────────────────────────────────────────────

async function collectJourneys(creds) {
  const client = await restClient(creds);
  const items = await getAllPages(client, '/interaction/v1/interactions', 50);
  return items.map(j => ({
    id: j.id,
    key: j.key,
    name: j.name,
    status: j.status,
    version: j.version,
    createdDate: j.createdDate,
    modifiedDate: j.modifiedDate,
    entryMode: j.entryMode,
    triggers: (j.triggers || []).map(t => ({ type: t.type, key: t.key })),
    activityCount: (j.activities || []).length,
    activities: (j.activities || []).map(a => ({ type: a.type, key: a.key, name: a.name })),
  }));
}

// ── Automations ───────────────────────────────────────────────────────────────

async function collectAutomations(creds) {
  const client = await restClient(creds);
  const items = await getAllPages(client, '/automation/v1/automations', 50);
  return items.map(a => ({
    id: a.id,
    name: a.name,
    status: a.status,
    schedule: a.schedule,
    lastRunTime: a.lastRunTime,
    lastRunStatus: a.lastRunStatus,
    stepCount: (a.steps || []).length,
    steps: (a.steps || []).map(s => ({
      name: s.name,
      activities: (s.activities || []).map(act => ({ type: act.objectTypeId, name: act.name })),
    })),
  }));
}

// ── SQL Queries ───────────────────────────────────────────────────────────────

async function collectSQLQueries(creds) {
  const client = await restClient(creds);
  const items = await getAllPages(client, '/automation/v1/queries', 50);
  return items.map(q => ({
    id: q.queryDefinitionId || q.id,
    name: q.name,
    key: q.key,
    queryText: q.queryText,
    targetName: q.targetName,
    targetKey: q.targetKey,
    updateType: q.targetUpdateTypeId,
    createdDate: q.createdDate,
    modifiedDate: q.modifiedDate,
  }));
}

// ── Send Definitions (Triggered Sends / Transactional) ────────────────────────

async function collectSendDefinitions(creds) {
  const client = await restClient(creds);
  try {
    const items = await getAllPages(client, '/messaging/v1/email/definitions', 50);
    return items.map(d => ({
      id: d.definitionKey,
      name: d.name,
      status: d.status,
      type: 'transactional_email',
      contentKey: d.content?.customerKey,
      subscriptionList: d.subscriptions?.list,
      createdDate: d.createdDate,
      modifiedDate: d.modifiedDate,
    }));
  } catch {
    return [];
  }
}

// ── Event Definitions ─────────────────────────────────────────────────────────

async function collectEventDefinitions(creds) {
  const client = await restClient(creds);
  try {
    const { data } = await client.get('/interaction/v1/eventDefinitions', { params: { $pageSize: 200 } });
    return (data.items || data || []).map(e => ({
      id: e.id,
      key: e.eventDefinitionKey,
      name: e.name,
      type: e.type,
      mode: e.mode,
      dataExtensionId: e.dataExtensionId,
      createdDate: e.createdDate,
    }));
  } catch {
    return [];
  }
}

// ── Recent Sends (from SOAP _Sent data view summary) ─────────────────────────

async function collectRecentSendSummary(creds) {
  const client = await restClient(creds);
  try {
    // Get last 30 days of send jobs via SOAP
    const bodyXml = `
      <RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">
        <RetrieveRequest>
          <ObjectType>Send</ObjectType>
          <Properties>ID</Properties>
          <Properties>EmailName</Properties>
          <Properties>Subject</Properties>
          <Properties>Status</Properties>
          <Properties>NumberSent</Properties>
          <Properties>NumberDelivered</Properties>
          <Properties>NumberOpened</Properties>
          <Properties>NumberClicked</Properties>
          <Properties>NumberBounced</Properties>
          <Properties>NumberUnsubscribed</Properties>
          <Properties>SentDate</Properties>
          <Filter xsi:type="SimpleFilterPart" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <Property>SentDate</Property>
            <SimpleOperator>greaterThan</SimpleOperator>
            <DateValue>${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}</DateValue>
          </Filter>
        </RetrieveRequest>
      </RetrieveRequestMsg>`;

    const { xml, soapBaseUrl } = await soapEnvelope(creds, bodyXml);
    const { data: rawXml } = await axios.post(`${soapBaseUrl}/Service.asmx`, xml, {
      headers: { 'Content-Type': 'text/xml', SOAPAction: 'Retrieve' },
      timeout: 30000,
    });

    const parsed = await parseSoap(rawXml);
    const results = parsed?.['soap:Envelope']?.['soap:Body']?.RetrieveResponseMsg?.Results;
    if (!results) return [];
    const arr = Array.isArray(results) ? results : [results];
    return arr.map(s => ({
      id: s.ID,
      emailName: s.EmailName,
      subject: s.Subject,
      status: s.Status,
      sent: parseInt(s.NumberSent || 0),
      delivered: parseInt(s.NumberDelivered || 0),
      opened: parseInt(s.NumberOpened || 0),
      clicked: parseInt(s.NumberClicked || 0),
      bounced: parseInt(s.NumberBounced || 0),
      unsubscribed: parseInt(s.NumberUnsubscribed || 0),
      sentDate: s.SentDate,
    }));
  } catch {
    return [];
  }
}

// ── Users & Roles ─────────────────────────────────────────────────────────────

async function collectUsers(creds) {
  try {
    const bodyXml = `
      <RetrieveRequestMsg xmlns="http://exacttarget.com/wsdl/partnerAPI">
        <RetrieveRequest>
          <ObjectType>AccountUser</ObjectType>
          <Properties>ID</Properties>
          <Properties>Name</Properties>
          <Properties>Email</Properties>
          <Properties>UserID</Properties>
          <Properties>IsActive</Properties>
          <Properties>LastSuccessfulLogin</Properties>
          <Properties>MustChangePassword</Properties>
          <Properties>ActiveFlag</Properties>
        </RetrieveRequest>
      </RetrieveRequestMsg>`;

    const { xml, soapBaseUrl } = await soapEnvelope(creds, bodyXml);
    const { data: rawXml } = await axios.post(`${soapBaseUrl}/Service.asmx`, xml, {
      headers: { 'Content-Type': 'text/xml', SOAPAction: 'Retrieve' },
      timeout: 20000,
    });

    const parsed = await parseSoap(rawXml);
    const results = parsed?.['soap:Envelope']?.['soap:Body']?.RetrieveResponseMsg?.Results;
    if (!results) return [];
    const arr = Array.isArray(results) ? results : [results];
    return arr.map(u => ({
      id: u.ID,
      name: u.Name,
      email: u.Email,
      userId: u.UserID,
      isActive: u.ActiveFlag === 'true',
      lastLogin: u.LastSuccessfulLogin,
      mustChangePassword: u.MustChangePassword === 'true',
    }));
  } catch {
    return [];
  }
}

// ── Master Collect ────────────────────────────────────────────────────────────

async function collectAll(creds, onProgress) {
  const steps = [
    { key: 'emails',          label: 'Email Assets',         fn: collectEmailAssets },
    { key: 'dataExtensions',  label: 'Data Extensions',      fn: collectDataExtensions },
    { key: 'journeys',        label: 'Journeys',             fn: collectJourneys },
    { key: 'automations',     label: 'Automations',          fn: collectAutomations },
    { key: 'sqlQueries',      label: 'SQL Queries',          fn: collectSQLQueries },
    { key: 'sendDefinitions', label: 'Send Definitions',     fn: collectSendDefinitions },
    { key: 'eventDefinitions',label: 'Event Definitions',    fn: collectEventDefinitions },
    { key: 'recentSends',     label: 'Recent Sends (30d)',   fn: collectRecentSendSummary },
    { key: 'users',           label: 'Users & Roles',        fn: collectUsers },
  ];

  const context = {};
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (onProgress) onProgress({ step: step.key, label: step.label, index: i + 1, total: steps.length });
    try {
      context[step.key] = await step.fn(creds);
    } catch (err) {
      context[step.key] = [];
      context[`${step.key}_error`] = err.message;
    }
  }
  return context;
}

module.exports = {
  collectAll,
  collectEmailAssets,
  collectDataExtensions,
  collectJourneys,
  collectAutomations,
  collectSQLQueries,
  collectSendDefinitions,
  collectEventDefinitions,
  collectRecentSendSummary,
  collectUsers,
};
