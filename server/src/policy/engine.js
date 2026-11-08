const { ACTION_TYPES, RISK_LEVELS, ACTION_REGISTRY, validateActionPayload } = require('../registry/actions');

const DECISIONS = {
  ALLOW: 'ALLOW',
  VERIFY: 'VERIFY',
  DENY: 'DENY'
};

const REASON_CODES = {
  ALLOWED_BY_POLICY: 'ALLOWED_BY_POLICY',
  UNKNOWN_ACTION_TYPE: 'UNKNOWN_ACTION_TYPE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  AGENT_PERMISSION_DENIED: 'AGENT_PERMISSION_DENIED',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  CROSS_TENANT_ACCESS_DENIED: 'CROSS_TENANT_ACCESS_DENIED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  AMOUNT_EXCEEDS_MAX_LIMIT: 'AMOUNT_EXCEEDS_MAX_LIMIT',
  STEP_UP_VERIFICATION_REQUIRED: 'STEP_UP_VERIFICATION_REQUIRED',
  UNVERIFIED_RECIPIENT_STEPUP: 'UNVERIFIED_RECIPIENT_STEPUP',
  SUPERVISOR_APPROVAL_REQUIRED: 'SUPERVISOR_APPROVAL_REQUIRED',
  RESTRICTED_FIELD_MODIFICATION: 'RESTRICTED_FIELD_MODIFICATION',
  UNAUTHORIZED_DATA_EXFILTRATION_RISK: 'UNAUTHORIZED_DATA_EXFILTRATION_RISK',
  EXCEEDS_REFUNDABLE_BALANCE: 'EXCEEDS_REFUNDABLE_BALANCE',
  ORDER_INELIGIBLE_FOR_REFUND: 'ORDER_INELIGIBLE_FOR_REFUND',
  ISSUE_VERIFICATION_REQUIRED: 'ISSUE_VERIFICATION_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  POLICY_DISABLED: 'POLICY_DISABLED',
  LOW_VOICE_TRUST_SCORE: 'LOW_VOICE_TRUST_SCORE',
  SESSION_LOCKDOWN: 'SESSION_LOCKDOWN'
};

class PolicyEngine {
  constructor(db) {
    this.db = db;
    this.sessionViolations = new Map();
    this.lockdownWindowMs = 15 * 60 * 1000;
    this.maxViolationsBeforeLockdown = 3;
  }

  recordSessionViolation(sessionKey) {
    if (!sessionKey) return;
    const now = Date.now();
    const history = (this.sessionViolations.get(sessionKey) || [])
      .filter(ts => now - ts < this.lockdownWindowMs);
    history.push(now);
    this.sessionViolations.set(sessionKey, history);
  }

  isSessionLockedDown(sessionKey) {
    if (!sessionKey) return false;
    const now = Date.now();
    const history = (this.sessionViolations.get(sessionKey) || [])
      .filter(ts => now - ts < this.lockdownWindowMs);
    this.sessionViolations.set(sessionKey, history);
    return history.length > this.maxViolationsBeforeLockdown;
  }

  resetSessionVelocity(sessionKey) {
    if (sessionKey) {
      this.sessionViolations.delete(sessionKey);
    } else {
      this.sessionViolations.clear();
    }
  }

  /**
   * Load active policies from database or return default fallbacks
   */
  getActivePolicies() {
    try {
      const rows = this.db.prepare('SELECT * FROM policies').all();
      const map = {};
      for (const row of rows) {
        map[row.action_type] = {
          ...row,
          rules: JSON.parse(row.rules_json)
        };
      }
      return map;
    } catch (err) {
      console.warn('Failed to load policies from DB, using fallback rules:', err.message);
      return {};
    }
  }

