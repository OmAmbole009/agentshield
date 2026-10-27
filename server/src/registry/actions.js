const crypto = require('node:crypto');
const {
  ReadBalanceSchema,
  TransferFundsSchema,
  RequestRefundSchema,
  UpdatePreferenceSchema,
  ExportCustomerDataSchema
} = require('./schemas');

const ACTION_TYPES = {
  READ_BALANCE: 'READ_BALANCE',
  TRANSFER_FUNDS: 'TRANSFER_FUNDS',
  REQUEST_REFUND: 'REQUEST_REFUND',
  UPDATE_PREFERENCE: 'UPDATE_PREFERENCE',
  EXPORT_CUSTOMER_DATA: 'EXPORT_CUSTOMER_DATA'
};

const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

const ACTION_REGISTRY = {
  [ACTION_TYPES.READ_BALANCE]: {
    type: ACTION_TYPES.READ_BALANCE,
    name: 'Read Account Balance',
    description: 'Queries balance and active status of an authorized account',
    riskLevel: RISK_LEVELS.LOW,
    requiredPermission: 'accounts:read',
    schema: ReadBalanceSchema,
    isMutating: false,
    requiresApprovalDefault: false,
    getCanonicalParams: (p) => ({ accountId: p.accountId })
  },
  [ACTION_TYPES.TRANSFER_FUNDS]: {
    type: ACTION_TYPES.TRANSFER_FUNDS,
    name: 'Transfer Funds',
    description: 'Transfers funds from user account to a designated recipient',
    riskLevel: RISK_LEVELS.HIGH,
    requiredPermission: 'transfers:execute',
    schema: TransferFundsSchema,
    isMutating: true,
    requiresApprovalDefault: true,
    getCanonicalParams: (p) => ({
      fromAccountId: p.fromAccountId,
      toRecipientId: p.toRecipientId,
      amount: Number(p.amount)
    })
  },
  [ACTION_TYPES.REQUEST_REFUND]: {
    type: ACTION_TYPES.REQUEST_REFUND,
    name: 'Request Transaction Refund',
    description: 'Initiates a reversal or refund request on a past transaction',
    riskLevel: RISK_LEVELS.MEDIUM,
    requiredPermission: 'refunds:execute',
    schema: RequestRefundSchema,
    isMutating: true,
    requiresApprovalDefault: false,
    getCanonicalParams: (p) => ({
      accountId: p.accountId,
      originalTransactionId: p.originalTransactionId,
      amount: Number(p.amount)
    })
  },
  [ACTION_TYPES.UPDATE_PREFERENCE]: {
    type: ACTION_TYPES.UPDATE_PREFERENCE,
    name: 'Update Account Preferences',
    description: 'Updates low-risk notification and UI display preferences',
    riskLevel: RISK_LEVELS.LOW,
    requiredPermission: 'preferences:write',
    schema: UpdatePreferenceSchema,
    isMutating: true,
    requiresApprovalDefault: false,
    getCanonicalParams: (p) => ({
      accountId: p.accountId,
      preferences: p.preferences
    })
  },
  [ACTION_TYPES.EXPORT_CUSTOMER_DATA]: {
    type: ACTION_TYPES.EXPORT_CUSTOMER_DATA,
    name: 'Export Customer Records',
    description: 'Attempts bulk exfiltration or export of customer database records',
    riskLevel: RISK_LEVELS.CRITICAL,
    requiredPermission: 'data:bulk_export',
    schema: ExportCustomerDataSchema,
    isMutating: false,
    requiresApprovalDefault: true,
    getCanonicalParams: (p) => ({
      format: p.format,
      includePII: p.includePersonallyIdentifiableInformation
    })
  }
};

/**
 * Validate action payload against registered schema.
 * Rejects unknown actions and malformed payloads.
 */
function validateActionPayload(actionType, payload) {
  const actionDef = ACTION_REGISTRY[actionType];
  if (!actionDef) {
    return {
      isValid: false,
      error: `Unknown action type: "${actionType}". Allowed actions: ${Object.keys(ACTION_REGISTRY).join(', ')}`,
      errorCode: 'UNKNOWN_ACTION_TYPE'
    };
  }

  const parseResult = actionDef.schema.safeParse(payload);
  if (!parseResult.success) {
    const issues = parseResult.error.issues || parseResult.error.errors || [];
    const errorDetails = issues.map(e => `${(e.path || []).join('.')}: ${e.message}`).join('; ');
    return {
      isValid: false,
      error: `Action payload validation failed: ${errorDetails}`,
      errorCode: 'INVALID_ACTION_PAYLOAD',
      details: issues
    };
  }

  return {
    isValid: true,
    data: parseResult.data,
    actionDef
  };
}

/**
 * Computes a deterministic SHA-256 hash of canonical security parameters.
 * Used for step-up verification binding: if any parameter changes, hash changes!
 */
function computeParametersHash(actionType, payload) {
  const actionDef = ACTION_REGISTRY[actionType];
  if (!actionDef) {
    throw new Error(`Cannot compute parameter hash for unknown action: ${actionType}`);
  }
  const canonical = actionDef.getCanonicalParams(payload);
  const sortedKeys = Object.keys(canonical).sort();
  const sortedObj = {};
  for (const key of sortedKeys) {
    sortedObj[key] = canonical[key];
  }
  return crypto.createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
}

module.exports = {
  ACTION_TYPES,
  RISK_LEVELS,
  ACTION_REGISTRY,
  validateActionPayload,
  computeParametersHash
};
