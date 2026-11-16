import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { listRuns, getFindings } from '../utils/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const SEV_ORDER   = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const SEV_COLORS  = { CRITICAL: '#c23934', HIGH: '#dd7a01', MEDIUM: '#f4b942', LOW: '#0070d2' };

// Maps the engine's snake_case category keys to display labels and groups
const CAT_MAP = [
  { key: 'All',          label: 'All',             match: null },
  { key: 'ampscript',    label: 'AMPScript',        match: ['ampscript'] },
  { key: 'compliance',   label: 'Compliance',       match: ['compliance', 'accessibility'] },
  { key: 'subject_line', label: 'Subject Line',     match: ['subject_line'] },
  { key: 'journey',      label: 'Journey',          match: ['journey'] },
  { key: 'automation',   label: 'Automation',       match: ['automation'] },
  { key: 'data',         label: 'Data Extensions',  match: ['data_hygiene', 'data_extension'] },
  { key: 'sql',          label: 'SQL',              match: ['sql_quality'] },
  { key: 'deliverability',label: 'Send Metrics',    match: ['deliverability'] },
  { key: 'users',        label: 'User Management',  match: ['access_control'] },
];

function SevBadge({ sev }) {
  return <span className={`badge badge--${sev.toLowerCase()}`}>{sev}</span>;
}

function FindingRow({ f }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <td><SevBadge sev={f.severity} /></td>
        <td>{f.category}</td>
        <td>{f.title}</td>
        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.entity_name || '—'}</td>
        <td>{f.entity_type || '—'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--sf-gray-50)', padding: '12px 16px' }}>
            <div style={{ marginBottom: 8 }}><strong>Detail:</strong> {f.detail}</div>
            <div><strong>Remediation:</strong> {f.remediation}</div>
            {f.entity_id && <div style={{ marginTop: 6, fontSize: 11, fontFamily: 'monospace', color: 'var(--sf-gray-500)' }}>ID: {f.entity_id}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Findings() {
  const { activeOrg } = useOrg();
  const [runs, setRuns]         = useState([]);
  const [runId, setRunId]       = useState('');
  const [findings, setFindings] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [sevFilter, setSevFilter]   = useState('All');
  const [catFilter, setCatFilter]   = useState('All');

  useEffect(() => {
    if (!activeOrg) return;
    listRuns(activeOrg.id).then(r => {
      setRuns(r);
      const done = r.find(x => x.status === 'complete');
      if (done) setRunId(done.id);
    }).catch(() => {});
  }, [activeOrg]);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getFindings(runId).then(setFindings).catch(() => {}).finally(() => setLoading(false));
  }, [runId]);

  const counts = SEV_ORDER.map(s => ({ name: s, count: findings.filter(f => f.severity === s).length }));

  const activeCat = CAT_MAP.find(c => c.key === catFilter) || CAT_MAP[0];
  const filtered = findings.filter(f =>
    (sevFilter === 'All' || f.severity === sevFilter) &&
    (activeCat.match === null || activeCat.match.includes(f.category))
  );

  // Count per category group for badge display
  const catCounts = Object.fromEntries(
    CAT_MAP.filter(c => c.match).map(c => [c.key, findings.filter(f => c.match.includes(f.category)).length])
  );

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Findings</h1>
        <p>All findings generated from the latest account scan.</p>
      </div>

      {/* Run selector */}
      <div style={{ marginBottom: 16 }}>
        <select className="form-select" style={{ maxWidth: 360 }} value={runId} onChange={e => setRunId(e.target.value)}>
          <option value="">Select a scan run…</option>
          {runs.filter(r => r.status === 'complete').map(r => (
            <option key={r.id} value={r.id}>{r.id} — {new Date(r.started_at).toLocaleString()}</option>
          ))}
        </select>
      </div>

      {/* Chart */}
      {findings.length > 0 && (
        <div className="stats-row" style={{ marginBottom: 20 }}>
          {SEV_ORDER.map(s => (
            <div key={s} className="stat-card" onClick={() => setSevFilter(sev => sev === s ? 'All' : s)} style={{ cursor: 'pointer', borderColor: sevFilter === s ? SEV_COLORS[s] : 'var(--sf-gray-100)' }}>
              <div className="stat-card__value" style={{ color: SEV_COLORS[s] }}>{counts.find(c => c.name === s)?.count || 0}</div>
              <div className="stat-card__label">{s}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {CAT_MAP.map(c => {
          const n = c.match ? catCounts[c.key] : findings.length;
          return (
            <button key={c.key} className={`btn ${catFilter === c.key ? 'btn--primary' : 'btn--secondary'}`} style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setCatFilter(c.key)}>
              {c.label}{n > 0 ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      <div className="card">
        <div className="card__header">
          <span className="card__title">Findings {filtered.length !== findings.length && `(${filtered.length} / ${findings.length})`}</span>
          {(sevFilter !== 'All' || catFilter !== 'All') && <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => { setSevFilter('All'); setCatFilter('All'); }}>Clear filters</button>}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon">✅</div><h3>{findings.length === 0 ? 'No findings' : 'No matching findings'}</h3></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Entity</th><th>Type</th></tr></thead>
            <tbody>{filtered.map(f => <FindingRow key={f.id} f={f} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
