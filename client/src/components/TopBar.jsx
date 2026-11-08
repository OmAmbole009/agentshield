import React from 'react';
import { Shield, Mic, RotateCcw, User } from 'lucide-react';

export default function TopBar({
  title,
  currentUser,
  setCurrentUser,
  systemHealth,
  budgetSummary,
  onResetDb,
  resetting = false
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
        <div className="status-pill" title="Live health check from the AgentShield backend">
          <span className={`status-dot ${systemHealth?.status !== 'HEALTHY' ? 'amber' : ''}`}></span>
          <span>{!systemHealth ? 'Checking gateway…' : systemHealth.status === 'HEALTHY' ? 'Gateway ready' : 'Gateway unavailable'}</span>
        </div>

        {/* Gnani Voice Status */}
        <div className="status-pill">
          <Mic size={14} color="#00c2a8" />
          <span>AI: {systemHealth?.gnani?.enabled ? 'Live configured' : 'Local simulation'}</span>
        </div>

        {/* Credit Budget Guard Pill */}
        <div className="status-pill">
          <span style={{ color: '#00c2a8', fontWeight: 700 }}>
            {budgetSummary ? `${budgetSummary.remainingUsable} usable credits` : 'Budget loading'}
          </span>
        </div>

        {/* User Identity Switcher for Security Boundary Testing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={15} color="#94a3b8" aria-hidden="true" />
          <label className="demo-user-label" htmlFor="demo-user">Demo identity</label>
          <select
            id="demo-user"
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
          title="Restore the local demo accounts and clear demo activity"
          disabled={resetting}
          onClick={onResetDb}
        >
          <RotateCcw size={14} />
          <span>{resetting ? 'Resetting…' : 'Reset demo'}</span>
        </button>
      </div>
    </header>
  );
}
