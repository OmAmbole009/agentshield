const crypto = require('node:crypto');
const { DECISIONS, REASON_CODES } = require('../policy/engine');
const { AUDIT_EVENT_TYPES } = require('../audit/auditLogger');
const { ACTION_TYPES } = require('../registry/actions');

class SecurityGateway {
  constructor({
    db,
    policyEngine,
    challengeService,
    auditLogger,
    bankingService,
    intentExtractor,
    gnaniAdapter
  }) {
    this.db = db;
    this.policyEngine = policyEngine;
    this.challengeService = challengeService;
    this.auditLogger = auditLogger;
    this.bankingService = bankingService;
    this.intentExtractor = intentExtractor;
    this.gnaniAdapter = gnaniAdapter;
  }

  /**
   * Main entrypoint for processing natural language (text or voice) or structured proposals.
   */
  async processRequest({
    text = null,
    audioBuffer = null,
    audioOptions = {},
    directAction = null, // { actionType, payload } if calling API directly
    user,
    agent,
    idempotencyKey = null,
    autoExecuteAllowed = true,
    generateAudio = false
  }) {
    const requestId = `req_${crypto.randomUUID().replace(/-/g, '')}`;
    const startTime = Date.now();

    // 1. Audit: Request Received
    this.auditLogger.logEvent({
      requestId,
      eventType: AUDIT_EVENT_TYPES.REQUEST_RECEIVED,
      agentId: agent?.id,
      userId: user?.id,
      payload: { hasAudio: !!audioBuffer, hasText: !!text, directAction: directAction?.actionType }
    });

    let recognizedText = text;
    let voiceMetadata = null;

    // 2. Voice Pipeline: Speech-to-Text if audio buffer is provided
    if (audioBuffer && this.gnaniAdapter) {
      try {
        const sttResult = await this.gnaniAdapter.transcribeAudio(audioBuffer, audioOptions);
        recognizedText = sttResult.transcript;
        voiceMetadata = {
          confidence: sttResult.confidence,
          model: sttResult.model,
          isMock: sttResult.isMock
        };
      } catch (err) {
        this.auditLogger.logEvent({
          requestId,
          eventType: AUDIT_EVENT_TYPES.PROVIDER_FAILURE,
          agentId: agent?.id,
          userId: user?.id,
          reasonCode: 'STT_TRANSCRIPTION_FAILED',
          payload: { error: err.message }
        });
        // Fail closed or gracefully fall back to empty text
        recognizedText = '';
      }
    }

    // 3. Proposal Extraction & Strict Schema Validation
    let proposal = null;

    if (directAction && directAction.actionType) {
      // Direct API caller proposing structured payload
      const validation = this.policyEngine.evaluate({
        actionType: directAction.actionType,
        payload: directAction.payload,
        user,
        agent
      });
      proposal = {
        actionType: directAction.actionType,
        payload: directAction.payload,
        validation: { isValid: validation.decision !== DECISIONS.DENY || validation.reasonCode !== REASON_CODES.INVALID_PAYLOAD }
      };
    } else {
      // Extract intent from text
      proposal = await this.intentExtractor.extractProposal(recognizedText || '', {
        userId: user?.id,
        defaultAccountId: 'acc_sarah_checking'
      });
    }

    this.auditLogger.logEvent({
      requestId,
      eventType: AUDIT_EVENT_TYPES.PROPOSAL_PARSED,
      agentId: agent?.id,
      userId: user?.id,
      actionType: proposal.actionType,
      payload: proposal.payload
    });

    // 4. Policy Evaluation Engine (Trusted Backend Code)
    const policyDecision = this.policyEngine.evaluate({
      actionType: proposal.actionType,
      payload: proposal.payload,
      user,
      agent
    });

    this.auditLogger.logEvent({
      requestId,
      eventType: AUDIT_EVENT_TYPES.POLICY_EVALUATED,
      agentId: agent?.id,
      userId: user?.id,
      actionType: proposal.actionType,
      decision: policyDecision.decision,
      reasonCode: policyDecision.reasonCode,
      policyId: policyDecision.policyId,
      payload: { decision: policyDecision.decision, reason: policyDecision.message }
    });

    // 5. Decision Branching: DENY, VERIFY, or ALLOW
    let responseText = '';
    let speechAudio = null;
    let executionResult = null;
    let challenge = null;

    if (policyDecision.decision === DECISIONS.DENY) {
      this.auditLogger.logEvent({
        requestId,
        eventType: AUDIT_EVENT_TYPES.ACTION_DENIED,
        agentId: agent?.id,
        userId: user?.id,
        actionType: proposal.actionType,
        decision: DECISIONS.DENY,
        reasonCode: policyDecision.reasonCode,
        policyId: policyDecision.policyId,
        payload: { message: policyDecision.message }
      });

      responseText = `Request Denied: ${policyDecision.message}`;
    } else if (policyDecision.decision === DECISIONS.VERIFY) {
      // Create Step-Up Verification Challenge bound to canonical parameters
      challenge = this.challengeService.createChallenge({
        userId: user.id,
        actionType: proposal.actionType,
        payload: proposal.payload,
        policyId: policyDecision.policyId
      });

      this.auditLogger.logEvent({
        requestId,
        eventType: AUDIT_EVENT_TYPES.VERIFICATION_REQUESTED,
        agentId: agent?.id,
        userId: user?.id,
        actionType: proposal.actionType,
        decision: DECISIONS.VERIFY,
        reasonCode: policyDecision.reasonCode,
        policyId: policyDecision.policyId,
        payload: {
          challengeId: challenge.challengeId,
          expiresAt: challenge.expiresAt,
          parametersHash: challenge.parametersHash
        }
      });

      responseText = `Verification Required: ${policyDecision.message} Please submit your 6-digit confirmation code. (Demo code: ${challenge.code})`;
    } else if (policyDecision.decision === DECISIONS.ALLOW) {
      // Execute operation through protected business API
      if (autoExecuteAllowed) {
        try {
          executionResult = this.executeAuthorizedAction({
            actionType: proposal.actionType,
            payload: proposal.payload,
            user,
            idempotencyKey,
            approvalId: null
          });

          this.auditLogger.logEvent({
            requestId,
            eventType: AUDIT_EVENT_TYPES.ACTION_EXECUTED,
            agentId: agent?.id,
            userId: user?.id,
            actionType: proposal.actionType,
            decision: DECISIONS.ALLOW,
            reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
            policyId: policyDecision.policyId,
            payload: executionResult
          });

          responseText = this.formatSuccessResponse(proposal.actionType, executionResult);
        } catch (execErr) {
          this.auditLogger.logEvent({
            requestId,
            eventType: AUDIT_EVENT_TYPES.ACTION_FAILED,
            agentId: agent?.id,
            userId: user?.id,
            actionType: proposal.actionType,
            reasonCode: 'EXECUTION_FAILED',
            payload: { error: execErr.message }
          });
          responseText = `Execution error: ${execErr.message}`;
        }
      } else {
        responseText = `Operation pre-authorized: ${policyDecision.message}`;
      }
    }

    // 6. Voice Synthesis if requested (Timbre v2.5/v3.0)
    if (generateAudio && this.gnaniAdapter && responseText) {
      try {
        speechAudio = await this.gnaniAdapter.synthesizeSpeech(responseText, {
          voice: 'Nalini',
          model: 'timbre-v2.5'
        });
      } catch (ttsErr) {
        // Fall back gracefully; speech output failure does not alter decision
        console.warn('TTS generation failed:', ttsErr.message);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      requestId,
      recognizedText,
      voiceMetadata,
      proposal: {
        actionType: proposal.actionType,
        payload: proposal.payload,
        isInjectionDetected: proposal.isInjectionDetected
      },
      policyDecision,
      decision: policyDecision.decision,
      requiresApproval: policyDecision.decision === DECISIONS.VERIFY,
      challenge: challenge ? {
        challengeId: challenge.challengeId,
        code: challenge.code,
        expiresAt: challenge.expiresAt,
        actionType: challenge.actionType
      } : null,
      executionResult,
      responseText,
      speechAudio,
      durationMs
    };
  }

  /**
   * Completes a pending step-up verification challenge and executes the operation.
   * Verifies that security-critical parameters were NOT tampered with!
   */
  async verifyAndExecute({
    challengeId,
    code,
    actionType,
    payload,
    user,
    agent,
    idempotencyKey = null
  }) {
    const requestId = `req_verify_${crypto.randomUUID().replace(/-/g, '')}`;

    this.auditLogger.logEvent({
      requestId,
      eventType: AUDIT_EVENT_TYPES.VERIFICATION_ATTEMPTED,
      agentId: agent?.id,
      userId: user?.id,
      actionType,
      payload: { challengeId, submittedCode: '******' }
    });

    // 1. Challenge validation & Parameter tampering check
    const validation = this.challengeService.validateAndConsumeChallenge({
      challengeId,
      code,
      userId: user.id,
      actionType,
      payload
    });

    if (!validation.isValid) {
      const isTampered = validation.errorCode === 'PARAMETER_TAMPERING_DETECTED';
      this.auditLogger.logEvent({
        requestId,
        eventType: isTampered ? AUDIT_EVENT_TYPES.SECURITY_BREACH_ATTEMPT : AUDIT_EVENT_TYPES.VERIFICATION_FAILED,
        agentId: agent?.id,
        userId: user?.id,
        actionType,
        decision: DECISIONS.DENY,
        reasonCode: validation.errorCode,
        payload: { error: validation.error, details: validation.details }
      });

      return {
        success: false,
        decision: DECISIONS.DENY,
        reasonCode: validation.errorCode,
        error: validation.error,
        isTampered
      };
    }

    // 2. Re-evaluate policy at point-of-execution (Defense in Depth)
    const reEvaluation = this.policyEngine.evaluate({
      actionType,
      payload,
      user,
      agent
    });

    // Note: if re-evaluation returns DENY (e.g. balance dropped in interim), deny execution!
    if (reEvaluation.decision === DECISIONS.DENY) {
      this.auditLogger.logEvent({
        requestId,
        eventType: AUDIT_EVENT_TYPES.ACTION_DENIED,
        agentId: agent?.id,
        userId: user?.id,
        actionType,
        decision: DECISIONS.DENY,
        reasonCode: reEvaluation.reasonCode,
        policyId: reEvaluation.policyId,
        payload: { message: reEvaluation.message }
      });

      return {
        success: false,
        decision: DECISIONS.DENY,
        reasonCode: reEvaluation.reasonCode,
        error: reEvaluation.message
      };
    }

    // 3. Execute business operation
    try {
      const executionResult = this.executeAuthorizedAction({
        actionType,
        payload,
        user,
        idempotencyKey,
        approvalId: challengeId
      });

      this.auditLogger.logEvent({
        requestId,
        eventType: AUDIT_EVENT_TYPES.ACTION_EXECUTED,
        agentId: agent?.id,
        userId: user?.id,
        actionType,
        decision: DECISIONS.ALLOW,
        reasonCode: 'VERIFICATION_SUCCESSFUL',
        policyId: reEvaluation.policyId,
        payload: executionResult
      });

      const responseText = this.formatSuccessResponse(actionType, executionResult);

      return {
        success: true,
        decision: DECISIONS.ALLOW,
        executionResult,
        responseText,
        challengeId
      };
    } catch (execErr) {
      this.auditLogger.logEvent({
        requestId,
        eventType: AUDIT_EVENT_TYPES.ACTION_FAILED,
        agentId: agent?.id,
        userId: user?.id,
        actionType,
        reasonCode: 'EXECUTION_FAILED',
        payload: { error: execErr.message }
      });

      return {
        success: false,
        error: execErr.message
      };
    }
  }

  /**
   * Internal dispatcher to authorized business operations
   */
  executeAuthorizedAction({ actionType, payload, user, idempotencyKey, approvalId }) {
    switch (actionType) {
      case ACTION_TYPES.READ_BALANCE:
        return this.bankingService.readBalance({
          accountId: payload.accountId,
          user
        });

      case ACTION_TYPES.TRANSFER_FUNDS:
        return this.bankingService.transferFunds({
          fromAccountId: payload.fromAccountId,
          toRecipientId: payload.toRecipientId,
          amount: payload.amount,
          memo: payload.memo,
          idempotencyKey,
          user,
          approvalId
        });

      case ACTION_TYPES.REQUEST_REFUND:
        return this.bankingService.requestRefund({
          accountId: payload.accountId,
          originalTransactionId: payload.originalTransactionId,
          amount: payload.amount,
          reason: payload.reason,
          user
        });

      case ACTION_TYPES.UPDATE_PREFERENCE:
        return this.bankingService.updatePreference({
          accountId: payload.accountId,
          preferences: payload.preferences,
          user
        });

      default:
        throw new Error(`Cannot execute unsupported action: ${actionType}`);
    }
  }

  formatSuccessResponse(actionType, result) {
    switch (actionType) {
      case ACTION_TYPES.READ_BALANCE:
        return `Your current balance in account ${result.accountNumber} is $${result.balance.toFixed(2)} ${result.currency}.`;
      case ACTION_TYPES.TRANSFER_FUNDS:
        if (result.isReplay) {
          return `Transfer of $${result.transaction.amount.toFixed(2)} to ${result.transaction.recipient_name} was previously completed (idempotency key recognized).`;
        }
        return `Successfully transferred $${result.transaction.amount.toFixed(2)} to ${result.transaction.recipientName}. Remaining balance: $${result.transaction.remainingBalance.toFixed(2)}.`;
      case ACTION_TYPES.REQUEST_REFUND:
        return `Refund request of $${result.transaction.amount.toFixed(2)} processed successfully. New balance: $${result.transaction.newBalance.toFixed(2)}.`;
      case ACTION_TYPES.UPDATE_PREFERENCE:
        return 'Account preferences updated successfully.';
      default:
        return 'Operation completed successfully.';
    }
  }
}

module.exports = {
  SecurityGateway
};
