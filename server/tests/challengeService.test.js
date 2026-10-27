const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db/connection');
const { initSchema } = require('../src/db/schema');
const { ChallengeService, CHALLENGE_STATUS } = require('../src/verification/challengeService');
const { ACTION_TYPES } = require('../src/registry/actions');

describe('Step-Up Verification Challenge & Anti-Tampering Tests', () => {
  let db;
  let challengeService;

  beforeEach(() => {
    db = getDb(':memory:');
    initSchema(db);
    challengeService = new ChallengeService(db);
  });

  it('generates a bound single-use verification challenge with SHA-256 parameter hash', () => {
    const payload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload,
      policyId: 'policy_transfer_tiered'
    });

    assert.ok(challenge.challengeId.startsWith('chg_'));
    assert.equal(challenge.code.length, 6);
    assert.ok(challenge.parametersHash);
    assert.equal(challenge.requiresStepUp, true);

    const record = challengeService.getChallenge(challenge.challengeId);
    assert.equal(record.status, CHALLENGE_STATUS.PENDING);
    assert.equal(record.attempts, 0);
  });

  it('successfully validates and consumes challenge with exact matching parameters', () => {
    const payload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload,
      policyId: 'policy_transfer_tiered'
    });

    const result = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: challenge.code,
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });

    assert.equal(result.isValid, true);
    assert.equal(result.challenge.status, CHALLENGE_STATUS.CONSUMED);

    // Verify in database
    const inDb = challengeService.getChallenge(challenge.challengeId);
    assert.equal(inDb.status, CHALLENGE_STATUS.CONSUMED);
  });

  it('rejects replay attempt: challenge cannot be consumed twice (single-use semantics)', () => {
    const payload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload,
      policyId: 'policy_transfer_tiered'
    });

    // First consumption succeeds
    const first = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: challenge.code,
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });
    assert.equal(first.isValid, true);

    // Second consumption must fail
    const replay = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: challenge.code,
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });

    assert.equal(replay.isValid, false);
    assert.equal(replay.errorCode, 'CHALLENGE_ALREADY_CONSUMED');
  });

  it('CRITICAL: detects and aborts on parameter tampering (amount raised after approval)', () => {
    const originalPayload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: originalPayload,
      policyId: 'policy_transfer_tiered'
    });

    // Attacker modifies amount to $9,500
    const tamperedPayload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 9500.00 // Tampered!
    };

    const result = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: challenge.code,
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: tamperedPayload
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errorCode, 'PARAMETER_TAMPERING_DETECTED');

    // Ensure challenge was invalidated
    const record = challengeService.getChallenge(challenge.challengeId);
    assert.equal(record.status, CHALLENGE_STATUS.INVALIDATED);
  });

  it('CRITICAL: detects and aborts on recipient substitution tampering', () => {
    const originalPayload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: originalPayload,
      policyId: 'policy_transfer_tiered'
    });

    // Attacker substitutes recipient
    const tamperedPayload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_unverified_vendor', // Substituted!
      amount: 1200.00
    };

    const result = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: challenge.code,
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload: tamperedPayload
    });

    assert.equal(result.isValid, false);
    assert.equal(result.errorCode, 'PARAMETER_TAMPERING_DETECTED');
  });

  it('locks out and invalidates after maximum incorrect attempts', () => {
    const payload = {
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_landlord_prop',
      amount: 1200.00
    };

    const challenge = challengeService.createChallenge({
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload,
      policyId: 'policy_transfer_tiered'
    });

    // 3 incorrect guesses
    challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: '000000',
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });

    challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: '111111',
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });

    const third = challengeService.validateAndConsumeChallenge({
      challengeId: challenge.challengeId,
      code: '222222',
      userId: 'usr_sarah_01',
      actionType: ACTION_TYPES.TRANSFER_FUNDS,
      payload
    });

    assert.equal(third.isValid, false);
    assert.equal(third.errorCode, 'MAX_ATTEMPTS_EXCEEDED');

    const inDb = challengeService.getChallenge(challenge.challengeId);
    assert.equal(inDb.status, CHALLENGE_STATUS.INVALIDATED);
  });
});
