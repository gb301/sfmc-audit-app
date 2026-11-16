const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { orgs, runs, findings: findingsDB, auditLog, contextCache } = require('../services/db');
const { collectAll } = require('../services/sfmcCollector');
const { runAllRules, generateAISummary } = require('../engines/findingsEngine');

const router = express.Router();

// In-memory run state for SSE progress streaming
const runState = new Map();

// ── Start a full audit run ────────────────────────────────────────────────────

router.post('/orgs/:orgId/run', async (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  const runId = uuidv4();
  runs.create({ id: runId, org_id: org.id, status: 'running' });
  orgs.touch(org.id);
  auditLog.append({ org_id: org.id, run_id: runId, action: 'AUDIT_STARTED', actor: 'user', detail: 'Full audit initiated' });

  runState.set(runId, { phase: 'collecting', progress: [], done: false, error: null });
  res.json({ runId });

  // Run async — client polls /runs/:runId for status
  setImmediate(async () => {
    const state = runState.get(runId);
    const creds = { clientId: org.client_id, clientSecret: org.client_secret, subdomain: org.subdomain, accountId: org.account_id };

    try {
      // Phase 1: Collect
      runs.updateStatus(runId, 'running', 'Collecting data from SFMC...');
      const context = await collectAll(creds, ({ label, index, total }) => {
        state.phase = `Collecting: ${label} (${index}/${total})`;
        state.progress.push({ ts: Date.now(), msg: `Collected ${label}` });
        runs.updateStatus(runId, 'running', state.phase);
      });

      contextCache.set(`${runId}:context`, org.id, 'full_context', context);

      // Phase 2: Findings
      state.phase = 'Analysing findings...';
      runs.updateStatus(runId, 'running', state.phase);
      const rawFindings = runAllRules(context);

      // Phase 3: AI summary
      state.phase = 'Generating AI summary...';
      runs.updateStatus(runId, 'running', state.phase);
      let aiSummary = null;
      try {
        aiSummary = await generateAISummary(context, rawFindings);
      } catch (e) {
        aiSummary = 'AI summary unavailable — check ANTHROPIC_API_KEY.';
      }

      // Persist findings
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
          emails:      (context.emails     || []).length,
          journeys:    (context.journeys   || []).length,
          automations: (context.automations|| []).length,
          dataExtensions: (context.dataExtensions || []).length,
          sqlQueries:  (context.sqlQueries || []).length,
          users:       (context.users      || []).length,
          recentSends: (context.recentSends|| []).length,
        },
        aiSummary,
      };

      runs.complete(runId, JSON.stringify(summary));
      state.phase = 'complete';
      state.done = true;
      auditLog.append({ org_id: org.id, run_id: runId, action: 'AUDIT_COMPLETE', actor: 'system', detail: `${withIds.length} findings` });

    } catch (err) {
      runs.fail(runId, err.message);
      state.done = true;
      state.error = err.message;
      auditLog.append({ org_id: org.id, run_id: runId, action: 'AUDIT_FAILED', actor: 'system', detail: err.message });
    }
  });
});

// ── Get run status + findings ─────────────────────────────────────────────────

router.get('/runs/:runId', (req, res) => {
  const run = runs.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const summary = run.summary_json ? JSON.parse(run.summary_json) : null;
  const state = runState.get(req.params.runId);

  // Calculate progress % from phase name
  const PHASE_LIST = ['Collecting: Email Assets', 'Collecting: Data Extensions', 'Collecting: Journeys', 'Collecting: Automations', 'Collecting: SQL Queries', 'Collecting: Send Definitions', 'Collecting: Event Definitions', 'Collecting: Send History', 'Collecting: Users', 'Analysing findings...', 'Generating AI summary...'];
  const currentPhase = state?.phase || run.phase || '';
  const phaseIdx = PHASE_LIST.findIndex(p => currentPhase.startsWith(p.split(':')[0]));
  const progress = phaseIdx >= 0 ? Math.round(((phaseIdx + 1) / PHASE_LIST.length) * 100) : (currentPhase === 'complete' ? 100 : 0);

  res.json({
    ...run,
    summary,
    ai_summary: summary?.aiSummary || null,
    finding_count: findingsDB.forRun(run.id).length,
    phase: currentPhase,
    progress,
  });
});

