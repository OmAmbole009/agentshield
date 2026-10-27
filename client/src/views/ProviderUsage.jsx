import React, { useState } from 'react';
import { Coins, Shield, Mic, CheckCircle2, AlertTriangle, Play, Volume2 } from 'lucide-react';

export default function ProviderUsage({ budgetSummary, systemHealth, onRefresh }) {
  const [testSpeechText, setTestSpeechText] = useState('AgentShield runtime security active.');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleTestSpeech = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/provider/test-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testSpeechText })
      });
      const data = await res.json();
      setTestResult(data);
      if (onRefresh) onRefresh();
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTestLoading(false);
    }
  };

  const budget = budgetSummary || {
    budgetLimit: 5000,
    budgetReserve: 1000,
    usableBudget: 4000,
    remainingUsable: 4000,
    consumedCredits: 0,
    status: 'NORMAL',
    totalCalls: 0,
    mockCalls: 0,
    liveCalls: 0,
    isLiveEnabled: false
  };

  const consumedPct = Math.min(100, Math.round((budget.consumedCredits / budget.usableBudget) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Provider Connectivity Cards */}
      <div className="grid-cols-3">
        <div className="card">
          <div className="card-title">
            <span>Gnani Prisma v2.5 (STT)</span>
            <Mic size={18} color="#00c2a8" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className={`badge ${budget.isLiveEnabled ? 'badge-allow' : 'badge-subtle'}`}>
              {budget.isLiveEnabled ? 'LIVE CONNECTED' : 'MOCK MODE (Default)'}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Telephonic Speech-to-Text inference endpoint: <code>https://api.vachana.ai/stt/v3</code>
          </p>
        </div>

        <div className="card">
          <div className="card-title">
            <span>Gnani Timbre (TTS)</span>
            <Volume2 size={18} color="#00c2a8" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className={`badge ${budget.isLiveEnabled ? 'badge-allow' : 'badge-subtle'}`}>
              {budget.isLiveEnabled ? 'LIVE CONNECTED' : 'MOCK MODE (Default)'}
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Context-aware expressive speech generation via model <code>timbre-v2.5</code>
          </p>
        </div>

        <div className="card">
          <div className="card-title">
            <span>Gnani Evon v3.3 (Reasoning)</span>
            <Shield size={18} color="#00c2a8" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span className="badge badge-subtle">
              Deterministic Fallback Active
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            30B parameter reasoning model with deterministic local schema extraction.
          </p>
        </div>
      </div>

      {/* Credit Budget Guard Detailed Meter */}
      <div className="card">
        <div className="card-title">
          <span>Gnani 5,000 Credit Budget Guard & Reserve Protection</span>
          <span className={`badge ${budget.status === 'NORMAL' ? 'badge-allow' : 'badge-verify'}`}>
            Guard Status: {budget.status}
          </span>
        </div>

        <div style={{ margin: '16px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginBottom: '8px' }}>
            <span>
              Consumed: <strong>{budget.consumedCredits}</strong> / {budget.usableBudget} Usable Credits
            </span>
            <span style={{ color: '#00c2a8', fontWeight: 600 }}>
              {budget.remainingUsable} Remaining
            </span>
          </div>

          <div style={{ display: 'flex', height: '14px', borderRadius: '7px', background: '#0e1627', overflow: 'hidden' }}>
            <div
              style={{
                width: `${consumedPct}%`,
                background: budget.status === 'NORMAL' ? '#00c2a8' : 'var(--color-verify)'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#94a3b8', marginTop: '8px' }}>
            <span>0</span>
            <span>Usable Ceiling: 4,000 Credits</span>
            <span style={{ color: 'var(--color-verify)' }}>Hard Safety Reserve: 1,000 Credits Preserved</span>
          </div>
        </div>

        {/* Telemetry Breakdown */}
        <div className="grid-cols-4" style={{ marginTop: '20px' }}>
          <div style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Total Operations</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{budget.totalCalls}</div>
          </div>

          <div style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Mock (Safe) Calls</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-allow)' }}>{budget.mockCalls}</div>
          </div>

          <div style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Live Billed Calls</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#38bdf8' }}>{budget.liveCalls}</div>
          </div>

          <div style={{ padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Guard Interceptions</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-verify)' }}>{budget.blockedCalls || 0}</div>
          </div>
        </div>
      </div>

      {/* Explicit User-Initiated Voice Test */}
      <div className="card">
        <div className="card-title">
          <span>Explicit Voice Synthesis Test (User Initiated)</span>
          <span className="badge badge-subtle">Zero Background Credit Spending</span>
        </div>
        <p style={{ fontSize: '0.84rem', color: '#94a3b8', marginBottom: '14px' }}>
          Test speech generation with the configured adapter. Telemetry and any reported credits are recorded in real-time.
        </p>

        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            className="input"
            value={testSpeechText}
            onChange={(e) => setTestSpeechText(e.target.value)}
            placeholder="Text to synthesize..."
          />
          <button
            className="btn btn-primary"
            disabled={testLoading}
            onClick={handleTestSpeech}
          >
            <Play size={15} />
            <span>{testLoading ? 'Synthesizing...' : 'Synthesize Speech'}</span>
          </button>
        </div>

        {testResult && (
          <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', fontSize: '0.84rem' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-allow)', marginBottom: '4px' }}>
              Voice Generation Result:
            </div>
            <pre className="code-block">
              {JSON.stringify(testResult.result || testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
