import React, { useState, useEffect, useRef } from 'react';
import { useOrg } from '../context/OrgContext';
import { startRun, getRunStatus, listRuns } from '../utils/api';

const PHASES = ['Collecting email assets', 'Collecting data extensions', 'Collecting journeys', 'Collecting automations', 'Collecting SQL queries', 'Collecting send definitions', 'Collecting event definitions', 'Collecting send history', 'Collecting users', 'Generating findings', 'AI summary'];

function StatusBadge({ status }) {
  const map = { completed: 'success', running: 'info', failed: 'critical', pending: 'low' };
  return <span className={`badge badge--${map[status] || 'info'}`}>{status}</span>;
}

export default function RetrieveData() {
  const { activeOrg } = useOrg();
  const [runs, setRuns]       = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [starting, setStarting]   = useState(false);
  const [error, setError]         = useState('');
  const pollRef = useRef(null);

  const loadRuns = async () => {
    if (!activeOrg) return;
    try { setRuns(await listRuns(activeOrg.id)); } catch {}
  };

  useEffect(() => { loadRuns(); }, [activeOrg]);

  useEffect(() => {
    if (!activeRun) return;
    pollRef.current = setInterval(async () => {
      try {
        const s = await getRunStatus(activeRun);
        setRunStatus(s);
        if (s.status === 'completed' || s.status === 'failed') {
          clearInterval(pollRef.current);
          setActiveRun(null);
          loadRuns();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [activeRun]);

  const handleStart = async () => {
    if (!activeOrg) return;
    setError('');
    setStarting(true);
    try {
      const { runId } = await startRun(activeOrg.id);
      setActiveRun(runId);
      setRunStatus({ status: 'running', phase: 'Initialising…', progress: 0 });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setStarting(false);
    }
  };

  const isRunning = !!activeRun;
  const isDone = !isRunning && runStatus?.status === 'completed';
  const isFailed = !isRunning && runStatus?.status === 'failed';
  const pct = isDone ? 100 : (runStatus?.progress ?? 0);

  return (
    <div>
      <div className="page-header">
        <h1>Retrieve Data</h1>
        <p>Scan the entire Marketing Cloud instance to build a full inventory for auditing.</p>
      </div>

      {!activeOrg && (
        <div className="alert alert--warning">No org selected. Add and select an org using the dropdown in the top-right.</div>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header">
          <span className="card__title">Full Account Scan</span>
          <button className="btn btn--primary" onClick={handleStart} disabled={!activeOrg || isRunning || starting}>
            {isRunning ? 'Scanning…' : starting ? 'Starting…' : 'Start Scan'}
          </button>
        </div>

        {(isRunning || isDone || isFailed) && runStatus ? (
          <div>
            {isDone ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--sf-green)', marginBottom: 8 }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>✅</span>
                Scan complete
                {runStatus.finding_count != null && (
                  <span style={{ fontWeight: 400, color: 'var(--sf-gray-600)', fontSize: 13 }}>
                    — {runStatus.finding_count} finding{runStatus.finding_count !== 1 ? 's' : ''} generated
                  </span>
                )}
              </div>
            ) : isFailed ? (
              <div style={{ fontSize: 13, color: 'var(--sf-red)', marginBottom: 8 }}>Scan failed: {runStatus.phase}</div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--sf-gray-700)', marginBottom: 8 }}>
                {runStatus.phase || 'Initialising…'}
              </div>
            )}

            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${pct}%`, background: isDone ? 'var(--sf-green)' : undefined }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--sf-gray-500)', marginTop: 4 }}>{pct}%</div>

            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 4 }}>
              {PHASES.map((ph, i) => {
                const allDone = isDone;
                const idx = allDone ? PHASES.length : PHASES.indexOf(runStatus.phase);
                const done = allDone || idx > i;
                const active = !allDone && idx === i;
                return (
                  <div key={ph} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: done ? 'var(--sf-green)' : active ? 'var(--sf-blue)' : 'var(--sf-gray-300)' }}>
                    <span>{done ? '✓' : active ? '▶' : '○'}</span>
                    <span>{ph}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--sf-gray-500)' }}>
            The scan collects emails, journeys, automations, data extensions, SQL queries, send definitions, event definitions, users, and recent send metrics. Findings are generated automatically on completion.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card__header"><span className="card__title">Recent Scans</span></div>
        {runs.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon">📋</div><h3>No scans yet</h3><p>Run a scan above to get started.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Run ID</th><th>Status</th><th>Started</th><th>Findings</th><th>Duration</th></tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td><span className="truncate" style={{ maxWidth: 160, display: 'block', fontFamily: 'monospace', fontSize: 11 }}>{r.id}</span></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td>{r.finding_count ?? '—'}</td>
                  <td>{r.completed_at ? Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000) + 's' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
