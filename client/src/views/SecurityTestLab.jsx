import React, { useState, useEffect } from 'react';
import { FlaskConical, CheckCircle2, XCircle, Play, RefreshCw, ShieldAlert, Clock } from 'lucide-react';

export default function SecurityTestLab({ onSecurityEvent }) {
  const [scenarios, setScenarios] = useState([]);
  const [results, setResults] = useState({});
  const [runningAll, setRunningAll] = useState(false);
  const [runningSingle, setRunningSingle] = useState(null);

  useEffect(() => {
    fetchScenarios();
  }, []);

  const fetchScenarios = async () => {
    try {
      const res = await fetch('/api/scenarios');
      const data = await res.json();
      if (data.success) {
        setScenarios(data.scenarios);
      }
    } catch (e) {
      console.warn('Failed to load scenarios:', e);
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
      setResults(prev => ({
        ...prev,
        [scenarioId]: data
      }));
      if (onSecurityEvent) onSecurityEvent();
    } catch (e) {
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
      const res = await fetch('/api/scenarios/run-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.results) {
        const mapped = {};
        for (const item of data.results) {
          mapped[item.id] = item;
        }
        setResults(mapped);
      }
      if (onSecurityEvent) onSecurityEvent();
    } catch (e) {
      console.warn('Failed to run all scenarios:', e);
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
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Security Test Lab — Scenarios A through H</h2>
            </div>
            <p style={{ fontSize: '0.86rem', color: '#94a3b8' }}>
              Execute actual adversarial regression and policy validation suites against the live security gateway. Every result represents a verified backend execution.
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
              <span>{runningAll ? 'Running All Scenarios...' : 'Run All 8 Scenarios'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scenarios Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {scenarios.map(sc => {
          const result = results[sc.id];
          const isRunning = runningSingle === sc.id || runningAll;

          return (
            <div key={sc.id} className="card" style={{ padding: '18px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>
                      {sc.name}
                    </span>
                    <span className="badge badge-subtle">{sc.category}</span>
                    <span className="badge badge-subtle">Expected: {sc.expectedDecision}</span>
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
