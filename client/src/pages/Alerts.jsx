import React, { useState, useEffect } from 'react';
import { useOrg } from '../context/OrgContext';
import { getAlerts, getNotifications, updateNotifications, triggerScheduledRun } from '../utils/api';

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
  const [alerts, setAlerts]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);

  // Notification settings
  const [alertEmail, setAlertEmail]         = useState('');
  const [alertThreshold, setAlertThreshold] = useState('CRITICAL_AND_HIGH');
  const [notifSaving, setNotifSaving]       = useState(false);
  const [notifSaved, setNotifSaved]         = useState(false);
  const [notifError, setNotifError]         = useState('');
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerMsg, setTriggerMsg]         = useState('');

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

  useEffect(() => {
    setLoaded(false);
    setAlerts([]);
    setNotifSaved(false);
    setNotifError('');
    setTriggerMsg('');
    if (activeOrg) {
      getNotifications(activeOrg.id)
        .then(d => { setAlertEmail(d.alertEmail || ''); setAlertThreshold(d.alertThreshold || 'CRITICAL_AND_HIGH'); })
        .catch(() => {});
    }
  }, [activeOrg]);

  const saveNotifications = async () => {
    if (!activeOrg) return;
    setNotifSaving(true);
    setNotifSaved(false);
    setNotifError('');
    try {
      await updateNotifications(activeOrg.id, { alertEmail, alertThreshold });
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 3000);
    } catch (e) {
      setNotifError(e.response?.data?.error || e.message);
    } finally {
      setNotifSaving(false);
    }
  };

  const handleTriggerRun = async () => {
    if (!activeOrg) return;
    setTriggerLoading(true);
    setTriggerMsg('');
    try {
      await triggerScheduledRun(activeOrg.id);
      setTriggerMsg('Scheduled audit run started. Check Recent Scans in a few minutes.');
    } catch (e) {
      setTriggerMsg(`Error: ${e.response?.data?.error || e.message}`);
    } finally {
      setTriggerLoading(false);
    }
  };

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

      {/* Alert email notification settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header">
          <span className="card__title">Alert Delivery</span>
          <span className="badge badge--success" style={{ fontSize: 10 }}>via SFMC</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--sf-gray-600)', marginBottom: 16 }}>
          When a nightly audit detects new findings above your threshold, an alert email is sent via Salesforce Marketing Cloud Transactional Messaging.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label className="form-label">Alert Recipient Email</label>
            <input
              className="form-input"
              type="email"
              placeholder="alerts@example.com"
              value={alertEmail}
              onChange={e => setAlertEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Alert Threshold</label>
            <select
              className="form-select"
              value={alertThreshold}
              onChange={e => setAlertThreshold(e.target.value)}
            >
              <option value="CRITICAL_AND_HIGH">Critical &amp; High findings</option>
              <option value="CRITICAL_ONLY">Critical findings only</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn--primary" onClick={saveNotifications} disabled={notifSaving}>
            {notifSaving ? 'Saving…' : 'Save Settings'}
          </button>
          {notifSaved && <span style={{ fontSize: 12, color: 'var(--sf-green)' }}>✓ Saved</span>}
          {notifError && <span style={{ fontSize: 12, color: 'var(--sf-red)' }}>{notifError}</span>}
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--sf-gray-200)' }}>
          <div style={{ fontSize: 12, color: 'var(--sf-gray-500)', marginBottom: 8 }}>
            Nightly audits run at 02:00 UTC. You can also trigger a run manually:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn--secondary" onClick={handleTriggerRun} disabled={triggerLoading}>
              {triggerLoading ? 'Starting…' : 'Run Audit Now'}
            </button>
            {triggerMsg && (
              <span style={{ fontSize: 12, color: triggerMsg.startsWith('Error') ? 'var(--sf-red)' : 'var(--sf-green)' }}>
                {triggerMsg}
              </span>
            )}
          </div>
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
