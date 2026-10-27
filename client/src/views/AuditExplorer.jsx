import React, { useState } from 'react';
import {
  FileSearch,
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  Hash,
  Info
} from 'lucide-react';

export default function AuditExplorer({ auditEvents, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDecision, setFilterDecision] = useState('ALL');
  const [filterAction, setFilterAction] = useState('ALL');
  const [verifying, setVerifying] = useState(false);
  const [chainReport, setChainReport] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);

  const handleVerifyChain = async () => {
    setVerifying(true);
    setChainReport(null);
    try {
      const res = await fetch('/api/audit/verify-chain');
      const data = await res.json();
      setChainReport(data.report);
    } catch (err) {
      setChainReport({
        isChainValid: false,
        details: `Verification request failed: ${err.message}`
      });
    } finally {
      setVerifying(false);
    }
  };

  const filteredEvents = auditEvents.filter(evt => {
    if (filterDecision !== 'ALL' && evt.decision !== filterDecision) return false;
    if (filterAction !== 'ALL' && evt.action_type !== filterAction) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchReq = evt.request_id?.toLowerCase().includes(term);
      const matchType = evt.event_type?.toLowerCase().includes(term);
      const matchAction = evt.action_type?.toLowerCase().includes(term);
      const matchReason = evt.reason_code?.toLowerCase().includes(term);
      const matchUser = evt.user_id?.toLowerCase().includes(term);
      if (!matchReq && !matchType && !matchAction && !matchReason && !matchUser) return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Cryptographic Hash Chain Verification Banner */}
      <div className="card" style={{ borderLeft: '4px solid #00c2a8' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Hash size={18} color="#00c2a8" />
              <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Tamper-Evident SHA-256 Hash Chain</span>
            </div>
            <p style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
              Every audit record is cryptographically linked to its predecessor. Any database modification, deletion, or record insertion invalidates the entire chain.
            </p>
          </div>

          <button
            className="btn btn-primary"
            disabled={verifying}
            onClick={handleVerifyChain}
          >
            <ShieldCheck size={16} />
            <span>{verifying ? 'Verifying Chain...' : 'Verify Cryptographic Integrity'}</span>
          </button>
        </div>

        {chainReport && (
          <div style={{ marginTop: '16px', padding: '12px 16px', borderRadius: 'var(--radius-sm)', background: chainReport.isChainValid ? 'var(--bg-allow)' : 'var(--bg-deny)', border: `1px solid ${chainReport.isChainValid ? 'var(--border-allow)' : 'var(--border-deny)'}`, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            {chainReport.isChainValid ? (
              <ShieldCheck size={20} color="var(--color-allow)" style={{ marginTop: '2px' }} />
            ) : (
              <ShieldAlert size={20} color="var(--color-deny)" style={{ marginTop: '2px' }} />
            )}
            <div>
              <div style={{ fontWeight: 600, color: chainReport.isChainValid ? 'var(--color-allow)' : 'var(--color-deny)' }}>
                {chainReport.isChainValid ? 'Cryptographic Hash Chain Valid & Authentic' : 'Integrity Violation Detected!'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#f1f5f9', marginTop: '2px' }}>
                {chainReport.details}
              </div>
              {chainReport.latestHash && (
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                  Latest Block Hash: {chainReport.latestHash}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px' }}>
            <Search size={16} color="#94a3b8" />
            <input
              type="text"
              className="input"
              placeholder="Search by Request ID, User, Action, or Reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={15} color="#94a3b8" />
            <select
              className="input"
              style={{ width: 'auto' }}
              value={filterDecision}
              onChange={(e) => setFilterDecision(e.target.value)}
            >
              <option value="ALL">All Decisions</option>
              <option value="ALLOW">ALLOW Only</option>
              <option value="VERIFY">VERIFY Only</option>
              <option value="DENY">DENY Only</option>
            </select>

            <select
              className="input"
              style={{ width: 'auto' }}
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="ALL">All Actions</option>
              <option value="READ_BALANCE">READ_BALANCE</option>
              <option value="TRANSFER_FUNDS">TRANSFER_FUNDS</option>
              <option value="REQUEST_REFUND">REQUEST_REFUND</option>
              <option value="UPDATE_PREFERENCE">UPDATE_PREFERENCE</option>
              <option value="EXPORT_CUSTOMER_DATA">EXPORT_CUSTOMER_DATA</option>
            </select>

            <button className="btn btn-secondary" onClick={onRefresh}>
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="card-title">
          <span>Security Audit Trail ({filteredEvents.length} records)</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Request ID</th>
                <th>User / Agent</th>
                <th>Action</th>
                <th>Event Type</th>
                <th>Decision</th>
                <th>Reason</th>
                <th>Block Hash</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map(evt => {
                let badgeClass = 'badge-subtle';
                if (evt.decision === 'ALLOW') badgeClass = 'badge-allow';
                if (evt.decision === 'VERIFY') badgeClass = 'badge-verify';
                if (evt.decision === 'DENY') badgeClass = 'badge-deny';

                return (
                  <tr
                    key={evt.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedEntry(evt)}
                    title="Click to view full cryptographic block details"
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#94a3b8' }}>
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#38bdf8' }}>
                      {evt.request_id}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>
                      <div>{evt.user_id || 'system'}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{evt.agent_id}</div>
                    </td>
                    <td>
                      <span className="badge badge-subtle">{evt.action_type || 'N/A'}</span>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{evt.event_type}</span>
                    </td>
                    <td>
                      {evt.decision ? (
                        <span className={`badge ${badgeClass}`}>{evt.decision}</span>
                      ) : (
                        <span style={{ color: '#64748b' }}>-</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      {evt.reason_code || 'N/A'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#64748b' }}>
                      {evt.current_hash ? `${evt.current_hash.substring(0, 10)}...` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Block Details Modal */}
      {selectedEntry && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '640px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash size={18} color="#00c2a8" />
                <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Cryptographic Audit Block</h2>
              </div>
              <span className="badge badge-subtle">{selectedEntry.id}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.84rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <span style={{ color: '#94a3b8' }}>Timestamp: </span>
                  <span>{selectedEntry.timestamp}</span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Request ID: </span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedEntry.request_id}</span>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Event Type: </span>
                  <strong>{selectedEntry.event_type}</strong>
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Decision: </span>
                  <strong>{selectedEntry.decision || 'N/A'}</strong>
                </div>
              </div>

              <div>
                <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Sanitized Payload Summary:</div>
                <pre className="code-block">
                  {selectedEntry.payload_summary || 'No payload recorded'}
                </pre>
              </div>

              <div>
                <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Previous Block Hash (Chained):</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', background: 'var(--bg-input)', padding: '6px 10px', borderRadius: '4px', wordBreak: 'break-all', color: '#94a3b8' }}>
                  {selectedEntry.previous_hash}
                </div>
              </div>

              <div>
                <div style={{ color: '#94a3b8', marginBottom: '4px' }}>Current Block SHA-256 Hash:</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', background: 'var(--bg-input)', padding: '6px 10px', borderRadius: '4px', wordBreak: 'break-all', color: '#00c2a8' }}>
                  {selectedEntry.current_hash}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedEntry(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
