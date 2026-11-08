import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import OverviewDashboard from './views/OverviewDashboard';
import LivePlayground from './views/LivePlayground';
import PolicyCenter from './views/PolicyCenter';
import AuditExplorer from './views/AuditExplorer';
import ProviderUsage from './views/ProviderUsage';
import SecurityTestLab from './views/SecurityTestLab';
import CustomerSupportAgent from './views/CustomerSupportAgent';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('agentshield-demo-user'));
      if (saved?.id && saved?.role && saved?.tenantId) return saved;
    } catch { /* Use the seeded default below. */ }
    return { id: 'usr_sarah_01', name: 'Sarah Connor', tenantId: 'tenant_retail', role: 'customer' };
  });

  const [stats, setStats] = useState({ total: 0, allow: 0, verify: 0, deny: 0 });
  const [auditEvents, setAuditEvents] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [budgetSummary, setBudgetSummary] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [dataError, setDataError] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('agentshield-demo-user', JSON.stringify(currentUser)); } catch { /* Storage is optional for this local demo. */ }
  }, [currentUser]);

  const fetchAllData = useCallback(async () => {
    try {
      setDataError('');
      const auditHeaders = { 'X-User-Id': currentUser.id };
      const [healthRes, auditRes, policyRes, budgetRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/audit?limit=100', { headers: auditHeaders }),
        fetch('/api/policies'),
        fetch('/api/provider/usage')
      ]);
      for (const response of [healthRes, auditRes, policyRes, budgetRes]) {
        if (!response.ok) throw new Error(`Dashboard data request failed (${response.status}).`);
      }
      const [health, auditData, policyData, budgetData] = await Promise.all([
        healthRes.json(), auditRes.json(), policyRes.json(), budgetRes.json()
      ]);
      const events = auditData.events || [];
      const decisions = events.filter(evt => evt.event_type === 'POLICY_EVALUATED');
      setSystemHealth(health);
      setAuditEvents(events);
      setPolicies(policyData.policies || []);
      setBudgetSummary(budgetData.summary || null);
      setStats({
        total: decisions.length,
        allow: decisions.filter(evt => evt.decision === 'ALLOW').length,
        verify: decisions.filter(evt => evt.decision === 'VERIFY').length,
        deny: decisions.filter(evt => evt.decision === 'DENY').length
      });
    } catch (err) {
      setDataError(err.message);
    }
  }, [currentUser.id]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleResetDb = async () => {
    if (!window.confirm('Reset demo database to clean initial seeded records?')) return;
    setResetting(true);
    try {
      const response = await fetch('/api/accounts/reset', { method: 'POST' });
      if (!response.ok) throw new Error(`Reset failed (${response.status}).`);
      await fetchAllData();
    } catch (err) {
      setDataError(`Could not reset demo data: ${err.message}`);
    } finally {
      setResetting(false);
    }
  };

  const viewTitles = {
    overview: 'Demo dashboard',
    playground: 'Try a protected agent action',
    support: 'Customer support demo',
    policies: 'Security policies',
    audit: 'Decision and audit history',
    provider: 'AI provider settings',
    testlab: 'Run security checks'
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
          resetting={resetting}
        />

        <main className="content-scroll">
          {dataError && <div className="app-error" role="alert">{dataError}<button className="btn btn-secondary btn-sm" onClick={fetchAllData}>Retry</button></div>}
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

          {activeTab === 'support' && (
            <CustomerSupportAgent
              currentUser={currentUser}
              onSecurityEvent={fetchAllData}
              setActiveTab={setActiveTab}
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
