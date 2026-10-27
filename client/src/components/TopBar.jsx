import React from 'react';
import { Shield, Mic, RotateCcw, User } from 'lucide-react';

export default function TopBar({
  title,
  currentUser,
  setCurrentUser,
  systemHealth,
  budgetSummary,
  onResetDb
}) {
  const users = [
    { id: 'usr_sarah_01', name: 'Sarah Connor', tenantId: 'tenant_retail', role: 'customer' },
    { id: 'usr_michael_02', name: 'Michael Scott', tenantId: 'tenant_retail', role: 'customer' },
    { id: 'usr_alex_03', name: 'Alex Thorne (Attacker)', tenantId: 'tenant_external', role: 'customer' },
    { id: 'usr_admin', name: 'Security Admin', tenantId: 'tenant_retail', role: 'admin' }
  ];

  return (
    <header className="top-bar">
      <div className="view-title-wrap">
        <h1 className="view-title">{title}</h1>
      </div>

      <div className="top-bar-actions">
        {/* Gateway Health Indicator */}
        <div className="status-pill">
          <span className="status-dot"></span>
          <span>Gateway Active</span>
        </div>

        {/* Gnani Voice Status */}
        <div className="status-pill">
          <Mic size={14} color="#00c2a8" />
          <span>Gnani Voice: {systemHealth?.gnani?.enabled ? 'LIVE' : 'MOCK (Safe Default)'}</span>
        </div>

        {/* Credit Budget Guard Pill */}
        <div className="status-pill">
          <span style={{ color: '#00c2a8', fontWeight: 700 }}>
            {budgetSummary ? `${budgetSummary.remainingUsable} / ${budgetSummary.usableBudget} Credits` : '5,000 Credits'}
          </span>
        </div>

        {/* User Identity Switcher for Security Boundary Testing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={15} color="#94a3b8" />
          <select
            className="input"
            style={{ width: 'auto', padding: '5px 10px', fontSize: '0.8rem', height: '32px' }}
            value={currentUser.id + '-' + currentUser.role}
            onChange={(e) => {
              const selected = users.find(u => `${u.id}-${u.role}` === e.target.value);
              if (selected) setCurrentUser(selected);
            }}
          >
            {users.map(u => (
              <option key={`${u.id}-${u.role}`} value={`${u.id}-${u.role}`}>
                {u.name} ({u.tenantId})
              </option>
            ))}
          </select>
        </div>

        {/* Reset Database Button */}
        <button
          className="btn btn-secondary btn-sm"
          title="Reset database to seeded demo records"
          onClick={onResetDb}
        >
          <RotateCcw size={14} />
          <span>Reset Demo</span>
        </button>
      </div>
    </header>
  );
}
