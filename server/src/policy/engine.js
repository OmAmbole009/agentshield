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
  CROSS_TENANT_ACCESS_DENIED: 'CROSS_TENANT_ACCESS_DENIED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  AMOUNT_EXCEEDS_MAX_LIMIT: 'AMOUNT_EXCEEDS_MAX_LIMIT',
  STEP_UP_VERIFICATION_REQUIRED: 'STEP_UP_VERIFICATION_REQUIRED',
  UNVERIFIED_RECIPIENT_STEPUP: 'UNVERIFIED_RECIPIENT_STEPUP',
  SUPERVISOR_APPROVAL_REQUIRED: 'SUPERVISOR_APPROVAL_REQUIRED',
  RESTRICTED_FIELD_MODIFICATION: 'RESTRICTED_FIELD_MODIFICATION',
  UNAUTHORIZED_DATA_EXFILTRATION_RISK: 'UNAUTHORIZED_DATA_EXFILTRATION_RISK',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  POLICY_DISABLED: 'POLICY_DISABLED'
};

class PolicyEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Load active policies from database or return default fallbacks
   */
  getActivePolicies() {
    try {
      const rows = this.db.prepare('SELECT * FROM policies WHERE enabled = 1').all();
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
  evaluate({ actionType, payload, user, agent }) {
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

    // 4. Action-Specific Policy Rules
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
}

module.exports = {
  PolicyEngine,
  DECISIONS,
  REASON_CODES
};
