const crypto = require('node:crypto');
const { computeAuditHash, verifyHashChain } = require('./hashChain');

const AUDIT_EVENT_TYPES = {
  REQUEST_RECEIVED: 'REQUEST_RECEIVED',
  PROPOSAL_PARSED: 'PROPOSAL_PARSED',
  POLICY_EVALUATED: 'POLICY_EVALUATED',
  VERIFICATION_REQUESTED: 'VERIFICATION_REQUESTED',
  VERIFICATION_ATTEMPTED: 'VERIFICATION_ATTEMPTED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  ACTION_EXECUTED: 'ACTION_EXECUTED',
  ACTION_DENIED: 'ACTION_DENIED',
  ACTION_FAILED: 'ACTION_FAILED',
  PROVIDER_CALL: 'PROVIDER_CALL',
  PROVIDER_FAILURE: 'PROVIDER_FAILURE',
  SECURITY_BREACH_ATTEMPT: 'SECURITY_BREACH_ATTEMPT'
};

class AuditLogger {
  constructor(db) {
    this.db = db;
  }

  /**
   * Sanitizes payload to remove sensitive data like passwords, secret tokens, or full OTPs.
   */
  sanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const clean = { ...payload };
    const sensitiveKeys = ['password', 'token', 'apiKey', 'code', 'secret', 'authHeader', 'pin'];
    for (const key of Object.keys(clean)) {
      if (sensitiveKeys.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
        clean[key] = '[REDACTED]';
      }
    }
    return JSON.stringify(clean);
  }

  /**
   * Appends an audit event to the tamper-evident hash chain.
   */
  logEvent({
    requestId,
    eventType,
    agentId = null,
    userId = null,
    actionType = null,
    decision = null,
    reasonCode = null,
    policyId = null,
    payload = null
  }) {
    const id = `aud_${crypto.randomUUID().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();
    const payloadSummary = this.sanitizePayload(payload);

    // Get the latest hash in the database
    const lastRow = this.db.prepare('SELECT current_hash FROM audit_log ORDER BY rowid DESC LIMIT 1').get();
    const previousHash = lastRow ? lastRow.current_hash : '0000000000000000000000000000000000000000000000000000000000000000';

    const currentHash = computeAuditHash({
      id,
      timestamp,
      requestId,
      eventType,
      decision,
      reasonCode,
      payloadSummary,
      previousHash
    });

    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, request_id, event_type, agent_id, user_id, action_type, decision, reason_code, policy_id, payload_summary, previous_hash, current_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      timestamp,
      requestId,
      eventType,
      agentId,
      userId,
      actionType,
      decision,
      reasonCode,
      policyId,
      payloadSummary,
      previousHash,
      currentHash
    );

    return {
      id,
      timestamp,
      currentHash
    };
  }

  /**
   * Reads recent audit logs with pagination and filtering.
   */
  getEvents({ limit = 50, offset = 0, eventType = null, decision = null, actionType = null }) {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }
    if (decision) {
      query += ' AND decision = ?';
      params.push(decision);
    }
    if (actionType) {
      query += ' AND action_type = ?';
      params.push(actionType);
    }

    query += ' ORDER BY rowid DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(query).all(...params);
  }

  /**
   * Verifies the cryptographic chain across all historical audit records.
   */
  verifyChainIntegrity() {
    const records = this.db.prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all();
    return verifyHashChain(records);
  }
}

module.exports = {
  AuditLogger,
  AUDIT_EVENT_TYPES
};
