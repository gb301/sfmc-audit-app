import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { listRuns, getFindings, getRun } from '../utils/api';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';

const SEV_COLORS = { CRITICAL: '#c23934', HIGH: '#dd7a01', MEDIUM: '#f4b942', LOW: '#0070d2' };
const CAT_COLORS = ['#0070d2', '#032d60', '#2e844a', '#dd7a01', '#c23934', '#706e6b', '#9e57d0', '#00a1e0'];

function SevBadge({ sev }) {
  return <span className={`badge badge--${sev.toLowerCase()}`}>{sev}</span>;
}

export default function Summary() {
  const { activeOrg } = useOrg();
  const [runs, setRuns]         = useState([]);
  const [runId, setRunId]       = useState('');
  const [findings, setFindings] = useState([]);
  const [runMeta, setRunMeta]   = useState(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (!activeOrg) return;
    listRuns(activeOrg.id).then(r => {
      setRuns(r);
      const done = r.find(x => x.status === 'completed');
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

  const sevCounts = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => ({
    name: s,
    count: findings.filter(f => f.severity === s).length,
  }));

  const catMap = {};
  findings.forEach(f => { catMap[f.category] = (catMap[f.category] || 0) + 1; });
  const catData = Object.entries(catMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  const radarData = catData.map(d => ({ subject: d.name, value: d.count }));

  const aiSummary = runMeta?.ai_summary;
  const duration = runMeta?.completed_at && runMeta?.started_at
    ? Math.round((new Date(runMeta.completed_at) - new Date(runMeta.started_at)) / 1000)
    : null;

  const scoreColor = sevCounts[0].count > 0 ? '#c23934' : sevCounts[1].count > 2 ? '#dd7a01' : sevCounts[1].count > 0 ? '#f4b942' : '#2e844a';
  const scoreLabel = sevCounts[0].count > 0 ? 'Critical Risk' : sevCounts[1].count > 2 ? 'High Risk' : sevCounts[1].count > 0 ? 'Moderate Risk' : 'Low Risk';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>General Summary</h1>
          <p>AI-generated executive summary with recommendations from the latest scan.</p>
        </div>
        <select className="form-select" style={{ maxWidth: 360 }} value={runId} onChange={e => setRunId(e.target.value)}>
          <option value="">Select scan…</option>
          {runs.filter(r => r.status === 'completed').map(r => (
            <option key={r.id} value={r.id}>{r.id} — {new Date(r.started_at).toLocaleString()}</option>
          ))}
        </select>
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner spinner--lg" /></div>}

      {!loading && findings.length === 0 && runId && (
        <div className="empty-state"><div className="empty-state__icon">📊</div><h3>No findings for this run</h3></div>
      )}

      {!loading && findings.length > 0 && (
        <>
          {/* Score banner */}
          <div className="card" style={{ marginBottom: 20, borderLeft: `4px solid ${scoreColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
              <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--sf-gray-700)', whiteSpace: 'pre-wrap' }}>{aiSummary}</div>
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
            <div className="card__header"><span className="card__title">Top Findings to Address</span></div>
            <table className="data-table">
              <thead><tr><th>Priority</th><th>Severity</th><th>Finding</th><th>Entity</th></tr></thead>
              <tbody>
                {findings
                  .sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.severity) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.severity))
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
