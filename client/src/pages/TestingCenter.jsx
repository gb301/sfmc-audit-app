import React, { useState, useEffect, useRef } from 'react';
import { useOrg } from '../context/OrgContext';
import { spotTest, getOrgContext, previewEmail, getSendableDEs } from '../utils/api';

const TYPES = [
  { value: 'email',      label: 'Email Asset' },
  { value: 'journey',    label: 'Journey' },
  { value: 'automation', label: 'Automation' },
];

const SEV_COLORS = {
  CRITICAL: '#c23934',
  HIGH: '#dd7a01',
  MEDIUM: '#f4b942',
  LOW: '#0070d2',
};

const SEV_BG = {
  CRITICAL: '#fdf0ef',
  HIGH: '#fef5e7',
  MEDIUM: '#fffae8',
  LOW: '#e8f4ff',
};

function SevBadge({ sev }) {
  return <span className={`badge badge--${sev.toLowerCase()}`}>{sev}</span>;
}

// Inject <mark> wrappers around detected patterns in HTML for visual highlighting
function annotateHtml(html, findings) {
  let annotated = html;
  findings.forEach((f, i) => {
    if (!f.pattern) return;
    try {
      const esc = f.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc, 'g');
      const color = SEV_COLORS[f.severity] || '#888';
      const bg = SEV_BG[f.severity] || '#ffe';
      annotated = annotated.replace(re, match =>
        `<mark data-finding="${i}" style="background:${bg};outline:2px solid ${color};border-radius:2px;cursor:pointer;" title="${f.title.replace(/"/g, '&quot;')}">${match}</mark>`
      );
    } catch (_) {}
  });
  return annotated;
}

