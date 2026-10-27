const crypto = require('node:crypto');
const { computeParametersHash } = require('../registry/actions');
const config = require('../config/env');

const CHALLENGE_STATUS = {
  PENDING: 'PENDING',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED'
};

class ChallengeService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Generates a new cryptographically bound single-use verification challenge.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.actionType
   * @param {Object} params.payload
   * @param {string} params.policyId
   * @returns {Object} Challenge metadata (includes challengeId and demo code)
   */
  createChallenge({ userId, actionType, payload, policyId }) {
    const challengeId = `chg_${crypto.randomUUID().replace(/-/g, '')}`;
    // 6-digit numeric OTP code for demonstration verification
    const code = crypto.randomInt(100000, 999999).toString();
    const parametersHash = computeParametersHash(actionType, payload);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.verificationExpirySeconds * 1000).toISOString();
    const createdAt = now.toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO verification_challenges (
        id, user_id, action_type, code, parameters_hash, proposed_payload_json, status, attempts, max_attempts, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 3, ?, ?)
    `);

    stmt.run(
      challengeId,
      userId,
      actionType,
      code,
      parametersHash,
      JSON.stringify(payload),
      CHALLENGE_STATUS.PENDING,
      expiresAt,
      createdAt
    );

    return {
      challengeId,
      code, // Returned for demo display only; in real prod this would be dispatched via SMS/Authenticator
      actionType,
      expiresAt,
      parametersHash,
      requiresStepUp: true
    };
  }

  /**
   * Validates a challenge submission against the EXACT proposed execution parameters.
   *
   * @param {Object} params
   * @param {string} params.challengeId
   * @param {string} params.code
   * @param {string} params.userId
   * @param {string} params.actionType
   * @param {Object} params.payload
   * @returns {Object} { isValid, challenge, error, errorCode }
   */
  validateAndConsumeChallenge({ challengeId, code, userId, actionType, payload }) {
    if (!challengeId || !code) {
      return {
        isValid: false,
        error: 'Missing required challengeId or verification code.',
        errorCode: 'MISSING_VERIFICATION_CREDENTIALS'
      };
    }

    const challenge = this.db.prepare(`
      SELECT * FROM verification_challenges WHERE id = ?
    `).get(challengeId);

    if (!challenge) {
      return {
        isValid: false,
        error: 'Verification challenge not found.',
        errorCode: 'CHALLENGE_NOT_FOUND'
      };
    }

    // 1. Single-Use Check
    if (challenge.status === CHALLENGE_STATUS.CONSUMED) {
      return {
        isValid: false,
        error: 'Verification challenge has already been consumed (replay prevention).',
        errorCode: 'CHALLENGE_ALREADY_CONSUMED'
      };
    }

    if (challenge.status !== CHALLENGE_STATUS.PENDING) {
      return {
        isValid: false,
        error: `Challenge is invalid (status: ${challenge.status}).`,
        errorCode: 'CHALLENGE_INVALID_STATUS'
      };
    }

    // 2. User Identity Match
    if (challenge.user_id !== userId) {
      return {
        isValid: false,
        error: 'Challenge does not belong to authorized user.',
        errorCode: 'CHALLENGE_USER_MISMATCH'
      };
    }

    // 3. Expiration Check
    const now = new Date();
    const expiry = new Date(challenge.expires_at);
    if (now > expiry) {
      this.db.prepare(`
        UPDATE verification_challenges SET status = ? WHERE id = ?
      `).run(CHALLENGE_STATUS.EXPIRED, challengeId);

      return {
        isValid: false,
        error: 'Verification challenge has expired.',
        errorCode: 'CHALLENGE_EXPIRED'
      };
    }

    // 4. Rate Limiting / Max Attempts Check
    if (challenge.attempts >= challenge.max_attempts) {
      this.db.prepare(`
        UPDATE verification_challenges SET status = ? WHERE id = ?
      `).run(CHALLENGE_STATUS.INVALIDATED, challengeId);

      return {
        isValid: false,
        error: 'Maximum verification attempts exceeded. Challenge invalidated.',
        errorCode: 'MAX_ATTEMPTS_EXCEEDED'
      };
    }

    // 5. Code Match Check
    if (challenge.code !== code.trim()) {
      const newAttempts = challenge.attempts + 1;
      const hasReachedMax = newAttempts >= challenge.max_attempts;
      const newStatus = hasReachedMax ? CHALLENGE_STATUS.INVALIDATED : CHALLENGE_STATUS.PENDING;
      
      this.db.prepare(`
        UPDATE verification_challenges SET attempts = ?, status = ? WHERE id = ?
      `).run(newAttempts, newStatus, challengeId);

      if (hasReachedMax) {
        return {
          isValid: false,
          error: 'Maximum verification attempts exceeded. Challenge invalidated.',
          errorCode: 'MAX_ATTEMPTS_EXCEEDED'
        };
      }

      return {
        isValid: false,
        error: `Incorrect verification code. Attempts remaining: ${challenge.max_attempts - newAttempts}.`,
        errorCode: 'INVALID_VERIFICATION_CODE'
      };
    }

    // 6. Security-Critical Parameter Tampering Check
    // Recompute the parameter hash for the payload currently submitted for execution
    const currentHash = computeParametersHash(actionType, payload);
    if (currentHash !== challenge.parameters_hash) {
      // PARAMETER TAMPERING DETECTED!
      this.db.prepare(`
        UPDATE verification_challenges SET status = ? WHERE id = ?
      `).run(CHALLENGE_STATUS.INVALIDATED, challengeId);

      return {
        isValid: false,
        error: 'SECURITY VIOLATION: Execution parameters (amount, recipient, or account) do not match the approved challenge. Approval invalidated.',
        errorCode: 'PARAMETER_TAMPERING_DETECTED',
        details: {
          originalHash: challenge.parameters_hash,
          attemptedHash: currentHash
        }
      };
    }

    // 7. Atomic Consumption (Single-use enforcement)
    const consumedAt = now.toISOString();
    this.db.prepare(`
      UPDATE verification_challenges SET status = ?, consumed_at = ? WHERE id = ?
    `).run(CHALLENGE_STATUS.CONSUMED, consumedAt, challengeId);

    return {
      isValid: true,
      challenge: {
        ...challenge,
        status: CHALLENGE_STATUS.CONSUMED,
        consumed_at: consumedAt
      }
    };
  }

  getChallenge(challengeId) {
    return this.db.prepare('SELECT * FROM verification_challenges WHERE id = ?').get(challengeId);
  }
}

module.exports = {
  ChallengeService,
  CHALLENGE_STATUS
};
