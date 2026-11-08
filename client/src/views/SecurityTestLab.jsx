import React, { useState, useEffect } from 'react';
import { FlaskConical, CheckCircle2, XCircle, Play, RefreshCw, ShieldAlert, Clock } from 'lucide-react';

export default function SecurityTestLab({ onSecurityEvent }) {
  const [scenarios, setScenarios] = useState([]);
  const [results, setResults] = useState({});
  const [runningAll, setRunningAll] = useState(false);
  const [runningSingle, setRunningSingle] = useState(null);
  const [loadingScenarios, setLoadingScenarios] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchScenarios();
  }, []);

  const fetchScenarios = async () => {
    setLoadingScenarios(true);
    setError('');
    try {
      const res = await fetch('/api/scenarios');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Scenario list failed (${res.status}).`);
      setScenarios(data.scenarios || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingScenarios(false);
    }
  };

  const runScenario = async (scenarioId) => {
    setRunningSingle(scenarioId);
    try {
      const res = await fetch(`/api/scenarios/run/${scenarioId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Scenario failed (${res.status}).`);
      setResults(prev => ({
        ...prev,
        [scenarioId]: data
      }));
      if (onSecurityEvent) onSecurityEvent();
    } catch (e) {
      setError(e.message);
      setResults(prev => ({
        ...prev,
        [scenarioId]: { passed: false, explanation: `Execution error: ${e.message}` }
      }));
    } finally {
      setRunningSingle(null);
    }
  };

  const runAllScenarios = async () => {
    setRunningAll(true);
    try {
      const res = await fetch('/api/scenarios/run-all?includeEnterprise=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Scenario run failed (${res.status}).`);
      if (data.results) {
        const mapped = {};
        for (const item of data.results) {
          mapped[item.id] = item;
        }
        setResults(mapped);
      }
      if (onSecurityEvent) onSecurityEvent();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunningAll(false);
    }
  };

  const totalRuns = Object.keys(results).length;
  const passedRuns = Object.values(results).filter(r => r.passed).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header & Run All Action Card */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <FlaskConical size={20} color="#00c2a8" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Security Test Lab — Scenarios A through L</h2>
            </div>
            <p style={{ fontSize: '0.86rem', color: '#94a3b8' }}>
              Comprehensive test suite including Core Scenarios (A through H) and Gnani Enterprise Guardrails (Voice ASR trust, Hinglish injection defense, PII scrubbing, and session velocity lockout).
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {totalRuns > 0 && (
              <span className={`badge ${passedRuns === totalRuns ? 'badge-allow' : 'badge-deny'}`}>
                {passedRuns} / {totalRuns} Passed
              </span>
            )}
            <button
              className="btn btn-primary"
              disabled={runningAll}
              onClick={runAllScenarios}
            >
              <Play size={16} />
              <span>{runningAll ? 'Running All Scenarios...' : `Run All ${scenarios.length || 12} Scenarios`}</span>
            </button>
          </div>
        </div>
      </div>

      {error && <div className="app-error" role="alert">{error}<button className="btn btn-secondary btn-sm" onClick={fetchScenarios}>Retry</button></div>}

      {/* Scenarios Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {loadingScenarios && <div className="card" aria-live="polite">Loading security checks…</div>}
        {!loadingScenarios && scenarios.length === 0 && !error && <div className="card">No security scenarios are configured.</div>}
        {scenarios.map(sc => {
          const result = results[sc.id];
          const isRunning = runningSingle === sc.id || runningAll;

          return (
            <div key={sc.id} className="card" style={{ padding: '18px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                      {sc.name}
                    </span>
                    <span className="badge badge-subtle">{sc.category}</span>
                    <span className="badge badge-subtle">Expected: {sc.expectedDecision}</span>
                    {sc.isEnterprise && <span className="badge badge-verify">Enterprise Guardrail</span>}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#94a3b8' }}>
                    {sc.description}
                  </div>

                  {/* Live execution outcome */}
                  {result && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: result.passed ? 'var(--bg-allow)' : 'var(--bg-deny)', border: `1px solid ${result.passed ? 'var(--border-allow)' : 'var(--border-deny)'}`, display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      {result.passed ? (
                        <CheckCircle2 size={18} color="var(--color-allow)" style={{ marginTop: '1px' }} />
                      ) : (
                        <XCircle size={18} color="var(--color-deny)" style={{ marginTop: '1px' }} />
                      )}
                      <div style={{ fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 600, color: result.passed ? 'var(--color-allow)' : 'var(--color-deny)' }}>
                          {result.passed ? 'PASSED: Security Property Enforced' : 'FAILED: Assertion Did Not Hold'}
                        </div>
                        <div style={{ color: '#f1f5f9', marginTop: '2px' }}>
                          {result.explanation}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={isRunning}
                    onClick={() => runScenario(sc.id)}
                  >
                    <Play size={13} />
                    <span>{isRunning ? 'Running...' : 'Execute'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
