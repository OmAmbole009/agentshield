const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');
const { BudgetGuard, BUDGET_STATUS } = require('../src/providers/budgetGuard');

describe('Credit Budget Guard and Usage Telemetry Tests', () => {
  let db;
  let budgetGuard;

  beforeEach(() => {
    db = getDb(':memory:');
    initSchema(db);
    budgetGuard = new BudgetGuard(db);
  });

  it('records mock calls without deducting billable provider credits', () => {
    budgetGuard.recordUsage({
      provider: 'gnani-mock',
      operationType: 'stt',
      isMock: true,
      callStatus: 'SUCCESS',
      reportedCredits: null,
      estimatedCredits: 0,
      durationMs: 40
    });

    const summary = budgetGuard.getUsageSummary();
    assert.equal(summary.totalCalls, 1);
    assert.equal(summary.mockCalls, 1);
    assert.equal(summary.liveCalls, 0);
    assert.equal(summary.consumedCredits, 0);
    assert.equal(summary.status, BUDGET_STATUS.NORMAL);
  });

  it('enforces safety reserve: blocks live calls when usable budget limit is reached', () => {
    // Inject usage equal to usable ceiling (5000 - 1000 = 4000 usable)
    budgetGuard.recordUsage({
      provider: 'gnani-live',
      operationType: 'stt',
      isMock: false,
      callStatus: 'SUCCESS',
      reportedCredits: 4000,
      durationMs: 120
    });

    const summary = budgetGuard.getUsageSummary();
    assert.equal(summary.status, BUDGET_STATUS.EXHAUSTED);
    assert.equal(summary.remainingUsable, 0);
    assert.equal(summary.consumedCredits, 4000);

    // Attempting a live call must be blocked by BudgetGuard!
    const decision = budgetGuard.canMakeLiveCall('stt', 10, { bypassConfig: true });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /BUDGET_GUARD_BLOCKED/);
  });

  it('distinguishes between reported credits and local estimated credits', () => {
    budgetGuard.recordUsage({
      provider: 'gnani-live',
      operationType: 'tts',
      isMock: false,
      callStatus: 'SUCCESS',
      reportedCredits: null, // Provider didn't report exact credits
      estimatedCredits: 15,  // Local estimate
      durationMs: 90
    });

    const summary = budgetGuard.getUsageSummary();
    assert.equal(summary.reportedCredits, 0);
    assert.equal(summary.estimatedCredits, 15);
    assert.equal(summary.isEstimatedOnly, true);
  });
});
