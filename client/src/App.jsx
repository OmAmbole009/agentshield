import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import OverviewDashboard from './views/OverviewDashboard';
import LivePlayground from './views/LivePlayground';
import PolicyCenter from './views/PolicyCenter';
import AuditExplorer from './views/AuditExplorer';
import ProviderUsage from './views/ProviderUsage';
import SecurityTestLab from './views/SecurityTestLab';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [currentUser, setCurrentUser] = useState({
    id: 'usr_sarah_01',
    name: 'Sarah Connor',
    tenantId: 'tenant_retail',
    role: 'customer'
  });

  const [stats, setStats] = useState({ total: 0, allow: 0, verify: 0, deny: 0 });
  const [auditEvents, setAuditEvents] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [budgetSummary, setBudgetSummary] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      // 1. Fetch Health
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const health = await healthRes.json();
        setSystemHealth(health);
      }

      // 2. Fetch Audit Events
      const auditRes = await fetch('/api/audit?limit=100');
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        const events = auditData.events || [];
        setAuditEvents(events);

        // Compute real statistics from actual stored events
        let allow = 0, verify = 0, deny = 0;
        for (const evt of events) {
          if (evt.decision === 'ALLOW') allow++;
          if (evt.decision === 'VERIFY') verify++;
          if (evt.decision === 'DENY') deny++;
        }
        setStats({
          total: events.length,
          allow,
          verify,
          deny
        });
      }

      // 3. Fetch Policies
      const policyRes = await fetch('/api/policies');
      if (policyRes.ok) {
        const policyData = await policyRes.json();
        setPolicies(policyData.policies || []);
      }

      // 4. Fetch Provider Budget Telemetry
      const budgetRes = await fetch('/api/provider/usage');
      if (budgetRes.ok) {
        const budgetData = await budgetRes.json();
        setBudgetSummary(budgetData.summary);
      }
    } catch (err) {
      console.warn('Data sync warning:', err.message);
    }
  };

  const handleResetDb = async () => {
    if (!window.confirm('Reset demo database to clean initial seeded records?')) return;
    try {
      await fetch('/api/accounts/reset', { method: 'POST' });
      await fetchAllData();
      alert('Database successfully re-seeded to initial demonstration baseline.');
    } catch (err) {
      alert('Failed to reset database: ' + err.message);
    }
  };

  const viewTitles = {
    overview: 'Security Operations & Intelligence Overview',
    playground: 'AgentShield Live Agent Playground',
    policies: 'Runtime Policy & Authorization Center',
    audit: 'Tamper-Evident Cryptographic Audit Trail',
    provider: 'Gnani Platform Telemetry & Budget Guard',
    testlab: 'Security Test Lab (Scenarios A through H)'
  };

  return (
    <div className="app-container">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
      />

      <div className="main-wrapper">
        <TopBar
          title={viewTitles[activeTab] || 'AgentShield'}
          currentUser={currentUser}
          setCurrentUser={setCurrentUser}
          systemHealth={systemHealth}
          budgetSummary={budgetSummary}
          onResetDb={handleResetDb}
        />

        <main className="content-scroll">
          {activeTab === 'overview' && (
            <OverviewDashboard
              stats={stats}
              auditEvents={auditEvents}
              budgetSummary={budgetSummary}
              policies={policies}
              setActiveTab={setActiveTab}
            />
          )}

          {activeTab === 'playground' && (
            <LivePlayground
              currentUser={currentUser}
              onSecurityEvent={fetchAllData}
            />
          )}

          {activeTab === 'policies' && (
            <PolicyCenter
              policies={policies}
              currentUser={currentUser}
              onRefreshPolicies={fetchAllData}
            />
          )}

          {activeTab === 'audit' && (
            <AuditExplorer
              auditEvents={auditEvents}
              onRefresh={fetchAllData}
            />
          )}

          {activeTab === 'provider' && (
            <ProviderUsage
              budgetSummary={budgetSummary}
              systemHealth={systemHealth}
              onRefresh={fetchAllData}
            />
          )}

          {activeTab === 'testlab' && (
            <SecurityTestLab
              onSecurityEvent={fetchAllData}
            />
          )}
        </main>
      </div>
    </div>
  );
}
