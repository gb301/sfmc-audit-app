import React, { useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { createOrg, deleteOrg, testOrgConnection } from '../utils/api';

export default function OrgModal({ onClose }) {
  const { orgs, activeOrg, setActiveOrg, refresh } = useOrg();
  const [view, setView]     = useState('list'); // list | add
  const [form, setForm]     = useState({ name: '', clientId: '', clientSecret: '', subdomain: '', accountId: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState({});
  const [error, setError]   = useState('');

  const handleAdd = async () => {
    setError('');
    if (!form.name || !form.clientId || !form.clientSecret || !form.subdomain) {
      setError('Name, Client ID, Client Secret, and Subdomain are required.');
      return;
    }
    setSaving(true);
    try {
      const org = await createOrg(form);
      await refresh();
      setActiveOrg(org);
      setView('list');
      setForm({ name: '', clientId: '', clientSecret: '', subdomain: '', accountId: '' });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this org?')) return;
    await deleteOrg(id);
    await refresh();
    if (activeOrg?.id === id) setActiveOrg(null);
  };

  const handleTest = async (id) => {
    setTesting(t => ({ ...t, [id]: 'loading' }));
    try {
      await testOrgConnection(id);
      setTesting(t => ({ ...t, [id]: 'ok' }));
    } catch (e) {
      setTesting(t => ({ ...t, [id]: 'error' }));
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">{view === 'list' ? 'Manage Orgs' : 'Add Org'}</span>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>
        <div className="modal__body">

          {view === 'list' && <>
            {orgs.length === 0 && (
              <p style={{ color: 'var(--sf-gray-500)', fontSize: 13, marginBottom: 12 }}>
                No orgs connected. Add one to get started.
              </p>
            )}
            {orgs.map(o => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--sf-gray-100)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--sf-gray-500)' }}>{o.subdomain}.marketingcloudapis.com</div>
                </div>
                <button className="btn btn--secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleTest(o.id)} disabled={testing[o.id] === 'loading'}>
                  {testing[o.id] === 'loading' ? '…' : testing[o.id] === 'ok' ? '✓ OK' : testing[o.id] === 'error' ? '✗ Fail' : 'Test'}
                </button>
                <button className="btn btn--ghost" style={{ color: 'var(--sf-red)', fontSize: 11 }} onClick={() => handleDelete(o.id)}>Remove</button>
              </div>
            ))}
            <button className="btn btn--primary" style={{ marginTop: 12 }} onClick={() => setView('add')}>+ Add Org</button>
          </>}

          {view === 'add' && <>
            {error && <div className="alert alert--error" style={{ marginBottom: 12 }}>{error}</div>}
            {[
              { key: 'name',         label: 'Display Name',  hint: 'e.g. "Acme Corp — Production"' },
              { key: 'subdomain',    label: 'Subdomain',     hint: 'e.g. "mc12345a" (from your MC instance URL)' },
              { key: 'clientId',     label: 'Client ID' },
              { key: 'clientSecret', label: 'Client Secret', type: 'password' },
              { key: 'accountId',    label: 'Account ID',    hint: 'Optional — MID for child BU' },
            ].map(f => (
              <div className="form-group" key={f.key}>
                <label className="form-label">{f.label}</label>
                <input
                  className="form-input"
                  type={f.type || 'text'}
                  value={form[f.key]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                />
                {f.hint && <div className="form-hint">{f.hint}</div>}
              </div>
            ))}
          </>}
        </div>
        <div className="modal__footer">
          {view === 'add' && <button className="btn btn--secondary" onClick={() => { setView('list'); setError(''); }}>Back</button>}
          {view === 'add' && <button className="btn btn--primary" onClick={handleAdd} disabled={saving}>{saving ? 'Connecting…' : 'Connect Org'}</button>}
          {view === 'list' && <button className="btn btn--secondary" onClick={onClose}>Close</button>}
        </div>
      </div>
    </div>
  );
}
