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
    customerSupportService,
    intentExtractor,
    gnaniAdapter
  }) {
    this.db = db;
    this.policyEngine = policyEngine;
    this.challengeService = challengeService;
    this.auditLogger = auditLogger;
    this.bankingService = bankingService;
    this.customerSupportService = customerSupportService;
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
    generateAudio = false,
    asrConfidence = null,
    voiceBiometricScore = null,
    sessionId = null
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
    let piiRedacted = false;
    let redactedPiiTypes = [];

    // Pre-Processing Guardrail: Bidirectional PII Scrubber for textual input
    if (recognizedText) {
      const scrubResult = this.scrubPII(recognizedText);
      if (scrubResult.piiDetected) {
        piiRedacted = true;
        redactedPiiTypes = scrubResult.redactedTypes;
        recognizedText = scrubResult.scrubbedText;
        this.auditLogger.logEvent({
          requestId,
          eventType: AUDIT_EVENT_TYPES.PII_REDACTED,
          agentId: agent?.id,
          userId: user?.id,
          reasonCode: 'PII_REDACTED',
          payload: { redactedTypes: scrubResult.redactedTypes }
        });
      }
    }

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
        // Auto-populate asrConfidence if not explicitly supplied
        if (asrConfidence === null && sttResult.confidence !== undefined) {
          asrConfidence = sttResult.confidence;
        }

        // Scrub PII from transcribed audio
        if (recognizedText) {
          const sttScrub = this.scrubPII(recognizedText);
          if (sttScrub.piiDetected) {
            piiRedacted = true;
            redactedPiiTypes = Array.from(new Set([...redactedPiiTypes, ...sttScrub.redactedTypes]));
            recognizedText = sttScrub.scrubbedText;
            this.auditLogger.logEvent({
              requestId,
              eventType: AUDIT_EVENT_TYPES.PII_REDACTED,
              agentId: agent?.id,
              userId: user?.id,
              reasonCode: 'PII_REDACTED',
              payload: { redactedTypes: sttScrub.redactedTypes }
            });
          }
        }
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
        agent,
        idempotencyKey,
        asrConfidence,
        voiceBiometricScore,
        sessionId
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
        defaultAccountId: this.bankingService.getUserAccounts(user?.id)?.[0]?.id || 'acc_sarah_checking'
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
      agent,
      idempotencyKey,
      asrConfidence,
      voiceBiometricScore,
      sessionId
    });

    // Track session velocity & cumulative risk violations
    const sessionKey = sessionId || user?.id;
    if (policyDecision.decision === DECISIONS.DENY || proposal.isInjectionDetected) {
      this.policyEngine.recordSessionViolation(sessionKey);
      if (this.policyEngine.isSessionLockedDown(sessionKey)) {
        this.auditLogger.logEvent({
          requestId,
          eventType: AUDIT_EVENT_TYPES.SESSION_LOCKDOWN,
          agentId: agent?.id,
          userId: user?.id,
          actionType: proposal.actionType,
          decision: DECISIONS.DENY,
          reasonCode: REASON_CODES.SESSION_LOCKDOWN,
          payload: { sessionKey, reason: 'Exceeded 3 policy denials or injection attempts' }
        });
      }
    }

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

    // Output Egress Guardrail: Scan outbound response for leaked instructions, stack traces, raw SQL, or unmasked PII
    let egressFiltered = false;
    if (responseText) {
      const egressCheck = this.filterEgressResponse(responseText);
      if (egressCheck.egressFiltered) {
        egressFiltered = true;
        responseText = egressCheck.filteredText;
        this.auditLogger.logEvent({
          requestId,
          eventType: AUDIT_EVENT_TYPES.OUTPUT_EGRESS_FILTERED,
          agentId: agent?.id,
          userId: user?.id,
          reasonCode: 'OUTPUT_EGRESS_FILTERED',
          payload: { reasons: egressCheck.reasons }
        });
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
      durationMs,
      piiRedacted,
      redactedPiiTypes,
      egressFiltered,
      voiceTrustScore: asrConfidence !== null ? Number(asrConfidence) : (voiceMetadata?.confidence ?? null),
      voiceBiometricScore: voiceBiometricScore !== null ? Number(voiceBiometricScore) : null,
      sessionRiskLevel: this.policyEngine.isSessionLockedDown(sessionKey) ? 'CRITICAL_LOCKDOWN' : 'NORMAL'
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

    // Check idempotency replay before challenge validation
    if (idempotencyKey) {
      const existingTx = this.db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingTx) {
        const replayResult = {
          isReplay: true,
          transaction: existingTx,
          message: 'Idempotent request: returning previous completed execution.'
        };
        return {
          success: true,
          decision: DECISIONS.ALLOW,
          executionResult: replayResult,
          responseText: this.formatSuccessResponse(actionType, replayResult)
        };
      }
    }

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
      agent,
      idempotencyKey
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

      const rawResponseText = this.formatSuccessResponse(actionType, executionResult);
      const egressCheck = this.filterEgressResponse(rawResponseText);
      const responseText = egressCheck.filteredText;
      if (egressCheck.egressFiltered) {
        this.auditLogger.logEvent({
          requestId,
          eventType: AUDIT_EVENT_TYPES.OUTPUT_EGRESS_FILTERED,
          agentId: agent?.id,
          userId: user?.id,
          reasonCode: 'OUTPUT_EGRESS_FILTERED',
          payload: { reasons: egressCheck.reasons }
        });
      }

      return {
        success: true,
        decision: DECISIONS.ALLOW,
        executionResult,
        responseText,
        challengeId,
        egressFiltered: egressCheck.egressFiltered
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

  rejectPendingApproval({ challengeId, user, agent }) {
    const requestId = `req_reject_${crypto.randomUUID().replace(/-/g, '')}`;
    const rejected = this.challengeService.rejectPendingChallenge({ challengeId, userId: user?.id });
    this.auditLogger.logEvent({
      requestId,
      eventType: rejected ? AUDIT_EVENT_TYPES.VERIFICATION_REJECTED : AUDIT_EVENT_TYPES.VERIFICATION_FAILED,
      agentId: agent?.id,
      userId: user?.id,
      reasonCode: rejected ? 'APPROVAL_REJECTED' : 'APPROVAL_NOT_PENDING_OR_NOT_OWNED',
      payload: { challengeId }
    });
    return rejected
      ? { success: true, status: 'REJECTED', message: 'Pending action rejected. No tool was executed.' }
      : { success: false, status: 'UNCHANGED', error: 'Pending approval not found for this user.' };
  }

  /**
   * Internal dispatcher to authorized business operations
   */
  executeApprovedSupportRefund({ orderId, amount, reason, idempotencyKey, user, reviewer }) {
    const actionType = ACTION_TYPES.ISSUE_REFUND;
    const payload = { orderId, amount, reason, idempotencyKey };
    const agent = { id: 'human-approved-support', permissions: ['refunds:execute'] };
    const decision = this.policyEngine.evaluate({ actionType, payload, user, agent, idempotencyKey });
    if (decision.decision === DECISIONS.DENY) throw new Error(`AgentShield denied reviewer execution: ${decision.message}`);
    const result = this.executeAuthorizedAction({ actionType, payload, user, idempotencyKey, approvalId: `review_${reviewer.id}` });
    this.auditLogger.logEvent({
      requestId: `req_review_${crypto.randomUUID().replace(/-/g, '')}`,
      eventType: AUDIT_EVENT_TYPES.ACTION_EXECUTED,
      agentId: reviewer.id,
      userId: user.id,
      actionType,
      decision: DECISIONS.ALLOW,
      reasonCode: 'HUMAN_REVIEW_APPROVED',
      policyId: decision.policyId,
      payload: { orderId, amount, approvalId: `review_${reviewer.id}`, sandbox: true }
    });
    return result;
  }

  executeAuthorizedAction({ actionType, payload, user, idempotencyKey, approvalId }) {
    switch (actionType) {
      case ACTION_TYPES.READ_BALANCE:
        return this.bankingService.readBalance({
          accountId: payload.accountId,
          user
        });

      case ACTION_TYPES.READ_TRANSACTIONS:
        return this.bankingService.getAccountTransactionHistory({
          accountId: payload.accountId,
          limit: payload.limit,
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

      case ACTION_TYPES.GET_CUSTOMER_PROFILE:
        return this.customerSupportService.getCustomerProfile({
          customerId: payload.customerId,
          user
        });

      case ACTION_TYPES.GET_CUSTOMER_ORDERS:
        return this.customerSupportService.getCustomerOrders({
          customerId: payload.customerId,
          user
        });

      case ACTION_TYPES.ISSUE_REFUND:
        return this.customerSupportService.issueRefund({
          orderId: payload.orderId,
          amount: payload.amount,
          reason: payload.reason,
          idempotencyKey,
          user,
          approvalId,
          simulateFailure: payload.simulateFailure || false
        });

      case ACTION_TYPES.UPDATE_SUBSCRIPTION:
        return this.customerSupportService.updateSubscription({
          subscriptionId: payload.subscriptionId,
          newPlan: payload.newPlan,
          cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
          user
        });

      default:
        throw new Error(`Cannot execute unsupported action: ${actionType}`);
    }
  }

  /**
   * Bidirectional PII Scrubber: Detects and redacts sensitive Indian and banking PII.
   */
  scrubPII(text) {
    if (!text || typeof text !== 'string') {
      return { scrubbedText: text, piiDetected: false, redactedTypes: [] };
    }

    let scrubbed = text;
    const redactedTypes = new Set();

    // 1. Credit / Debit Card: 16 digits (e.g. 4111 2222 3333 4444, 4111-2222-3333-4444, 4111222233334444)
    const cardRegex = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
    if (cardRegex.test(scrubbed)) {
      redactedTypes.add('CARD');
      scrubbed = scrubbed.replace(cardRegex, '<REDACTED_CARD>');
    }

    // 2. CVV / CVC (3-4 digits labeled)
    const cvvRegex = /\b(?:cvv|cvc|security\s*code)[:\s]*([0-9]{3,4})\b/gi;
    if (cvvRegex.test(scrubbed)) {
      redactedTypes.add('CVV');
      scrubbed = scrubbed.replace(cvvRegex, (match, code) => match.replace(code, '<REDACTED_CVV>'));
    }

    // 3. Aadhaar: 12 digits (4 4 4 digits with optional space or hyphen)
    const aadhaarRegex = /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
    if (aadhaarRegex.test(scrubbed)) {
      redactedTypes.add('AADHAAR');
      scrubbed = scrubbed.replace(aadhaarRegex, '<REDACTED_AADHAAR>');
    }

    // 4. PAN: [A-Z]{5}[0-9]{4}[A-Z]{1}
    const panRegex = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g;
    if (panRegex.test(scrubbed)) {
      redactedTypes.add('PAN');
      scrubbed = scrubbed.replace(panRegex, '<REDACTED_PAN>');
    }

    // 5. OTP / Verification code (4-8 digits labeled)
    const otpRegex = /\b(?:otp|one[- ]time[- ]password|verification code)[:\s]*([0-9]{4,8})\b/gi;
    if (otpRegex.test(scrubbed)) {
      redactedTypes.add('OTP');
      scrubbed = scrubbed.replace(otpRegex, (match, code) => match.replace(code, '<REDACTED_OTP>'));
    }

    // 6. Emails
    const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
    if (emailRegex.test(scrubbed)) {
      redactedTypes.add('EMAIL');
      scrubbed = scrubbed.replace(emailRegex, '<REDACTED_EMAIL>');
    }

    // 7. Phone numbers: Indian mobile (+91-9876543210, 09876543210, 9876543210)
    const phoneRegex = /(?:\+91[\s-]?)?[6789]\d{9}\b/g;
    if (phoneRegex.test(scrubbed)) {
      redactedTypes.add('PHONE');
      scrubbed = scrubbed.replace(phoneRegex, '<REDACTED_PHONE>');
    }

    return {
      scrubbedText: scrubbed,
      piiDetected: redactedTypes.size > 0,
      redactedTypes: Array.from(redactedTypes)
    };
  }

  /**
   * Output Egress Guardrail: Scans and scrubs outbound agent/LLM replies.
   */
  filterEgressResponse(text) {
    if (!text || typeof text !== 'string') {
      return { filteredText: text, egressFiltered: false, reasons: [] };
    }

    let filtered = text;
    const reasons = [];

    // 1. Strip leaked system instructions or prompt markers
    const instructionPatterns = [
      /You are an action extraction assistant[^\n.]*\.?/gi,
      /You are a customer support agent[^\n.]*\.?/gi,
      /system prompt:[^\n.]*\.?/gi,
      /system instructions?:[^\n.]*\.?/gi,
      /\[SYSTEM\]:/gi,
      /<<SYS>>[\s\S]*?<<\/SYS>>/gi,
      /<<\/?SYS>>/gi,
      /<\|im_start\|>system[\s\S]*?<\|im_end\|>/gi
    ];
    for (const pat of instructionPatterns) {
      if (pat.test(filtered)) {
        reasons.push('SYSTEM_INSTRUCTION_LEAK');
        filtered = filtered.replace(pat, '[REDACTED_SYSTEM_INSTRUCTION]').trim();
      }
    }

    // 2. Strip internal stack traces
    const stackTracePattern = /(?:Error|Exception|TypeError|ReferenceError):\s+.*\n(?:\s+at\s+.*)+|(?:\s*at\s+.*(?:\.js|\.ts):\d+:\d+)|(?:\bat\s+Object\.<anonymous>)/g;
    if (stackTracePattern.test(filtered)) {
      reasons.push('STACK_TRACE_LEAK');
      filtered = filtered.replace(stackTracePattern, '[INTERNAL_ERROR_STACK_REDACTED]');
    }

    // 3. Strip raw SQL / DB schema identifiers
    const sqlPatterns = [
      /\b(?:SELECT\s+.*?\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\s+\w+/gi,
      /\bsqlite_master\b/gi,
      /\bPRAGMA\s+\w+/gi
    ];
    for (const pat of sqlPatterns) {
      if (pat.test(filtered)) {
        reasons.push('SQL_EXPOSURE');
        filtered = filtered.replace(pat, '[REDACTED_SQL_IDENTIFIER]');
      }
    }

    // 4. Scrub any unmasked PII in output (Bidirectional PII Guard)
    const piiResult = this.scrubPII(filtered);
    if (piiResult.piiDetected) {
      reasons.push(`UNMASKED_PII_${piiResult.redactedTypes.join('_')}`);
      filtered = piiResult.scrubbedText;
    }

    return {
      filteredText: filtered,
      egressFiltered: reasons.length > 0,
      reasons
    };
  }

  formatSuccessResponse(actionType, result) {
    switch (actionType) {
      case ACTION_TYPES.READ_BALANCE:
        return `Your current balance in account ${result.accountNumber} is $${result.balance.toFixed(2)} ${result.currency}.`;
      case ACTION_TYPES.READ_TRANSACTIONS:
        return `Retrieved ${result.transactions.length} transaction(s) for account ${result.accountNumber}.`;
      case ACTION_TYPES.TRANSFER_FUNDS:
        if (result.isReplay) {
          return `Transfer of $${result.transaction.amount.toFixed(2)} to ${result.transaction.recipient_name} was previously completed (idempotency key recognized).`;
        }
        return `Successfully transferred $${result.transaction.amount.toFixed(2)} to ${result.transaction.recipientName}. Remaining balance: $${result.transaction.remainingBalance.toFixed(2)}.`;
      case ACTION_TYPES.REQUEST_REFUND:
        return `Refund request of $${result.transaction.amount.toFixed(2)} processed successfully. New balance: $${result.transaction.newBalance.toFixed(2)}.`;
      case ACTION_TYPES.UPDATE_PREFERENCE:
        return 'Account preferences updated successfully.';
      case ACTION_TYPES.GET_CUSTOMER_PROFILE:
        return `Customer profile for ${result.name} (${result.tier} tier) retrieved successfully.`;
      case ACTION_TYPES.GET_CUSTOMER_ORDERS:
        return `Retrieved ${result.orders.length} order(s) for customer ${result.customerName}.`;
      case ACTION_TYPES.ISSUE_REFUND:
        if (result.isReplay) {
          return `Refund of $${result.refund.amount.toFixed(2)} for order ${result.refund.order_id} was previously completed (idempotent replay recognized).`;
        }
        return `Successfully issued refund of $${result.refund.amount.toFixed(2)} for order ${result.order.id}. Remaining refundable balance: $${result.order.remainingRefundable.toFixed(2)}.`;
      case ACTION_TYPES.UPDATE_SUBSCRIPTION:
        return `Subscription ${result.subscription.id} plan updated to "${result.newPlan}".`;
      default:
        return 'Operation completed successfully.';
    }
  }
}

module.exports = {
  SecurityGateway
};
