import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { listRuns, getFindings, getRun } from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const SEV_COLORS = { CRITICAL: '#c23934', HIGH: '#dd7a01', MEDIUM: '#f4b942', LOW: '#0070d2' };
const CAT_COLORS = ['#0070d2', '#032d60', '#2e844a', '#dd7a01', '#c23934', '#706e6b', '#9e57d0', '#00a1e0'];
const SEV_ORDER  = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function SevBadge({ sev }) {
  return <span className={`badge badge--${sev.toLowerCase()}`}>{sev}</span>;
}

function SimpleMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let key = 0;
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      const content = line.replace(/^#+\s/, '');
      elements.push(<div key={key++} style={{ fontWeight: 700, fontSize: 15, marginTop: 14, marginBottom: 4, color: 'var(--sf-gray-900)' }}>{content}</div>);
    } else if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid var(--sf-gray-200)', margin: '10px 0' }} />);
    } else if (/^\s*[-*]\s/.test(line)) {
      const content = renderInline(line.replace(/^\s*[-*]\s/, ''));
      elements.push(<div key={key++} style={{ paddingLeft: 16, marginBottom: 2 }}>• {content}</div>);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} style={{ height: 6 }} />);
    } else {
      elements.push(<div key={key++} style={{ marginBottom: 2 }}>{renderInline(line)}</div>);
    }
  }
  return <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--sf-gray-700)' }}>{elements}</div>;
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p
  );
}

