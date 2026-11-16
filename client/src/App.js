import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { OrgProvider, useOrg } from './context/OrgContext';
import RetrieveData   from './pages/RetrieveData';
import Context        from './pages/Context';
import Findings       from './pages/Findings';
import Alerts         from './pages/Alerts';
import TestingCenter  from './pages/TestingCenter';
import AuditLog       from './pages/AuditLog';
import Summary        from './pages/Summary';
import OrgModal       from './components/OrgModal';
import './App.css';

function Nav() {
  const { orgs, activeOrg, setActiveOrg } = useOrg();
  const [showOrg, setShowOrg] = useState(false);

  const tabs = [
    { to: '/retrieve',  label: 'Retrieve Data' },
    { to: '/context',   label: 'Context' },
    { to: '/findings',  label: 'Findings' },
    { to: '/alerts',    label: 'Alerts' },
    { to: '/testing',   label: 'Testing Center' },
    { to: '/log',       label: 'Audit Log' },
    { to: '/summary',   label: 'Summary' },
  ];

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <svg className="sf-cloud-icon" viewBox="0 0 52 36" fill="none">
          <path d="M42.6 14.2a10.4 10.4 0 00-19.8-3.8 7.8 7.8 0 00-11 7.1A7.8 7.8 0 0019.6 35H42a7.8 7.8 0 00.6-20.8z" fill="currentColor"/>
        </svg>
        <span className="app-header__title">SFMC Audit</span>
      </div>

      <nav className="app-tabs">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => 'app-tab' + (isActive ? ' app-tab--active' : '')}>
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="app-header__actions">
        <select
          className="org-selector"
          value={activeOrg?.id || ''}
          onChange={e => setActiveOrg(orgs.find(o => o.id === parseInt(e.target.value)))}
        >
          {orgs.length === 0 && <option value="">No orgs — add one</option>}
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="btn btn--primary" onClick={() => setShowOrg(true)}>Manage Orgs</button>
      </div>

      {showOrg && <OrgModal onClose={() => setShowOrg(false)} />}
    </header>
  );
}

function AppShell() {
  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/retrieve" replace />} />
          <Route path="/retrieve"  element={<RetrieveData />} />
          <Route path="/context"   element={<Context />} />
          <Route path="/findings"  element={<Findings />} />
          <Route path="/alerts"    element={<Alerts />} />
          <Route path="/testing"   element={<TestingCenter />} />
          <Route path="/log"       element={<AuditLog />} />
          <Route path="/summary"   element={<Summary />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <OrgProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </OrgProvider>
  );
}
