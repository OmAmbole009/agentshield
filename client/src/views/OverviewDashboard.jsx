import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Shield,
  Coins,
  ArrowRight,
  Terminal,
  FlaskConical
} from 'lucide-react';

export default function OverviewDashboard({
  stats,
  auditEvents,
  budgetSummary,
  policies,
  setActiveTab
}) {
  const total = stats.total || 0;
  const allowCount = stats.allow || 0;
  const verifyCount = stats.verify || 0;
  const denyCount = stats.deny || 0;

  const allowPct = total > 0 ? Math.round((allowCount / total) * 100) : 0;
  const verifyPct = total > 0 ? Math.round((verifyCount / total) * 100) : 0;
  const denyPct = total > 0 ? Math.round((denyCount / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* KPI Cards Row */}
      <div className="grid-cols-4">
        <div className="card">
          <div className="card-title">
            <span>Evaluated Requests</span>
            <Activity size={18} color="#94a3b8" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: '#fff' }}>{total}</div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px' }}>
            Through runtime policy gateway
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid var(--color-allow)' }}>
          <div className="card-title">
            <span>Allowed Operations</span>
            <CheckCircle2 size={18} color="var(--color-allow)" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--color-allow)' }}>
            {allowCount}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px' }}>
            {allowPct}% of evaluated traffic
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid var(--color-verify)' }}>
          <div className="card-title">
            <span>Verification Required</span>
            <AlertTriangle size={18} color="var(--color-verify)" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--color-verify)' }}>
            {verifyCount}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px' }}>
            {verifyPct}% step-up challenges
          </div>
        </div>

        <div className="card" style={{ borderLeft: '4px solid var(--color-deny)' }}>
          <div className="card-title">
            <span>Denied Actions</span>
            <XCircle size={18} color="var(--color-deny)" />
          </div>
          <div style={{ fontSize: '1.9rem', fontWeight: 700, color: 'var(--color-deny)' }}>
            {denyCount}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px' }}>
            {denyPct}% blocked by policy
          </div>
        </div>
      </div>

      {/* Decision Distribution Bar */}
      {total > 0 && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '8px' }}>
            <span style={{ fontWeight: 600 }}>Runtime Decision Distribution</span>
            <span style={{ color: '#94a3b8' }}>{total} Total Security Events Recorded</span>
          </div>
          <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#0e1627' }}>
            <div style={{ width: `${allowPct}%`, background: 'var(--color-allow)' }} title={`Allowed: ${allowPct}%`} />
            <div style={{ width: `${verifyPct}%`, background: 'var(--color-verify)' }} title={`Verify: ${verifyPct}%`} />
            <div style={{ width: `${denyPct}%`, background: 'var(--color-deny)' }} title={`Denied: ${denyPct}%`} />
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '10px', fontSize: '0.78rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-allow)' }} />
              <span>Allow ({allowCount})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-verify)' }} />
              <span>Verify Step-Up ({verifyCount})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-deny)' }} />
              <span>Denied ({denyCount})</span>
            </div>
          </div>
        </div>
      )}

      {/* Two Column Layout: Quick Actions & Provider Budget */}
      <div className="grid-cols-2">
        {/* Quick Launch Cards */}
        <div className="card">
          <div className="card-title">
            <span>Security Operations Center</span>
            <Shield size={18} color="#00c2a8" />
          </div>
          <p style={{ fontSize: '0.86rem', color: '#94a3b8', marginBottom: '16px' }}>
            Test runtime agent requests against deterministic policies, trigger simulated voice queries, or run automated attack scenarios.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              className="btn btn-primary"
              style={{ justifyContent: 'space-between' }}
              onClick={() => setActiveTab('playground')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={16} />
                <span>Open Live Agent Playground</span>
              </div>
              <ArrowRight size={16} />
            </button>

            <button
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
              onClick={() => setActiveTab('testlab')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FlaskConical size={16} />
                <span>Run Attack Scenarios (A - H)</span>
              </div>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Credit Budget Guard Status */}
        <div className="card">
          <div className="card-title">
            <span>Gnani Credit-Budget Guard</span>
            <Coins size={18} color="#00c2a8" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.9rem', fontWeight: 700, color: '#00c2a8' }}>
              {budgetSummary ? budgetSummary.remainingUsable : 4000}
            </span>
            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
              usable credits remaining (out of 5,000 total budget)
            </span>
          </div>

          <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '16px' }}>
            Safety Reserve: <strong>1,000 credits</strong> reserved. Billable operations automatically halt when usable quota reaches zero.
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <span className="badge badge-subtle">Mock Calls: {budgetSummary?.mockCalls || 0}</span>
            <span className="badge badge-subtle">Live Calls: {budgetSummary?.liveCalls || 0}</span>
            <span className={`badge ${budgetSummary?.status === 'NORMAL' ? 'badge-allow' : 'badge-verify'}`}>
              Guard Status: {budgetSummary?.status || 'NORMAL'}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Security Events Table */}
      <div className="card">
        <div className="card-title">
          <span>Recent Real-Time Security Events</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('audit')}>
            View Full Audit Trail
          </button>
        </div>

        {auditEvents.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
            No security events recorded yet. Run a request in the Playground or execute scenarios in the Test Lab.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Request ID</th>
                  <th>Event Type</th>
                  <th>Action Type</th>
                  <th>Decision</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.slice(0, 6).map((evt) => {
                  let badgeClass = 'badge-subtle';
                  if (evt.decision === 'ALLOW') badgeClass = 'badge-allow';
                  if (evt.decision === 'VERIFY') badgeClass = 'badge-verify';
                  if (evt.decision === 'DENY') badgeClass = 'badge-deny';

                  return (
                    <tr key={evt.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#94a3b8' }}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                        {evt.request_id}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{evt.event_type}</span>
                      </td>
                      <td>
                        <span className="badge badge-subtle">{evt.action_type || 'N/A'}</span>
                      </td>
                      <td>
                        {evt.decision ? (
                          <span className={`badge ${badgeClass}`}>{evt.decision}</span>
                        ) : (
                          <span style={{ color: '#64748b' }}>-</span>
                        )}
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                        {evt.reason_code || 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
