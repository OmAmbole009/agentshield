const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');
const { seedDatabase } = require('../src/db/seed');
const { AuditLogger, AUDIT_EVENT_TYPES } = require('../src/audit/auditLogger');

describe('Cryptographic Audit Trail and Hash Chain Verification Tests', () => {
  let db;
  let auditLogger;

  beforeEach(() => {
    db = getDb(':memory:');
    seedDatabase(db);
    auditLogger = new AuditLogger(db);
  });

  it('appends chained audit events and successfully verifies cryptographic hash integrity', () => {
    auditLogger.logEvent({
      requestId: 'req_test_01',
      eventType: AUDIT_EVENT_TYPES.REQUEST_RECEIVED,
      agentId: 'voice-assistant-agent',
      userId: 'usr_sarah_01',
      payload: { action: 'READ_BALANCE' }
    });

    auditLogger.logEvent({
      requestId: 'req_test_01',
      eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATED,
      agentId: 'voice-assistant-agent',
      userId: 'usr_sarah_01',
      decision: 'ALLOW',
      reasonCode: 'ALLOWED_BY_POLICY',
      policyId: 'policy_balance_read'
    });

    auditLogger.logEvent({
      requestId: 'req_test_01',
      eventType: AUDIT_EVENT_TYPES.ACTION_EXECUTED,
      agentId: 'voice-assistant-agent',
      userId: 'usr_sarah_01',
      decision: 'ALLOW',
      payload: { balance: 12450.00 }
    });

    const report = auditLogger.verifyChainIntegrity();
    assert.equal(report.isChainValid, true);
    assert.ok(report.totalVerified >= 4); // 1 genesis + 3 logged
  });

  it('CRITICAL: detects database-level record tampering and identifies broken block', () => {
    const entry1 = auditLogger.logEvent({
      requestId: 'req_tamper_01',
      eventType: AUDIT_EVENT_TYPES.REQUEST_RECEIVED,
      userId: 'usr_sarah_01'
    });

    const entry2 = auditLogger.logEvent({
      requestId: 'req_tamper_02',
      eventType: AUDIT_EVENT_TYPES.ACTION_EXECUTED,
      userId: 'usr_sarah_01',
      decision: 'ALLOW'
    });

    // Malicious adversary attempts direct SQL update to cover their tracks
    db.prepare(`
      UPDATE audit_log SET decision = 'DENY' WHERE id = ?
    `).run(entry2.id);

    const report = auditLogger.verifyChainIntegrity();
    assert.equal(report.isChainValid, false);
    assert.equal(report.brokenRecordId, entry2.id);
    assert.match(report.details, /Cryptographic hash violation/);
  });

  it('sanitizes sensitive data: redacts passwords, tokens, API keys, and OTP codes', () => {
    const rawPayload = {
      username: 'sarah_c',
      password: 'SuperSecretPassword123!',
      token: 'jwt_secret_token_abc',
      code: '881294',
      amount: 500
    };

    auditLogger.logEvent({
      requestId: 'req_sanitize_01',
      eventType: AUDIT_EVENT_TYPES.REQUEST_RECEIVED,
      payload: rawPayload
    });

    const logged = db.prepare('SELECT payload_summary FROM audit_log ORDER BY rowid DESC LIMIT 1').get();
    const parsed = JSON.parse(logged.payload_summary);

    assert.equal(parsed.password, '[REDACTED]');
    assert.equal(parsed.token, '[REDACTED]');
    assert.equal(parsed.code, '[REDACTED]');
    assert.equal(parsed.amount, 500);
  });
});
