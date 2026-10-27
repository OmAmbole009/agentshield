const crypto = require('node:crypto');
const config = require('../config/env');

const BUDGET_STATUS = {
  NORMAL: 'NORMAL',
  RESERVE_WARNING: 'RESERVE_WARNING',
  EXHAUSTED: 'EXHAUSTED'
};

class BudgetGuard {
  constructor(db) {
    this.db = db;
    this.budgetLimit = config.gnani.creditBudget; // default 5000
    this.budgetReserve = config.gnani.creditReserve; // default 1000
  }

  /**
   * Retrieves live and mock usage telemetry from SQLite.
   */
  getUsageSummary() {
    const rows = this.db.prepare(`
      SELECT 
        COUNT(*) as totalCalls,
        SUM(CASE WHEN is_mock = 0 THEN 1 ELSE 0 END) as liveCalls,
        SUM(CASE WHEN is_mock = 1 THEN 1 ELSE 0 END) as mockCalls,
        SUM(CASE WHEN is_mock = 0 AND call_status = 'SUCCESS' THEN 1 ELSE 0 END) as liveSuccessCalls,
        SUM(CASE WHEN call_status = 'BLOCKED_BY_GUARD' THEN 1 ELSE 0 END) as blockedCalls,
        SUM(COALESCE(reported_credits, 0)) as totalReportedCredits,
        SUM(COALESCE(estimated_credits, 0)) as totalEstimatedCredits
      FROM provider_usage
    `).get();

    const reportedCredits = rows.totalReportedCredits || 0;
    const estimatedCredits = rows.totalEstimatedCredits || 0;
    // Conservative total: use reported where available, otherwise estimate
    const consumedCredits = reportedCredits > 0 ? reportedCredits : estimatedCredits;
    const usableBudget = Math.max(0, this.budgetLimit - this.budgetReserve);
    const remainingUsable = Math.max(0, usableBudget - consumedCredits);

    let status = BUDGET_STATUS.NORMAL;
    if (consumedCredits >= usableBudget) {
      status = BUDGET_STATUS.EXHAUSTED;
    } else if (consumedCredits >= (usableBudget * 0.8)) {
      status = BUDGET_STATUS.RESERVE_WARNING;
    }

    return {
      budgetLimit: this.budgetLimit,
      budgetReserve: this.budgetReserve,
      usableBudget,
      remainingUsable,
      consumedCredits,
      reportedCredits,
      estimatedCredits,
      isEstimatedOnly: reportedCredits === 0 && estimatedCredits > 0,
      status,
      totalCalls: rows.totalCalls || 0,
      liveCalls: rows.liveCalls || 0,
      mockCalls: rows.mockCalls || 0,
      liveSuccessCalls: rows.liveSuccessCalls || 0,
      blockedCalls: rows.blockedCalls || 0,
      isLiveEnabled: config.gnani.enabled && !!config.gnani.apiKey
    };
  }

  /**
   * Evaluates whether a live billable provider call is permitted under current budget.
   *
   * @param {string} operationType - 'stt' | 'tts' | 'llm'
   * @param {number} estimatedCredits - Conservative cost estimate
   * @returns {Object} { allowed: boolean, reason?: string, summary: Object }
   */
  canMakeLiveCall(operationType, estimatedCredits = 10, { bypassConfig = false } = {}) {
    // 1. Check if Gnani is enabled at all
    if (!bypassConfig && !config.gnani.enabled) {
      return {
        allowed: false,
        reason: 'GNANI_DISABLED: Provider integration is running in mock mode by configuration.',
        status: BUDGET_STATUS.NORMAL
      };
    }

    // 2. Check if API key is present
    if (!bypassConfig && !config.gnani.apiKey) {
      return {
        allowed: false,
        reason: 'MISSING_API_KEY: Gnani API key (GNANI_API_KEY) is not configured.',
        status: BUDGET_STATUS.NORMAL
      };
    }

    // 3. Evaluate usage vs limit & safety reserve
    const summary = this.getUsageSummary();
    if (summary.status === BUDGET_STATUS.EXHAUSTED) {
      return {
        allowed: false,
        reason: `BUDGET_GUARD_BLOCKED: Consumed credits (${summary.consumedCredits}) reached usable ceiling (${summary.usableBudget}). Safety reserve of ${this.budgetReserve} credits preserved.`,
        status: BUDGET_STATUS.EXHAUSTED,
        summary
      };
    }

    if (summary.remainingUsable < estimatedCredits) {
      return {
        allowed: false,
        reason: `BUDGET_GUARD_BLOCKED: Estimated call cost (${estimatedCredits}) exceeds remaining usable budget (${summary.remainingUsable}).`,
        status: BUDGET_STATUS.RESERVE_WARNING,
        summary
      };
    }

    return {
      allowed: true,
      summary
    };
  }

  /**
   * Records a provider operation telemetry record in database.
   */
  recordUsage({
    provider = 'gnani',
    operationType,
    isMock = false,
    callStatus = 'SUCCESS',
    reportedCredits = null,
    estimatedCredits = null,
    durationMs = 0,
    metadata = {}
  }) {
    const id = `usg_${crypto.randomUUID().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO provider_usage (
        id, provider, operation_type, is_mock, call_status, reported_credits, estimated_credits, duration_ms, request_metadata_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      provider,
      operationType,
      isMock ? 1 : 0,
      callStatus,
      reportedCredits,
      estimatedCredits,
      durationMs,
      JSON.stringify(metadata),
      timestamp
    );

    return { id, timestamp };
  }
}

module.exports = {
  BudgetGuard,
  BUDGET_STATUS
};
