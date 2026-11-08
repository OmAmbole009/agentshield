import React from 'react';
import {
  ShieldCheck,
  Activity,
  Terminal,
  Sliders,
  FileSearch,
  Coins,
  FlaskConical,
  UserCheck,
  Headphones
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, currentUser }) {
  const navItems = [
    { id: 'overview', label: 'Demo guide', icon: Activity },
    { id: 'playground', label: 'Try an action', icon: Terminal },
    { id: 'testlab', label: 'Security checks', icon: FlaskConical },
    { id: 'audit', label: 'Audit history', icon: FileSearch },
    { id: 'policies', label: 'Policies', icon: Sliders },
    { id: 'support', label: 'Support agent', icon: Headphones },
    { id: 'provider', label: 'AI provider', icon: Coins }
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-icon">
          <ShieldCheck size={22} />
        </div>
        <div>
          <div className="brand-title">AgentShield</div>
          <div className="brand-subtitle">Protected agent actions</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="demo-mode-caption">LOCAL DEMO · SIMULATED DATA</div>
        <div className="user-badge">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCheck size={16} color="#00c2a8" />
            <div>
              <div className="user-name">{currentUser.name}</div>
              <div className="user-tenant">{currentUser.tenantId}</div>
            </div>
          </div>
          <span className="badge badge-subtle" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
            {currentUser.role}
          </span>
        </div>
      </div>
    </aside>
  );
}
