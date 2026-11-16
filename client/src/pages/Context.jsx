import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { getOrgContext } from '../utils/api';

const SECTION_KEYS   = ['emails', 'dataExtensions', 'journeys', 'automations', 'sqlQueries', 'sendDefinitions', 'users'];
const SECTION_LABELS = { emails: 'Emails', dataExtensions: 'Data Extensions', journeys: 'Journeys', automations: 'Automations', sqlQueries: 'SQL Queries', sendDefinitions: 'Send Definitions', users: 'Users' };

const COLUMNS = {
  emails:          [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'id', label: 'ID', mono: true }],
  dataExtensions:  [{ key: 'name', label: 'Name' }, { key: 'customerKey', label: 'Key', mono: true }, { key: 'rowCount', label: 'Rows' }],
  journeys:        [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'version', label: 'Ver' }, { key: 'id', label: 'ID', mono: true }],
  automations:     [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'id', label: 'ID', mono: true }],
  sqlQueries:      [{ key: 'name', label: 'Name' }, { key: 'targetName', label: 'Target DE' }, { key: 'id', label: 'ID', mono: true }],
  sendDefinitions: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'id', label: 'Key', mono: true }],
  users:           [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'isActive', label: 'Active' }, { key: 'isLocked', label: 'Locked' }],
};

function CountBadge({ count }) {
  return <span style={{ background: 'var(--sf-blue-light)', color: 'var(--sf-blue-dark)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{count}</span>;
}

function SectionTable({ data, columns }) {
  if (!data || data.length === 0) return <div className="empty-state" style={{ padding: 20 }}><p>No items found.</p></div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {data.slice(0, 100).map((row, i) => (
            <tr key={i}>{columns.map(c => (
              <td key={c.key} style={c.mono ? { fontFamily: 'monospace', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}}>
                {row[c.key] === true ? '✓' : row[c.key] === false ? '✗' : row[c.key] ?? '—'}
              </td>
            ))}</tr>
          ))}
        </tbody>
      </table>
      {data.length > 100 && <div style={{ fontSize: 11, color: 'var(--sf-gray-500)', padding: 8 }}>Showing 100 of {data.length} items.</div>}
    </div>
  );
}

export default function Context() {
  const { activeOrg } = useOrg();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive]   = useState('emails');

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    getOrgContext(activeOrg.id).then(setContext).catch(() => setContext(null)).finally(() => setLoading(false));
  }, [activeOrg]);

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner spinner--lg" /></div>
  );

  if (!context) return (
    <div>
      <div className="page-header"><h1>Context</h1></div>
      <div className="empty-state">
        <div className="empty-state__icon">🔍</div>
        <h3>No data yet</h3>
        <p>Run a full scan on the Retrieve Data tab first.</p>
      </div>
    </div>
  );

  const data = context[active] || [];

  return (
    <div>
      <div className="page-header">
        <h1>Context</h1>
        <p>Collected objects from the latest scan for <strong>{activeOrg.name}</strong>.</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {SECTION_KEYS.map(k => (
          <button key={k} className={`btn ${active === k ? 'btn--primary' : 'btn--secondary'}`} onClick={() => setActive(k)} style={{ fontSize: 12 }}>
            {SECTION_LABELS[k]} <CountBadge count={(context[k] || []).length} />
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card__header">
          <span className="card__title">{SECTION_LABELS[active]}</span>
          <span className="text-muted">{data.length} items</span>
        </div>
        <SectionTable data={data} columns={COLUMNS[active] || []} />
      </div>
    </div>
  );
}