function buildProseReport(findings, runMeta, orgName, context) {
  if (!findings.length) return '';
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  findings.forEach(f => { counts[f.severity] = (counts[f.severity] || 0) + 1; });
  const total = findings.length;
  const scanDate = runMeta ? new Date(runMeta.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'recently';
  const ctx = context || {};

  const riskLevel = counts.CRITICAL > 0 ? 'critical' : counts.HIGH > 2 ? 'high' : counts.HIGH > 0 ? 'moderate' : 'low';
  const riskSentence = {
    critical: 'The account is in a critical state and requires immediate attention.',
    high: 'The account has significant issues that should be addressed as a priority.',
    moderate: 'The account is broadly healthy but has several issues requiring attention.',
    low: 'The account is in good health with only minor issues identified.',
  }[riskLevel];

  const catMap = {};
  findings.forEach(f => { catMap[f.category] = (catMap[f.category] || 0) + 1; });
  const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

  const criticals = findings.filter(f => f.severity === 'CRITICAL').slice(0, 5);
  const highs = findings.filter(f => f.severity === 'HIGH').slice(0, 5);

  const lines = [];
  lines.push(`SFMC Audit Report — ${orgName}`);
  lines.push(`Prepared: ${scanDate}`);
  lines.push('');
  lines.push('OVERVIEW');
  lines.push('--------');
  lines.push(`An automated audit of the ${orgName} Salesforce Marketing Cloud account was completed on ${scanDate}. The scan reviewed ${ctx.emails || 0} email assets, ${ctx.dataExtensions || 0} data extensions, ${ctx.journeys || 0} active journeys, ${ctx.automations || 0} automations, and ${ctx.users || 0} user accounts. ${total} findings were identified across four severity levels: ${counts.CRITICAL} critical, ${counts.HIGH} high, ${counts.MEDIUM} medium, and ${counts.LOW} low.`);
  lines.push('');
  lines.push(`${riskSentence} The most prevalent issue categories are ${topCats.join(', ')}.`);

  if (criticals.length) {
    lines.push('');
    lines.push('CRITICAL ISSUES (Immediate Action Required)');
    lines.push('-------------------------------------------');
    criticals.forEach(f => {
      lines.push(`• ${f.title}${f.entity_name ? ` (${f.entity_name})` : ''}`);
      if (f.detail) lines.push(`  Detail: ${f.detail}`);
      if (f.remediation) lines.push(`  Action: ${f.remediation}`);
    });
  }

  if (highs.length) {
    lines.push('');
    lines.push('HIGH PRIORITY ISSUES');
    lines.push('--------------------');
    highs.forEach(f => {
      lines.push(`• ${f.title}${f.entity_name ? ` (${f.entity_name})` : ''}`);
      if (f.remediation) lines.push(`  Action: ${f.remediation}`);
    });
  }

  lines.push('');
  lines.push('FINDINGS BREAKDOWN');
  lines.push('------------------');
  Object.entries(catMap).sort((a, b) => b[1] - a[1]).forEach(([cat, n]) => {
    lines.push(`${cat}: ${n}`);
  });

  lines.push('');
  lines.push('RECOMMENDED NEXT STEPS');
  lines.push('----------------------');
  if (counts.CRITICAL > 0) lines.push(`1. Resolve all ${counts.CRITICAL} critical findings immediately — these represent active risks to deliverability or data integrity.`);
  if (counts.HIGH > 0) lines.push(`${counts.CRITICAL > 0 ? 2 : 1}. Address the ${counts.HIGH} high-severity findings within the next sprint cycle.`);
  lines.push(`${[counts.CRITICAL > 0, counts.HIGH > 0].filter(Boolean).length + 1}. Review medium findings and schedule remediation based on business impact.`);
  lines.push(`${[counts.CRITICAL > 0, counts.HIGH > 0, true].filter(Boolean).length + 1}. Re-run the audit after remediation to confirm resolution.`);

  return lines.join('\n');
}

export default function Summary() {
  const { activeOrg } = useOrg();
  const [runs, setRuns]         = useState([]);
  const [runId, setRunId]       = useState('');
  const [findings, setFindings] = useState([]);
  const [runMeta, setRunMeta]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [copied, setCopied]     = useState(false);
  const [reportView, setReportView] = useState('dashboard'); // 'dashboard' | 'report'

  useEffect(() => {
    if (!activeOrg) return;
    listRuns(activeOrg.id).then(r => {
      setRuns(r);
      const done = r.find(x => x.status === 'complete');
      if (done) { setRunId(done.id); setRunMeta(done); }
    });
  }, [activeOrg]);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    Promise.all([getFindings(runId), getRun(runId)])
      .then(([f, r]) => { setFindings(f); setRunMeta(r); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [runId]);

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  const sevCounts = SEV_ORDER.map(s => ({ name: s, count: findings.filter(f => f.severity === s).length }));
  const catMap = {};
  findings.forEach(f => { catMap[f.category] = (catMap[f.category] || 0) + 1; });
  const catData = Object.entries(catMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const aiSummary = runMeta?.ai_summary;
  const duration = runMeta?.completed_at && runMeta?.started_at
    ? Math.round((new Date(runMeta.completed_at) - new Date(runMeta.started_at)) / 1000)
    : null;

  const scoreColor = sevCounts[0].count > 0 ? '#c23934' : sevCounts[1].count > 2 ? '#dd7a01' : sevCounts[1].count > 0 ? '#f4b942' : '#2e844a';
  const scoreLabel = sevCounts[0].count > 0 ? 'Critical Risk' : sevCounts[1].count > 2 ? 'High Risk' : sevCounts[1].count > 0 ? 'Moderate Risk' : 'Low Risk';

  const contextData = runMeta?.summary ? (typeof runMeta.summary === 'string' ? JSON.parse(runMeta.summary) : runMeta.summary)?.context : null;
  const proseReport = buildProseReport(findings, runMeta, activeOrg.name, contextData);

  const handleCopy = () => {
    const text = aiSummary ? `${aiSummary}\n\n---\n\n${proseReport}` : proseReport;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>General Summary</h1>
          <p>Executive summary and audit report for upward reporting.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {findings.length > 0 && (
            <>
              <button className={`btn ${reportView === 'dashboard' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setReportView('dashboard')}>Dashboard</button>
              <button className={`btn ${reportView === 'report' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setReportView('report')}>Report</button>
            </>
          )}
          <select className="form-select" style={{ maxWidth: 260 }} value={runId} onChange={e => setRunId(e.target.value)}>
            <option value="">Select scan…</option>
            {runs.filter(r => r.status === 'complete').map(r => (
              <option key={r.id} value={r.id}>{new Date(r.started_at).toLocaleString()}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner spinner--lg" /></div>}

      {!loading && !runId && runs.filter(r => r.status === 'complete').length === 0 && (
        <div className="empty-state"><div className="empty-state__icon">📊</div><h3>No completed scans yet</h3><p>Run a scan from the Retrieve Data tab to see your summary here.</p></div>
      )}

      {!loading && findings.length > 0 && reportView === 'report' && (
        <div className="card">
          <div className="card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card__title">Audit Report</span>
            <button className="btn btn--secondary" style={{ fontSize: 12 }} onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy to clipboard'}
            </button>
          </div>
          {aiSummary && (
            <div style={{ marginBottom: 24, padding: '16px 0', borderBottom: '1px solid var(--sf-gray-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>AI Executive Summary</span>
                <span className="badge badge--info">Claude AI</span>
              </div>
              <SimpleMarkdown text={aiSummary} />
            </div>
          )}
          <pre style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.65, color: 'var(--sf-gray-700)', whiteSpace: 'pre-wrap', margin: 0 }}>{proseReport}</pre>
        </div>
      )}

      {!loading && findings.length > 0 && reportView === 'dashboard' && (
        <>
          {/* Score banner */}
          <div className="card" style={{ marginBottom: 20, borderLeft: `4px solid ${scoreColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: scoreColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{findings.length}</span>
                <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase' }}>findings</span>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor }}>{scoreLabel}</div>
                <div style={{ fontSize: 13, color: 'var(--sf-gray-500)', marginTop: 2 }}>
                  {activeOrg.name} &mdash; Scanned {runMeta ? new Date(runMeta.started_at).toLocaleString() : ''}
                  {duration ? ` in ${duration}s` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
                {sevCounts.map(s => (
                  <div key={s.name} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: SEV_COLORS[s.name] }}>{s.count}</div>
                    <div style={{ fontSize: 10, color: 'var(--sf-gray-500)', textTransform: 'uppercase' }}>{s.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI summary */}
          {aiSummary && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card__header"><span className="card__title">AI Executive Summary</span><span className="badge badge--info">Claude AI</span></div>
              <SimpleMarkdown text={aiSummary} />
            </div>
          )}

          {/* Charts */}
          <div className="grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card__header"><span className="card__title">Findings by Severity</span></div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sevCounts} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [v, 'Findings']} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {sevCounts.map(e => <Cell key={e.name} fill={SEV_COLORS[e.name]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div className="card__header"><span className="card__title">Findings by Category</span></div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={catData.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 0, left: 60, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={60} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                    {catData.slice(0, 8).map((e, i) => <Cell key={e.name} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top findings table */}
          <div className="card">
            <div className="card__header">
              <span className="card__title">Top Findings to Address</span>
              <button className="btn btn--secondary" style={{ fontSize: 12 }} onClick={() => setReportView('report')}>View full report →</button>
            </div>
            <table className="data-table">
              <thead><tr><th>Priority</th><th>Severity</th><th>Finding</th><th>Entity</th></tr></thead>
              <tbody>
                {findings
                  .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
                  .slice(0, 10)
                  .map((f, i) => (
                    <tr key={f.id}>
                      <td style={{ fontWeight: 700, color: 'var(--sf-gray-500)' }}>#{i + 1}</td>
                      <td><SevBadge sev={f.severity} /></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{f.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--sf-gray-500)' }}>{f.remediation}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{f.entity_name || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