export default function TestingCenter() {
  const { activeOrg } = useOrg();

  // Spot-test state
  const [type, setType]       = useState('email');
  const [assetId, setAssetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');

  // Preview state
  const [emails, setEmails]         = useState([]);
  const [sendableDEs, setSendableDEs] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedDE, setSelectedDE]       = useState('');
  const [rowIndex, setRowIndex]           = useState(0);
  const [deRows, setDeRows]               = useState([]);
  const [preview, setPreview]             = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]     = useState('');
  const [activeTab, setActiveTab]         = useState('findings'); // 'findings' | 'preview'
  const [selectedFinding, setSelectedFinding] = useState(null);
  const iframeRef = useRef(null);

  // Load email list and DEs from org context
  useEffect(() => {
    if (!activeOrg) return;
    getOrgContext(activeOrg.id).then(ctx => {
      if (ctx?.emails) setEmails(ctx.emails.slice().sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
    getSendableDEs(activeOrg.id).then(des => {
      setSendableDEs(des.slice().sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
  }, [activeOrg]);

  const handleTest = async () => {
    const id = type === 'email' && selectedEmail ? selectedEmail : assetId.trim();
    if (!id) return;
    setError('');
    setResult(null);
    setPreview(null);
    setLoading(true);
    try {
      const data = await spotTest(activeOrg.id, type, id);
      setResult(data);
      // Auto-load preview for email type
      if (type === 'email') {
        loadPreview(id, selectedDE, rowIndex);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (emailIdOverride, deKeyOverride, rowIndexOverride) => {
    const emailId = emailIdOverride ?? (selectedEmail || assetId.trim());
    const deKey   = deKeyOverride ?? selectedDE;
    const idx     = rowIndexOverride ?? rowIndex;
    if (!emailId) return;

    setPreviewError('');
    setPreviewLoading(true);
    try {
      const data = await previewEmail(activeOrg.id, emailId, deKey || null, idx);
      setPreview(data);
      setActiveTab('preview');
    } catch (e) {
      setPreviewError(e.response?.data?.error || e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Write annotated HTML into iframe when preview changes
  useEffect(() => {
    if (!iframeRef.current || !preview) return;
    const findings = result?.findings || preview.findings || [];
    const annotated = annotateHtml(preview.html, findings);
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(annotated);
      doc.close();
      // Forward mark clicks to parent
      doc.addEventListener('click', e => {
        const mark = e.target.closest('mark[data-finding]');
        if (!mark) return;
        const idx = parseInt(mark.getAttribute('data-finding'), 10);
        const f = findings[idx];
        if (f) setSelectedFinding(f);
      });
    }
  }, [preview, result]);

  const effectiveId = type === 'email' && selectedEmail ? selectedEmail : assetId.trim();
  const findings = result?.findings || [];
  const previewFindings = preview?.findings || [];
  const allFindings = findings.length ? findings : previewFindings;

  if (!activeOrg) return <div className="alert alert--warning">No org selected.</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Testing Center</h1>
        <p>Analyse a single asset, preview rendered HTML, and highlight issues.</p>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header"><span className="card__title">Test Configuration</span></div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
            <label className="form-label">Asset Type</label>
            <select className="form-select" value={type} onChange={e => { setType(e.target.value); setResult(null); setPreview(null); }}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {type === 'email' && emails.length > 0 ? (
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
              <label className="form-label">Email Asset</label>
              <select className="form-select" value={selectedEmail} onChange={e => { setSelectedEmail(e.target.value); setResult(null); setPreview(null); }}>
                <option value="">— select email —</option>
                {emails.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <label className="form-label">{type === 'email' ? 'Asset ID' : type === 'journey' ? 'Journey ID (UUID or key:…)' : 'Automation ID'}</label>
              <input
                className="form-input"
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                placeholder={type === 'email' ? 'e.g. 1751109' : type === 'journey' ? 'e.g. key:my-journey-key' : 'e.g. abc123'}
                onKeyDown={e => e.key === 'Enter' && handleTest()}
              />
            </div>
          )}

          {type === 'email' && (
            <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
              <label className="form-label">Preview against DE <span style={{ color: 'var(--sf-gray-400)', fontWeight: 400 }}>(optional)</span></label>
              <select className="form-select" value={selectedDE} onChange={e => setSelectedDE(e.target.value)}>
                <option value="">— no personalisation —</option>
                {sendableDEs.map(d => <option key={d.customerKey} value={d.customerKey}>{d.name}</option>)}
              </select>
            </div>
          )}

          {type === 'email' && selectedDE && (
            <div className="form-group" style={{ marginBottom: 0, minWidth: 90 }}>
              <label className="form-label">Row #</label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={rowIndex}
                onChange={e => setRowIndex(Number(e.target.value))}
                style={{ width: 70 }}
              />
            </div>
          )}

          <button
            className="btn btn--primary"
            onClick={handleTest}
            disabled={!effectiveId || loading}
            style={{ marginBottom: 0 }}
          >
            {loading ? 'Testing…' : 'Run Analysis'}
          </button>

          {type === 'email' && effectiveId && !loading && (
            <button
              className="btn btn--secondary"
              onClick={() => loadPreview(effectiveId, selectedDE, rowIndex)}
              disabled={previewLoading}
              style={{ marginBottom: 0 }}
            >
              {previewLoading ? 'Loading…' : 'Preview Only'}
            </button>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--sf-gray-500)', marginTop: 8 }}>
          Runs issue analysis and renders the email HTML with highlighted problem areas. Does not modify anything.
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {previewError && <div className="alert alert--error">{previewError}</div>}

      {/* Results */}
      {(result || preview) && (
        <div>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>
              {result?.entity?.name || preview?.emailName || effectiveId}
            </h2>
            {result && (
              <span className={`badge badge--${result.verdict === 'PASS' ? 'success' : result.verdict === 'REVIEW_REQUIRED' ? 'high' : 'critical'}`}>
                {result.verdict}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--sf-gray-500)' }}>
              {allFindings.length} finding{allFindings.length !== 1 ? 's' : ''}
            </span>
            {preview?.deRow && (
              <span style={{ fontSize: 12, color: 'var(--sf-gray-500)' }}>
                · personalised from row {rowIndex}
              </span>
            )}
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {['findings', 'preview'].map(tab => (
              <button
                key={tab}
                className={`btn ${activeTab === tab ? 'btn--primary' : 'btn--secondary'}`}
                style={{ fontSize: 12, padding: '4px 12px', textTransform: 'capitalize' }}
                onClick={() => setActiveTab(tab)}
                disabled={tab === 'preview' && !preview}
              >
                {tab === 'findings' ? `Findings (${allFindings.length})` : 'Email Preview'}
              </button>
            ))}
          </div>

          {/* Findings tab */}
          {activeTab === 'findings' && (
            <div className="card">
              {allFindings.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div className="empty-state__icon">✅</div>
                  <h3>No findings</h3>
                  <p>This asset passed all checks.</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr><th>Severity</th><th>Category</th><th>Finding</th><th>Remediation</th></tr>
                  </thead>
                  <tbody>
                    {allFindings.map(f => (
                      <tr key={f.id} style={{ background: selectedFinding?.id === f.id ? SEV_BG[f.severity] : '' }}>
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

          {/* Preview tab */}
          {activeTab === 'preview' && preview && (
            <div style={{ display: 'flex', gap: 16 }}>
              {/* Issue legend */}
              {allFindings.length > 0 && (
                <div className="card" style={{ minWidth: 220, maxWidth: 260, alignSelf: 'flex-start', flexShrink: 0 }}>
                  <div className="card__header"><span className="card__title" style={{ fontSize: 12 }}>Highlighted Issues</span></div>
                  <div style={{ padding: '8px 12px', maxHeight: 460, overflowY: 'auto' }}>
                    {allFindings.filter(f => f.pattern).map((f, i) => (
                      <div
                        key={f.id}
                        onClick={() => setSelectedFinding(f)}
                        style={{
                          padding: '6px 8px',
                          marginBottom: 4,
                          borderLeft: `3px solid ${SEV_COLORS[f.severity]}`,
                          background: selectedFinding?.id === f.id ? SEV_BG[f.severity] : 'var(--sf-gray-50)',
                          borderRadius: '0 4px 4px 0',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ fontWeight: 600, color: SEV_COLORS[f.severity] }}>{f.severity}</div>
                        <div>{f.title}</div>
                      </div>
                    ))}
                    {allFindings.filter(f => !f.pattern).length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--sf-gray-400)', marginTop: 8, padding: '4px 8px' }}>
                        +{allFindings.filter(f => !f.pattern).length} issue{allFindings.filter(f => !f.pattern).length !== 1 ? 's' : ''} without inline position
                      </div>
                    )}
                  </div>
                  {selectedFinding && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--sf-gray-100)', fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: SEV_COLORS[selectedFinding.severity], marginBottom: 4 }}>{selectedFinding.title}</div>
                      <div style={{ marginBottom: 4 }}>{selectedFinding.detail}</div>
                      <div style={{ color: 'var(--sf-gray-500)' }}>{selectedFinding.remediation}</div>
                      <button className="btn btn--ghost" style={{ fontSize: 11, marginTop: 6 }} onClick={() => setSelectedFinding(null)}>Dismiss</button>
                    </div>
                  )}
                </div>
              )}

              {/* Email iframe */}
              <div style={{ flex: 1 }}>
                {preview.subject && (
                  <div style={{ fontSize: 12, color: 'var(--sf-gray-600)', marginBottom: 8 }}>
                    <strong>Subject:</strong> {preview.subject}
                  </div>
                )}
                <div style={{ border: '1px solid var(--sf-gray-200)', borderRadius: 6, overflow: 'hidden' }}>
                  <iframe
                    ref={iframeRef}
                    title="Email Preview"
                    style={{ width: '100%', minHeight: 600, border: 'none', display: 'block' }}
                    sandbox="allow-same-origin"
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--sf-gray-400)', marginTop: 6 }}>
                  Highlighted regions indicate detected issues. Click a highlight to see details.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