// ── List runs for org ─────────────────────────────────────────────────────────

router.get('/orgs/:orgId/runs', (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  res.json(runs.list(org.id));
});

// ── Get findings for a run ────────────────────────────────────────────────────

router.get('/runs/:runId/findings', (req, res) => {
  const { severity, category } = req.query;
  let items = findingsDB.forRun(req.params.runId);
  if (severity) items = items.filter(f => f.severity === severity.toUpperCase());
  if (category) items = items.filter(f => f.category === category);
  res.json(items);
});

// ── Get alerts (CRITICAL + HIGH) for org ─────────────────────────────────────

router.get('/orgs/:orgId/alerts', (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  res.json(findingsDB.critical(org.id));
});

// ── Spot-test a single asset / send ──────────────────────────────────────────

router.post('/orgs/:orgId/test', async (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  const { type, id } = req.body;
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });

  const creds = { clientId: org.client_id, clientSecret: org.client_secret, subdomain: org.subdomain, accountId: org.account_id };
  const { getAccessToken } = require('../services/sfmcAuth');
  const axios = require('axios');
  const { analyseAMPScript, analyseCompliance, analyseSubjectLine } = require('../engines/findingsEngine');

  try {
    const { accessToken, restBaseUrl } = await getAccessToken(creds);
    const http = axios.create({ baseURL: restBaseUrl, headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 });

    let result = {};

    if (type === 'email') {
      const { data } = await http.get(`/asset/v1/content/assets/${id}`);
      const html = data?.views?.html?.content || data?.content || '';
      const subject = data?.views?.subjectline?.content || '';
      result = {
        asset: { id: data.id, name: data.name, type: data.assetType?.name },
        findings: [
          ...analyseAMPScript(html, data.name, String(data.id)),
          ...analyseCompliance(html, data.name, String(data.id)),
          ...analyseSubjectLine(subject, data.name, String(data.id)),
        ],
      };
    } else if (type === 'journey') {
      const { data } = await http.get(`/interaction/v1/interactions/${id}`);
      result = { journey: { id: data.id, name: data.name, status: data.status, version: data.version }, findings: [] };
    } else if (type === 'automation') {
      const { data } = await http.get(`/automation/v1/automations/${id}`);
      result = { automation: { id: data.id, name: data.name, status: data.status, lastRunStatus: data.lastRunStatus }, findings: [] };
    } else {
      return res.status(400).json({ error: `Unsupported test type: ${type}` });
    }

    auditLog.append({ org_id: org.id, run_id: null, action: 'SPOT_TEST', actor: 'user', detail: `${type}:${id}` });

    // Normalise to { entity, findings, verdict }
    const entity   = result.asset || result.journey || result.automation || null;
    const findings = result.findings || [];
    const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const worst    = findings.reduce((w, f) => (sevOrder[f.severity] < sevOrder[w] ? f.severity : w), 'LOW');
    const verdict  = findings.length === 0 ? 'PASS' : worst === 'LOW' || worst === 'MEDIUM' ? 'REVIEW_REQUIRED' : 'FAIL';

    res.json({ entity, findings, verdict });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Latest context for org (for Context tab) ─────────────────────────────────

router.get('/orgs/:orgId/context', (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  const cached = contextCache.get(org.id, 'full_context');
  if (!cached) return res.json(null);
  res.json(cached);
});

// ── Audit log ─────────────────────────────────────────────────────────────────

router.get('/orgs/:orgId/log', (req, res) => {
  const org = orgs.get(req.params.orgId);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  res.json(auditLog.list(org.id, 500));
});

router.get('/log', (req, res) => {
  res.json(auditLog.all(500));
});

module.exports = router;
