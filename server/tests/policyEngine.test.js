const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db/connection');
const { seedDatabase } = require('../src/db/seed');
const { PolicyEngine, DECISIONS, REASON_CODES } = require('../src/policy/engine');
const { ACTION_TYPES } = require('../src/registry/actions');

describe('Deterministic Policy Engine Tests', () => {
  let db;
  let policyEngine;

  const validUser = {
    id: 'usr_sarah_01',
    tenantId: 'tenant_retail',
    role: 'customer'
  };

  const validAgent = {
    id: 'voice-assistant-agent',
    permissions: ['accounts:read', 'transfers:execute', 'refunds:execute', 'preferences:write']
  };

  beforeEach(() => {
    db = getDb(':memory:');
    seedDatabase(db);
    policyEngine = new PolicyEngine(db);
  });

  it('ALLOW: authorized balance query for own account within tenant', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.READ_BALANCE,
      payload: { accountId: 'acc_sarah_checking' },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.ALLOW);
    assert.equal(result.reasonCode, REASON_CODES.ALLOWED_BY_POLICY);
  });

  it('DENY: cross-tenant access to another user\'s account', () => {
    const attackerUser = {
      id: 'usr_alex_03',
      tenantId: 'tenant_external',
      role: 'customer'
    };

    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.READ_BALANCE,
      payload: { accountId: 'acc_sarah_checking' },
      user: attackerUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.CROSS_TENANT_ACCESS_DENIED);
  });

  it('ALLOW: low-risk transfer under $1,000 to pre-verified recipient', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: 250.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.ALLOW);
    assert.equal(result.requiresApproval, false);
  });

  it('VERIFY: transfer exceeding $1,000 threshold requires step-up challenge', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_landlord_prop',
        amount: 1500.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.VERIFY);
    assert.equal(result.requiresApproval, true);
    assert.equal(result.reasonCode, REASON_CODES.STEP_UP_VERIFICATION_REQUIRED);
  });

  it('VERIFY: transfer to unverified recipient requires step-up challenge', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_unverified_vendor',
        amount: 300.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.VERIFY);
    assert.equal(result.reasonCode, REASON_CODES.UNVERIFIED_RECIPIENT_STEPUP);
  });

  it('DENY: excessive transfer exceeding $10,000 maximum ceiling', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_landlord_prop',
        amount: 15000.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.AMOUNT_EXCEEDS_MAX_LIMIT);
  });

  it('DENY: insufficient account balance', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_landlord_prop',
        amount: 9999.00 // Account has 12450, let's test higher than balance:
      },
      user: validUser,
      agent: validAgent
    });
    // Sarah has 12,450. A transfer of 13,000 would fail:
    const insufficientResult = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_landlord_prop',
        amount: 13000.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(insufficientResult.decision, DECISIONS.DENY);
  });

  it('DENY: unauthorized customer data export by AI agent', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.EXPORT_CUSTOMER_DATA,
      payload: {
        format: 'csv',
        includePersonallyIdentifiableInformation: true
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.UNAUTHORIZED_DATA_EXFILTRATION_RISK);
  });

  it('DENY: malformed payload with invalid negative amount', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: -50.00
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.INVALID_PAYLOAD);
  });

  it('DENY: unauthorized preference injection (attempting to set transfer limit or balance)', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.UPDATE_PREFERENCE,
      payload: {
        accountId: 'acc_sarah_checking',
        preferences: {
          dailyTransferLimit: 1000000 // Injected forbidden field
        }
      },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.INVALID_PAYLOAD);
  });

  it('VERIFY: low ASR confidence (< 0.78) downgrades mutating transfer to step-up challenge', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: 250.00
      },
      user: validUser,
      agent: validAgent,
      asrConfidence: 0.65
    });

    assert.equal(result.decision, DECISIONS.VERIFY);
    assert.equal(result.reasonCode, REASON_CODES.LOW_VOICE_TRUST_SCORE);
    assert.equal(result.requiresApproval, true);
  });

  it('VERIFY: low voice biometric score (< 0.80) triggers step-up challenge', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: 250.00
      },
      user: validUser,
      agent: validAgent,
      voiceBiometricScore: 0.72
    });

    assert.equal(result.decision, DECISIONS.VERIFY);
    assert.equal(result.reasonCode, REASON_CODES.LOW_VOICE_TRUST_SCORE);
    assert.equal(result.requiresApproval, true);
  });

  it('ALLOW: high ASR confidence and biometric score permits low-risk transfer', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: 250.00
      },
      user: validUser,
      agent: validAgent,
      asrConfidence: 0.95,
      voiceBiometricScore: 0.92
    });

    assert.equal(result.decision, DECISIONS.ALLOW);
    assert.equal(result.requiresApproval, false);
  });

  it('DENY: multi-turn session velocity lockout after exceeding 3 violations denies mutating action', () => {
    const testSession = 'sess_velocity_test_123';
    // Record 4 violations for session
    for (let i = 0; i < 4; i++) {
      policyEngine.recordSessionViolation(testSession);
    }
    assert.equal(policyEngine.isSessionLockedDown(testSession), true);

    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: {
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_electric_co',
        amount: 50.00
      },
      user: validUser,
      agent: validAgent,
      sessionId: testSession
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.SESSION_LOCKDOWN);
  });

  it('DENY: semantic ownership IDOR check blocks target account not owned by user', () => {
    const result = policyEngine.evaluate({
      actionType: ACTION_TYPES.READ_BALANCE,
      payload: { accountId: 'acc_michael_savings' },
      user: validUser,
      agent: validAgent
    });

    assert.equal(result.decision, DECISIONS.DENY);
    assert.equal(result.reasonCode, REASON_CODES.CROSS_TENANT_ACCESS_DENIED);
  });
});
