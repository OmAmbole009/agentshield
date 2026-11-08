import React, { useState } from 'react';
import { Sliders, Shield, Edit3, CheckCircle2, AlertCircle, Lock } from 'lucide-react';

export default function PolicyCenter({ policies, currentUser, onRefreshPolicies }) {
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [editRulesJson, setEditRulesJson] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = currentUser.role === 'admin';

  const handleOpenEdit = (policy) => {
    setSelectedPolicy(policy);
    setEditRulesJson(JSON.stringify(policy.rules, null, 2));
    setEditEnabled(policy.enabled === 1);
    setSaveStatus(null);
  };

  const handleSave = async () => {
    if (!isAdmin) {
      setSaveStatus({
        success: false,
        error: 'Security Guard: Only users with the "admin" role are permitted to edit policies. AI agents are strictly blocked.'
      });
      return;
    }

    setSaving(true);
    setSaveStatus(null);

    try {
      let parsedRules = null;
      try {
        parsedRules = JSON.parse(editRulesJson);
      } catch (e) {
        throw new Error('Invalid JSON format for policy rules.');
      }

      const res = await fetch(`/api/policies/${selectedPolicy.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUser.id,
          'X-User-Role': currentUser.role
        },
        body: JSON.stringify({
          enabled: editEnabled,
          rules: parsedRules
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update policy');
      }

      setSaveStatus({ success: true, message: data.message });
      if (onRefreshPolicies) {
        onRefreshPolicies();
      }
    } catch (err) {
      setSaveStatus({ success: false, error: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Policy Center Header Card */}
      <div className="card">
        <div className="card-title">
          <span>Rules the gateway applies before a tool runs</span>
          <span className={`badge ${isAdmin ? 'badge-allow' : 'badge-subtle'}`}>
            Role: {currentUser.role.toUpperCase()} {isAdmin ? '(Admin Privileges)' : '(Read-Only)'}
          </span>
        </div>
        <p style={{ fontSize: '0.86rem', color: '#94a3b8' }}>
          Changes are saved to the local database and take effect immediately. Disabling a policy blocks that action. Ownership checks and prohibited-operation rules remain enforced independently.
        </p>

        {!isAdmin && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: '#94a3b8' }}>
            <Lock size={16} color="var(--color-verify)" />
            <span>To edit policies, switch your identity to <strong>Security Admin</strong> in the top bar.</span>
          </div>
        )}
      </div>

      {/* Policies Table */}
      <div className="card">
        <div className="card-title">
            <span>Configured rules ({policies.length})</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Policy ID</th>
                <th>Name & Description</th>
                <th>Action Type</th>
                <th>Status</th>
                <th>Version</th>
                <th>Updated By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 && <tr><td colSpan="7" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No policy records are available.</td></tr>}
              {policies.map(p => (
                <tr key={p.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>
                    {p.id}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{p.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{p.description}</div>
                  </td>
                  <td>
                    <span className="badge badge-subtle">{p.action_type}</span>
                  </td>
                  <td>
                    <span className={`badge ${p.enabled === 1 ? 'badge-allow' : 'badge-deny'}`}>
                      {p.enabled === 1 ? 'ACTIVE' : 'DISABLED'}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-subtle">v{p.version}</span>
                  </td>
                  <td style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    {p.updated_by}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleOpenEdit(p)}
                    >
                      <Edit3 size={13} />
                      <span>Configure</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy Edit Modal */}
      {selectedPolicy && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '600px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <Sliders size={20} color="#00c2a8" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                Configure Policy: {selectedPolicy.name}
              </h2>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.86rem' }}>
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Policy Active & Enforced</span>
              </label>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '6px' }}>
                Rules Definition (JSON):
              </div>
              <p style={{ margin: '-8px 0 12px', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                Numeric transfer and refund limits are validated by the server. The approval threshold must not exceed the maximum.
              </p>
              <textarea
                className="input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', height: '180px', resize: 'vertical' }}
                value={editRulesJson}
                onChange={(e) => setEditRulesJson(e.target.value)}
              />
            </div>

            {saveStatus && (
              <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.84rem', background: saveStatus.success ? 'var(--bg-allow)' : 'var(--bg-deny)', border: `1px solid ${saveStatus.success ? 'var(--border-allow)' : 'var(--border-deny)'}`, color: saveStatus.success ? 'var(--color-allow)' : 'var(--color-deny)' }}>
                {saveStatus.message || saveStatus.error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedPolicy(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Saving...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
