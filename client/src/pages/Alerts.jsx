import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { getAlerts } from '../utils/api';

function AlertCard({ f }) {
  const cls = f.severity === 'CRITICAL' ? 'alert--error' : 'alert--warning';
  return (
    <div className={`alert ${cls}`} style={{ flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`badge badge--${f.severity.toLowerCase()}`}>{f.severity}</span>
        <strong style={{ fontSize: 13 }}>{f.title}</strong>
        {f.category && <span className="badge badge--info" style={{ marginLeft: 'auto', fontSize: 10 }}>{f.category}</span>}
      </div>
      <div style={{ fontSize: 13 }}>{f.detail}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}><strong>Remediation:</strong> {f.remediation}</div>
      {f.entity_name && (
        <div style={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.7 }}>
          {f.entity_type}: {f.entity_name} {f.entity_id && `(${f.entity_id})`}
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const { activeOrg } = useOrg();
  const [alerts, setAlerts]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const data = await getAlerts(activeOrg.id);
      setAlerts(data);
      setLoaded(true);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoaded(false); setAlerts([]); }, [activeOrg]);

  const critical = alerts.filter(a => a.severity === 'CRITICAL');
  const high     = alerts.filter(a => a.severity === 'HIGH');

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Alerts</h1>
        <p>CRITICAL and HIGH severity findings across all completed scans for this org.</p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn--primary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Load Alerts'}
        </button>
        <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--sf-gray-500)' }}>
          Alerts reflect the most recent completed scan.
        </span>
      </div>

      {/* Alert email UI placeholder */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header"><span className="card__title">Alert Delivery</span><span className="badge badge--info">Coming Soon</span></div>
        <p style={{ fontSize: 13, color: 'var(--sf-gray-500)' }}>
          Email delivery for alerts is not yet enabled. Enter a recipient address below to be notified when this feature is available.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="form-input" style={{ maxWidth: 280 }} type="email" placeholder="alerts@example.com" disabled />
          <button className="btn btn--secondary" disabled>Subscribe</button>
        </div>
      </div>

      {loaded && (
        <>
          <div className="stats-row" style={{ marginBottom: 20 }}>
            <div className="stat-card"><div className="stat-card__value" style={{ color: 'var(--sf-red)' }}>{critical.length}</div><div className="stat-card__label">Critical</div></div>
            <div className="stat-card"><div className="stat-card__value" style={{ color: 'var(--sf-orange)' }}>{high.length}</div><div className="stat-card__label">High</div></div>
            <div className="stat-card"><div className="stat-card__value">{alerts.length}</div><div className="stat-card__label">Total Alerts</div></div>
          </div>

          {alerts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">✅</div>
              <h3>No critical or high alerts</h3>
              <p>Your org looks clean — run a scan to get the latest results.</p>
            </div>
          ) : (
            <div>
              {critical.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--sf-red)' }}>Critical ({critical.length})</h2>
                  {critical.map(a => <AlertCard key={a.id} f={a} />)}
                </div>
              )}
              {high.length > 0 && (
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--sf-orange)' }}>High ({high.length})</h2>
                  {high.map(a => <AlertCard key={a.id} f={a} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
