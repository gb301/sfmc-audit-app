import React, { useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { spotTest } from '../utils/api';

const TYPES = [
  { value: 'email',      label: 'Email Asset' },
  { value: 'journey',    label: 'Journey' },
  { value: 'automation', label: 'Automation' },
];

function SevBadge({ sev }) {
  return <span className={`badge badge--${sev.toLowerCase()}`}>{sev}</span>;
}

export default function TestingCenter() {
  const { activeOrg } = useOrg();
  const [type, setType]       = useState('email');
  const [id, setId]           = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');

  const handleTest = async () => {
    if (!id.trim()) return;
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const data = await spotTest(activeOrg.id, type, id.trim());
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Testing Center</h1>
        <p>Spot-test a single asset by its ID without running a full account scan.</p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header"><span className="card__title">Spot Test</span></div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label className="form-label">Type</label>
            <select className="form-select" value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label">{type === 'email' ? 'Asset ID' : type === 'journey' ? 'Journey ID (UUID or key:…)' : 'Automation ID'}</label>
            <input
              className="form-input"
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder={type === 'email' ? 'e.g. 1751109' : type === 'journey' ? 'e.g. key:my-journey-key' : 'e.g. abc123...'}
              onKeyDown={e => e.key === 'Enter' && handleTest()}
            />
          </div>

          <button className="btn btn--primary" onClick={handleTest} disabled={!id.trim() || loading} style={{ marginBottom: 0 }}>
            {loading ? 'Testing…' : 'Run Test'}
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--sf-gray-500)', marginTop: 8 }}>
          Finds the asset, runs relevant rules, and returns findings. Does not modify anything.
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {result && (
        <div className="card">
          <div className="card__header">
            <span className="card__title">
              {result.entity?.name || id}
            </span>
            <span className={`badge badge--${result.verdict === 'PASS' ? 'success' : result.verdict === 'REVIEW_REQUIRED' ? 'high' : 'critical'}`}>{result.verdict}</span>
          </div>

          {result.findings?.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <div className="empty-state__icon">✅</div>
              <h3>No findings</h3>
              <p>This asset passed all checks.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Remediation</th></tr></thead>
              <tbody>
                {result.findings.map(f => (
                  <tr key={f.id}>
                    <td><SevBadge sev={f.severity} /></td>
                    <td>{f.category}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--sf-gray-500)', marginTop: 2 }}>{f.detail}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--sf-gray-700)' }}>{f.remediation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