  /**
   * Evaluates an action proposal deterministically.
   *
   * @param {Object} context
   * @param {string} context.actionType
   * @param {Object} context.payload
   * @param {Object} context.user - { id, tenantId, roles, permissions }
   * @param {Object} context.agent - { id, name, permissions }
   * @returns {Object} Structured decision: { decision, reasonCode, policyId, riskLevel, requiresApproval, message, details }
   */
  evaluate({
    actionType,
    payload,
    user,
    agent,
    idempotencyKey = null,
    asrConfidence = null,
    voiceBiometricScore = null,
    sessionId = null
  }) {
    // 1. Schema & Action Registry Validation
    const validation = validateActionPayload(actionType, payload);
    if (!validation.isValid) {
      return {
        decision: DECISIONS.DENY,
        reasonCode: validation.errorCode === 'UNKNOWN_ACTION_TYPE' ? REASON_CODES.UNKNOWN_ACTION_TYPE : REASON_CODES.INVALID_PAYLOAD,
        policyId: 'policy_system_schema_validator',
        riskLevel: RISK_LEVELS.HIGH,
        requiresApproval: false,
        message: validation.error,
        details: validation.details || null
      };
    }

    const actionDef = validation.actionDef;
    const cleanPayload = validation.data;
    const policies = this.getActivePolicies();
    const policy = policies[actionType];

    // Session Velocity & Cumulative Risk Guardrail: Block mutating actions if session is locked down
    const sessionKey = sessionId || user?.id;
    if (actionDef.isMutating && this.isSessionLockedDown(sessionKey)) {
      return {
        decision: DECISIONS.DENY,
        reasonCode: REASON_CODES.SESSION_LOCKDOWN,
        policyId: 'policy_session_velocity_guard',
        riskLevel: RISK_LEVELS.CRITICAL,
        requiresApproval: false,
        message: 'Security Alert: Session has been locked down due to excessive policy denials and security violations. All mutating actions are blocked.',
        details: { sessionKey }
      };
    }

    if (policy && policy.enabled === 0) {
      return {
        decision: DECISIONS.DENY,
        reasonCode: REASON_CODES.POLICY_DISABLED,
        policyId: policy.id,
        riskLevel: RISK_LEVELS.HIGH,
        requiresApproval: false,
        message: `Action blocked because policy "${policy.name}" is disabled.`,
        details: { actionType }
      };
    }

    // 2. High-Risk Action Guard: Exfiltration of customer data is strictly forbidden for conversational AI agents
    if (actionType === ACTION_TYPES.EXPORT_CUSTOMER_DATA) {
      return {
        decision: DECISIONS.DENY,
        reasonCode: REASON_CODES.UNAUTHORIZED_DATA_EXFILTRATION_RISK,
        policyId: policy?.id || 'policy_customer_data_export',
        riskLevel: RISK_LEVELS.CRITICAL,
        requiresApproval: false,
        message: 'Security Violation: Autonomous conversational agents are strictly prohibited from exporting customer records.',
        details: { requestedFormat: cleanPayload.format }
      };
    }

    // 3. Caller Agent Permission Check
    const agentPermissions = agent?.permissions || [];
    if (!agentPermissions.includes(actionDef.requiredPermission) && !agentPermissions.includes('*')) {
      return {
        decision: DECISIONS.DENY,
        reasonCode: REASON_CODES.AGENT_PERMISSION_DENIED,
        policyId: policy?.id || 'policy_agent_rbac',
        riskLevel: RISK_LEVELS.CRITICAL,
        requiresApproval: false,
        message: `Agent "${agent?.id || 'unknown'}" lacks required permission "${actionDef.requiredPermission}" for action "${actionType}".`,
        details: { requiredPermission: actionDef.requiredPermission, grantedPermissions: agentPermissions }
      };
    }

    // Semantic Ownership / IDOR Pre-Check across accounts and customers
    if (user && user.role !== 'admin') {
      if (cleanPayload.accountId) {
        const targetAcc = this.getAccount(cleanPayload.accountId);
        if (targetAcc && (targetAcc.user_id !== user.id || targetAcc.tenant_id !== user.tenantId)) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_ownership_guard',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Cross-tenant or unauthorized account access denied. Account does not belong to user "${user.id}".`,
            details: { targetAccountUser: targetAcc.user_id, targetAccountTenant: targetAcc.tenant_id, callerTenant: user.tenantId }
          };
        }
      }
      if (cleanPayload.customerId) {
        const targetCust = this.getCustomer(cleanPayload.customerId);
        if (targetCust && (targetCust.user_id !== user.id || targetCust.tenant_id !== user.tenantId)) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_ownership_guard',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Cross-tenant or unauthorized customer access denied. Customer record does not belong to user "${user.id}".`,
            details: { targetCustomerId: targetCust.id, targetTenant: targetCust.tenant_id, callerTenant: user.tenantId }
          };
        }
      }
    }

    // 4. Action-Specific Policy Rules
    const decision = this._evaluateActionRules({ actionType, cleanPayload, user, agent, idempotencyKey, policy });

    // 5. Voice/ASR Trust Score Step-Up Guard:
    // If an action is mutating or high-risk AND asrConfidence < 0.78 OR voiceBiometricScore < 0.80 when provided,
    // downgrade ALLOW to VERIFY (step-up challenge) with reason LOW_VOICE_TRUST_SCORE.
    if (decision.decision === DECISIONS.ALLOW) {
      const isMutatingOrHighRisk = actionDef.isMutating || actionDef.riskLevel === RISK_LEVELS.HIGH || actionDef.riskLevel === RISK_LEVELS.CRITICAL;
      const hasLowAsrConfidence = asrConfidence !== null && asrConfidence !== undefined && Number(asrConfidence) < 0.78;
      const hasLowBiometricScore = voiceBiometricScore !== null && voiceBiometricScore !== undefined && Number(voiceBiometricScore) < 0.80;

      if (isMutatingOrHighRisk && (hasLowAsrConfidence || hasLowBiometricScore)) {
        return {
          decision: DECISIONS.VERIFY,
          reasonCode: REASON_CODES.LOW_VOICE_TRUST_SCORE,
          policyId: policy?.id || 'policy_voice_trust_guard',
          riskLevel: RISK_LEVELS.HIGH,
          requiresApproval: true,
          message: `Step-up verification required: Low voice trust score (ASR confidence: ${asrConfidence ?? 'N/A'}, Biometric: ${voiceBiometricScore ?? 'N/A'}).`,
          details: { asrConfidence, voiceBiometricScore, actionType }
        };
      }
    }

    return decision;
  }

  _evaluateActionRules({ actionType, cleanPayload, user, agent, idempotencyKey, policy }) {
    switch (actionType) {

      case ACTION_TYPES.READ_BALANCE: {
        const account = this.getAccount(cleanPayload.accountId);
        if (!account) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ACCOUNT_NOT_FOUND,
            policyId: policy?.id || 'policy_balance_read',
            riskLevel: RISK_LEVELS.LOW,
            requiresApproval: false,
            message: `Account "${cleanPayload.accountId}" not found.`,
            details: null
          };
        }

        // Boundary Isolation: User and Tenant match
        if (account.user_id !== user.id || account.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_balance_read',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Cross-tenant or unauthorized account access denied. Account does not belong to user "${user.id}".`,
            details: { targetAccountUser: account.user_id, targetAccountTenant: account.tenant_id, callerTenant: user.tenantId }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_balance_read',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: 'Account balance query authorized for account owner.',
          details: { accountId: cleanPayload.accountId }
        };
      }

      case ACTION_TYPES.READ_TRANSACTIONS: {
        const account = this.getAccount(cleanPayload.accountId);
        if (!account) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ACCOUNT_NOT_FOUND,
            policyId: policy?.id || 'policy_transaction_read',
            riskLevel: RISK_LEVELS.LOW,
            requiresApproval: false,
            message: `Account "${cleanPayload.accountId}" not found.`,
            details: null
          };
        }
        if (account.user_id !== user.id || account.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_transaction_read',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Transaction history access denied for account "${cleanPayload.accountId}".`,
            details: null
          };
        }
        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_transaction_read',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: 'Transaction history query authorized for account owner.',
          details: { accountId: cleanPayload.accountId }
        };
      }

      case ACTION_TYPES.TRANSFER_FUNDS: {
        const fromAccount = this.getAccount(cleanPayload.fromAccountId);
        if (!fromAccount) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ACCOUNT_NOT_FOUND,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: `Source account "${cleanPayload.fromAccountId}" not found.`,
            details: null
          };
        }

        // Tenant and ownership isolation
        if (fromAccount.user_id !== user.id || fromAccount.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Access denied: Source account does not belong to authorized user "${user.id}".`,
            details: { sourceUser: fromAccount.user_id, callerUser: user.id }
          };
        }

        const rules = policy?.rules || {
          maxSingleAmount: 10000.00,
          stepUpThreshold: 1000.00,
          requireRecipientVerification: true
        };

        const amount = Number(cleanPayload.amount);

        // Ceiling Limit Check
        if (amount > rules.maxSingleAmount) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.AMOUNT_EXCEEDS_MAX_LIMIT,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: false,
            message: `Transfer rejected: Amount ($${amount.toFixed(2)}) exceeds maximum allowable limit ($${rules.maxSingleAmount.toFixed(2)}).`,
            details: { maxLimit: rules.maxSingleAmount, requestedAmount: amount }
          };
        }

        // Check sufficient balance
        if (fromAccount.balance < amount) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.INSUFFICIENT_FUNDS,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: `Transfer rejected: Insufficient funds. Available: $${fromAccount.balance.toFixed(2)}, Requested: $${amount.toFixed(2)}.`,
            details: { availableBalance: fromAccount.balance, requestedAmount: amount }
          };
        }

        // Check recipient verification status
        const recipient = this.getRecipient(cleanPayload.toRecipientId);
        const isUnverifiedRecipient = !recipient || recipient.is_verified !== 1;

        if (isUnverifiedRecipient) {
          return {
            decision: DECISIONS.VERIFY,
            reasonCode: REASON_CODES.UNVERIFIED_RECIPIENT_STEPUP,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: true,
            message: `Step-up verification required: Recipient "${cleanPayload.toRecipientId}" is unverified or outside standard directory.`,
            details: { recipientId: cleanPayload.toRecipientId, amount }
          };
        }

        // Tiered Step-up Threshold (Amount > 1,000)
        if (amount > rules.stepUpThreshold) {
          return {
            decision: DECISIONS.VERIFY,
            reasonCode: REASON_CODES.STEP_UP_VERIFICATION_REQUIRED,
            policyId: policy?.id || 'policy_transfer_tiered',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: true,
            message: `Step-up verification required: Transfer of $${amount.toFixed(2)} exceeds automated approval limit ($${rules.stepUpThreshold.toFixed(2)}).`,
            details: { threshold: rules.stepUpThreshold, requestedAmount: amount }
          };
        }

        // Within limits and verified recipient
        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_transfer_tiered',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Transfer of $${amount.toFixed(2)} within low-risk limits to verified recipient.`,
          details: { amount, recipientId: cleanPayload.toRecipientId }
        };
      }

      case ACTION_TYPES.REQUEST_REFUND: {
        const account = this.getAccount(cleanPayload.accountId);
        if (!account || account.user_id !== user.id) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ACCOUNT_NOT_FOUND,
            policyId: policy?.id || 'policy_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: 'Target account not found or access unauthorized.',
            details: null
          };
        }

        const rules = policy?.rules || { maxAutoRefundAmount: 500.00 };
        const amount = Number(cleanPayload.amount);

        if (amount > rules.maxAutoRefundAmount) {
          return {
            decision: DECISIONS.VERIFY,
            reasonCode: REASON_CODES.SUPERVISOR_APPROVAL_REQUIRED,
            policyId: policy?.id || 'policy_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: true,
            message: `Refund of $${amount.toFixed(2)} exceeds automated refund threshold ($${rules.maxAutoRefundAmount.toFixed(2)}). Requires approval.`,
            details: { amount, threshold: rules.maxAutoRefundAmount }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_refund',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Refund of $${amount.toFixed(2)} authorized under threshold.`,
          details: { amount }
        };
      }

      case ACTION_TYPES.UPDATE_PREFERENCE: {
        const account = this.getAccount(cleanPayload.accountId);
        if (!account || account.user_id !== user.id) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ACCOUNT_NOT_FOUND,
            policyId: policy?.id || 'policy_preference_update',
            riskLevel: RISK_LEVELS.LOW,
            requiresApproval: false,
            message: 'Account not found or access unauthorized.',
            details: null
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_preference_update',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: 'Account preference update authorized.',
          details: { updatedKeys: Object.keys(cleanPayload.preferences) }
        };
      }

      case ACTION_TYPES.GET_CUSTOMER_PROFILE: {
        const customer = this.getCustomer(cleanPayload.customerId);
        if (!customer) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CUSTOMER_NOT_FOUND,
            policyId: policy?.id || 'policy_support_profile',
            riskLevel: RISK_LEVELS.LOW,
            requiresApproval: false,
            message: `Customer profile "${cleanPayload.customerId}" not found.`,
            details: null
          };
        }

        if (customer.user_id !== user.id || customer.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_support_profile',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Cross-tenant or unauthorized customer access denied. Customer record does not belong to user "${user.id}".`,
            details: { targetCustomerId: customer.id, targetTenant: customer.tenant_id, callerTenant: user.tenantId }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_support_profile',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Customer profile query authorized for record owner "${user.id}".`,
          details: { customerId: customer.id, name: customer.name }
        };
      }

      case ACTION_TYPES.GET_CUSTOMER_ORDERS: {
        const customer = this.getCustomer(cleanPayload.customerId);
        if (!customer) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CUSTOMER_NOT_FOUND,
            policyId: policy?.id || 'policy_support_orders',
            riskLevel: RISK_LEVELS.LOW,
            requiresApproval: false,
            message: `Customer "${cleanPayload.customerId}" not found.`,
            details: null
          };
        }

        if (customer.user_id !== user.id || customer.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_support_orders',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Cross-tenant access denied: Orders for "${cleanPayload.customerId}" do not belong to caller "${user.id}".`,
            details: { targetTenant: customer.tenant_id, callerTenant: user.tenantId }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_support_orders',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Customer orders query authorized for customer "${customer.id}".`,
          details: { customerId: customer.id }
        };
      }

      case ACTION_TYPES.ISSUE_REFUND: {
        const order = this.getOrder(cleanPayload.orderId);
        if (!order) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ORDER_NOT_FOUND,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: `Order "${cleanPayload.orderId}" not found.`,
            details: null
          };
        }

        const customer = this.getCustomer(order.customer_id);
        if (!customer || customer.user_id !== user.id || order.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Access denied: Order "${cleanPayload.orderId}" does not belong to authorized user "${user.id}".`,
            details: { orderTenant: order.tenant_id, callerTenant: user.tenantId }
          };
        }

        if (idempotencyKey) {
          const prior = this.db.prepare('SELECT * FROM order_refunds WHERE idempotency_key = ?').get(idempotencyKey);
          if (prior) {
            if (prior.order_id !== order.id || Number(prior.amount) !== Number(cleanPayload.amount)) {
              return {
                decision: DECISIONS.DENY,
                reasonCode: REASON_CODES.IDEMPOTENCY_CONFLICT,
                policyId: policy?.id || 'policy_support_refund',
                riskLevel: RISK_LEVELS.HIGH,
                requiresApproval: false,
                message: 'Idempotency key was already used with different refund parameters.',
                details: { orderId: order.id }
              };
            }
            return {
              decision: DECISIONS.ALLOW,
              reasonCode: 'IDEMPOTENT_REPLAY',
              policyId: policy?.id || 'policy_support_refund',
              riskLevel: RISK_LEVELS.LOW,
              requiresApproval: false,
              message: 'Previously completed refund recognized; no new refund will execute.',
              details: { orderId: order.id, refundId: prior.id }
            };
          }
        }

        // Eligibility check
        if (order.status === 'REFUNDED' || order.status === 'CANCELLED') {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ORDER_INELIGIBLE_FOR_REFUND,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: `Order "${cleanPayload.orderId}" is ineligible for refund (status: ${order.status}).`,
            details: { orderStatus: order.status }
          };
        }

        if (order.payment_status !== 'PAID' || order.delivery_status !== 'DELIVERED' || order.status !== 'DELIVERED') {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ORDER_INELIGIBLE_FOR_REFUND,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: false,
            message: 'Refund blocked: payment and delivery must both be verified in the order record.',
            details: { paymentStatus: order.payment_status, deliveryStatus: order.delivery_status, orderStatus: order.status }
          };
        }

        const amount = Number(cleanPayload.amount);
        const remainingRefundable = Math.round((order.total_amount - order.refunded_amount) * 100) / 100;

        // Refundable balance check
        if (amount > remainingRefundable) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.EXCEEDS_REFUNDABLE_BALANCE,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: false,
            message: `Refund rejected: Requested amount ($${amount.toFixed(2)}) exceeds remaining refundable balance ($${remainingRefundable.toFixed(2)}).`,
            details: { requestedAmount: amount, remainingRefundable, totalAmount: order.total_amount, alreadyRefunded: order.refunded_amount }
          };
        }

        const rules = policy?.rules || {
          maxSingleAmount: 1000.00,
          stepUpThreshold: 150.00
        };

        // Ceiling Limit Check
        if (amount > rules.maxSingleAmount) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.AMOUNT_EXCEEDS_MAX_LIMIT,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: false,
            message: `Refund rejected: Amount ($${amount.toFixed(2)}) exceeds maximum allowable refund limit ($${rules.maxSingleAmount.toFixed(2)}).`,
            details: { maxLimit: rules.maxSingleAmount, requestedAmount: amount }
          };
        }

        const verifiedIssue = this.db.prepare(`SELECT id FROM support_issues WHERE order_id = ? AND customer_id = ? AND status = 'OPEN' AND classification IN ('DEFECT_REPORTED','DAMAGE_REPORTED','MISSING_ITEM','WRONG_ITEM') ORDER BY created_at DESC LIMIT 1`).get(order.id, order.customer_id);
        if (!verifiedIssue) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ISSUE_VERIFICATION_REQUIRED,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: 'A refund requires a recorded and classified product issue from the support workflow.',
            details: { orderId: order.id }
          };
        }
        const orderItems = JSON.parse(order.items_json || '[]');
        if (!orderItems.length || orderItems.some(item => !this.db.prepare('SELECT 1 FROM support_products WHERE sku = ? AND returnable = 1').get(item.sku))) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.ORDER_INELIGIBLE_FOR_REFUND,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: 'Product is missing from the verified catalog or is marked non-returnable.',
            details: { orderId: order.id }
          };
        }

        const refundRules = policy?.rules || {};
        if (refundRules.returnWindowDays) {
          const ageDays = order.purchase_date ? Math.floor((Date.now() - Date.parse(order.purchase_date)) / 86400000) : Infinity;
          if (!Number.isFinite(ageDays) || ageDays > refundRules.returnWindowDays) {
            return {
              decision: DECISIONS.DENY,
              reasonCode: REASON_CODES.ORDER_INELIGIBLE_FOR_REFUND,
              policyId: policy?.id || 'policy_support_refund',
              riskLevel: RISK_LEVELS.MEDIUM,
              requiresApproval: false,
              message: `The configured ${refundRules.returnWindowDays}-day return period has passed. Warranty or exception review may still be available.`,
              details: { purchaseDate: order.purchase_date, returnWindowDays: refundRules.returnWindowDays }
            };
          }
        }

        // Tiered Step-up Threshold (Amount > $150.00)
        if (amount > rules.stepUpThreshold) {
          return {
            decision: DECISIONS.VERIFY,
            reasonCode: REASON_CODES.STEP_UP_VERIFICATION_REQUIRED,
            policyId: policy?.id || 'policy_support_refund',
            riskLevel: RISK_LEVELS.HIGH,
            requiresApproval: true,
            message: `Step-up verification required: Refund of $${amount.toFixed(2)} exceeds automated approval limit ($${rules.stepUpThreshold.toFixed(2)}).`,
            details: { threshold: rules.stepUpThreshold, requestedAmount: amount }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_support_refund',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Refund of $${amount.toFixed(2)} within automated approval threshold for order "${order.id}".`,
          details: { orderId: order.id, amount }
        };
      }

      case ACTION_TYPES.UPDATE_SUBSCRIPTION: {
        const sub = this.getSubscription(cleanPayload.subscriptionId);
        if (!sub) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.SUBSCRIPTION_NOT_FOUND,
            policyId: policy?.id || 'policy_support_subscription',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: false,
            message: `Subscription "${cleanPayload.subscriptionId}" not found.`,
            details: null
          };
        }

        const customer = this.getCustomer(sub.customer_id);
        if (!customer || customer.user_id !== user.id || sub.tenant_id !== user.tenantId) {
          return {
            decision: DECISIONS.DENY,
            reasonCode: REASON_CODES.CROSS_TENANT_ACCESS_DENIED,
            policyId: policy?.id || 'policy_support_subscription',
            riskLevel: RISK_LEVELS.CRITICAL,
            requiresApproval: false,
            message: `Access denied: Subscription does not belong to authorized user "${user.id}".`,
            details: { subscriptionTenant: sub.tenant_id, callerTenant: user.tenantId }
          };
        }

        if (cleanPayload.newPlan === 'enterprise') {
          return {
            decision: DECISIONS.VERIFY,
            reasonCode: REASON_CODES.SUPERVISOR_APPROVAL_REQUIRED,
            policyId: policy?.id || 'policy_support_subscription',
            riskLevel: RISK_LEVELS.MEDIUM,
            requiresApproval: true,
            message: 'Subscription upgrade to "enterprise" tier requires supervisor verification.',
            details: { subscriptionId: sub.id, currentPlan: sub.plan, requestedPlan: cleanPayload.newPlan }
          };
        }

        return {
          decision: DECISIONS.ALLOW,
          reasonCode: REASON_CODES.ALLOWED_BY_POLICY,
          policyId: policy?.id || 'policy_support_subscription',
          riskLevel: RISK_LEVELS.LOW,
          requiresApproval: false,
          message: `Subscription plan change to "${cleanPayload.newPlan}" authorized.`,
          details: { subscriptionId: sub.id, newPlan: cleanPayload.newPlan }
        };
      }

      default:
        return {
          decision: DECISIONS.DENY,
          reasonCode: REASON_CODES.UNKNOWN_ACTION_TYPE,
          policyId: 'policy_unknown',
          riskLevel: RISK_LEVELS.HIGH,
          requiresApproval: false,
          message: `Unhandled action type: ${actionType}`,
          details: null
        };
    }
  }

  getAccount(accountId) {
    try {
      return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    } catch {
      return null;
    }
  }

  getRecipient(recipientId) {
    try {
      return this.db.prepare('SELECT * FROM recipients WHERE id = ?').get(recipientId);
    } catch {
      return null;
    }
  }

  getCustomer(customerId) {
    try {
      return this.db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    } catch {
      return null;
    }
  }

  getOrder(orderId) {
    try {
      return this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    } catch {
      return null;
    }
  }

  getSubscription(subscriptionId) {
    try {
      return this.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
    } catch {
      return null;
    }
  }
}

module.exports = {
  PolicyEngine,
  DECISIONS,
  REASON_CODES
};
