import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { getAuditLog } from '../utils/api';

export default function AuditLog() {
  const { activeOrg } = useOrg();
  const [log, setLog]         = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try { setLog(await getAuditLog(activeOrg.id)); } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [activeOrg]);

  const actions = [...new Set(log.map(e => e.action))].sort();

  const filtered = log.filter(e => {
    const matchAction = actionFilter === 'all' || e.action === actionFilter;
    const matchText   = !filter || (e.detail || '').toLowerCase().includes(filter.toLowerCase()) || (e.action || '').toLowerCase().includes(filter.toLowerCase());
    return matchAction && matchText;
  });

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  const ACTION_BADGE = {
    AUDIT_STARTED:  'info',
    AUDIT_COMPLETE: 'success',
    AUDIT_FAILED:   'critical',
    SPOT_TEST:      'low',
    ORG_CREATED:    'info',
    ORG_UPDATED:    'info',
    ORG_DELETED:    'high',
    ORG_TESTED:     'low',
  };

  return (
    <div>
      <div className="page-header">
        <h1>Audit Log</h1>
        <p>Complete record of all scans, tests, and operations performed on this org.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ maxWidth: 280 }}
          placeholder="Search log…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <select className="form-select" style={{ maxWidth: 160 }} value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="all">All actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <button className="btn btn--secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--sf-gray-500)' }}>{filtered.length} entries</span>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon">📋</div><h3>No log entries</h3><p>Start a scan to see activity here.</p></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>Timestamp</th>
                <th style={{ width: 160 }}>Action</th>
                <th style={{ width: 80 }}>Actor</th>
                <th>Detail</th>
                <th style={{ width: 120 }}>Run ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td><span className={`badge badge--${ACTION_BADGE[e.action] || 'info'}`}>{e.action}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--sf-gray-500)' }}>{e.actor}</td>
                  <td style={{ fontSize: 12 }}>{e.detail}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--sf-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120, whiteSpace: 'nowrap' }}>{e.run_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
