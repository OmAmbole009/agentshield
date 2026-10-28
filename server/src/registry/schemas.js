const { z } = require('zod');

// Schema for READ_BALANCE
const ReadBalanceSchema = z.object({
  accountId: z.string().min(3).max(64).regex(/^acc_[a-zA-Z0-9_]+$/, 'Invalid account ID format')
}).strict();

// Schema for TRANSFER_FUNDS
const TransferFundsSchema = z.object({
  fromAccountId: z.string().min(3).max(64).regex(/^acc_[a-zA-Z0-9_]+$/, 'Invalid account ID format'),
  toRecipientId: z.string().min(3).max(64).regex(/^recp_[a-zA-Z0-9_]+$/, 'Invalid recipient ID format'),
  amount: z.number().positive('Amount must be strictly positive').max(1000000, 'Amount exceeds physical limit'),
  memo: z.string().max(120).optional().default('AI Agent Transfer'),
  idempotencyKey: z.string().min(8).max(128).optional()
}).strict();

// Schema for REQUEST_REFUND
const RequestRefundSchema = z.object({
  accountId: z.string().min(3).max(64).regex(/^acc_[a-zA-Z0-9_]+$/, 'Invalid account ID format'),
  originalTransactionId: z.string().min(3).max(64),
  amount: z.number().positive('Refund amount must be positive'),
  reason: z.string().min(3).max(200)
}).strict();

// Schema for UPDATE_PREFERENCE (strict - forbids unauthorized keys like balance, limits, roles)
const UpdatePreferenceSchema = z.object({
  accountId: z.string().min(3).max(64).regex(/^acc_[a-zA-Z0-9_]+$/, 'Invalid account ID format'),
  preferences: z.object({
    emailAlerts: z.boolean().optional(),
    smsAlerts: z.boolean().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    defaultCurrency: z.enum(['USD', 'EUR', 'GBP']).optional()
  }).strict('Preferences contain unauthorized or sensitive configuration keys')
}).strict();

// Schema for EXPORT_CUSTOMER_DATA
const ExportCustomerDataSchema = z.object({
  format: z.enum(['csv', 'json', 'pdf']),
  includePersonallyIdentifiableInformation: z.boolean().default(false),
  tenantId: z.string().min(3).max(64).optional()
}).strict();

// Schema for GET_CUSTOMER_PROFILE
const GetCustomerProfileSchema = z.object({
  customerId: z.string().min(3).max(64).regex(/^cust_[a-zA-Z0-9_]+$/, 'Invalid customer ID format')
}).strict();

// Schema for GET_CUSTOMER_ORDERS
const GetCustomerOrdersSchema = z.object({
  customerId: z.string().min(3).max(64).regex(/^cust_[a-zA-Z0-9_]+$/, 'Invalid customer ID format')
}).strict();

// Schema for ISSUE_REFUND
const IssueRefundSchema = z.object({
  orderId: z.string().min(3).max(64).regex(/^ord_[a-zA-Z0-9_]+$/, 'Invalid order ID format'),
  amount: z.number().positive('Refund amount must be strictly positive').max(100000, 'Amount exceeds maximum allowable threshold'),
  reason: z.string().min(3, 'Refund reason must be at least 3 characters').max(200),
  idempotencyKey: z.string().min(8).max(128).optional()
}).strict();

// Schema for UPDATE_SUBSCRIPTION
const UpdateSubscriptionSchema = z.object({
  subscriptionId: z.string().min(3).max(64).regex(/^sub_[a-zA-Z0-9_]+$/, 'Invalid subscription ID format'),
  newPlan: z.enum(['basic', 'pro', 'enterprise']),
  cancelAtPeriodEnd: z.boolean().optional()
}).strict();

module.exports = {
  ReadBalanceSchema,
  TransferFundsSchema,
  RequestRefundSchema,
  UpdatePreferenceSchema,
  ExportCustomerDataSchema,
  GetCustomerProfileSchema,
  GetCustomerOrdersSchema,
  IssueRefundSchema,
  UpdateSubscriptionSchema
};
