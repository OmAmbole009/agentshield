const { getDb } = require('./connection');
const { initSchema } = require('./schema');

function seedDatabase(db = null) {
  const database = db || getDb();
  initSchema(database);

  const now = new Date().toISOString();

  // Clear existing demo records
  database.exec(`
    DELETE FROM order_refunds;
    DELETE FROM subscriptions;
    DELETE FROM orders;
    DELETE FROM customers;
    DELETE FROM transactions;
    DELETE FROM verification_challenges;
    DELETE FROM recipients;
    DELETE FROM accounts;
    DELETE FROM policies;
    DELETE FROM provider_usage;
    DELETE FROM audit_log;
  `);

  // 1. Seed Accounts
  const insertAccount = database.prepare(`
    INSERT INTO accounts (id, user_id, account_number, name, balance, currency, status, tenant_id, preferences_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAccount.run(
    'acc_sarah_checking',
    'usr_sarah_01',
    'CHK-8829-1092',
    "Sarah's Everyday Checking",
    12450.00,
    'USD',
    'ACTIVE',
    'tenant_retail',
    JSON.stringify({
      emailAlerts: true,
      smsAlerts: true,
      defaultCurrency: 'USD',
      theme: 'dark',
      dailyTransferLimit: 5000
    }),
    now,
    now
  );

  insertAccount.run(
    'acc_michael_savings',
    'usr_michael_02',
    'SAV-4410-9921',
    "Michael's Reserve Savings",
    4800.00,
    'USD',
    'ACTIVE',
    'tenant_retail',
    JSON.stringify({
      emailAlerts: true,
      smsAlerts: false,
      defaultCurrency: 'USD',
      theme: 'light'
    }),
    now,
    now
  );

  insertAccount.run(
    'acc_alex_demo',
    'usr_alex_03',
    'CHK-1102-7741',
    "Alex Demo Checking",
    320.00,
    'USD',
    'ACTIVE',
    'tenant_external',
    JSON.stringify({
      emailAlerts: false,
      smsAlerts: false,
      defaultCurrency: 'USD'
    }),
    now,
    now
  );

  // 2. Seed Recipients
  const insertRecipient = database.prepare(`
    INSERT INTO recipients (id, user_id, name, account_number, bank_name, is_verified, risk_level, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertRecipient.run(
    'recp_electric_co',
    'usr_sarah_01',
    'City Electric Power & Light',
    'ACC-UTIL-9021',
    'First Metro Bank',
    1,
    'LOW',
    now
  );

  insertRecipient.run(
    'recp_landlord_prop',
    'usr_sarah_01',
    'Northgate Property Management',
    'ACC-PROP-3312',
    'Union Trust Bank',
    1,
    'LOW',
    now
  );

  insertRecipient.run(
    'recp_unverified_vendor',
    'usr_sarah_01',
    'Apex Offshore Consulting (Unverified)',
    'ACC-OFFSHORE-9988',
    'Cayman Commercial Bank',
    0,
    'HIGH',
    now
  );

  // 3. Seed Security Policies
  const insertPolicy = database.prepare(`
    INSERT INTO policies (id, name, description, action_type, enabled, rules_json, version, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPolicy.run(
    'policy_balance_read',
    'Account Balance Inquiries',
    'Enforces account ownership and tenant boundary isolation for balance queries',
    'READ_BALANCE',
    1,
    JSON.stringify({
      requireAccountOwnership: true,
      requireTenantMatch: true,
      allowedRoles: ['customer', 'agent', 'admin']
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_transfer_tiered',
    'Tiered Transfer Security Controls',
    'Enforces transaction amount ceilings, mandatory step-up OTP for transfers over $1,000, and unverified recipient review',
    'TRANSFER_FUNDS',
    1,
    JSON.stringify({
      maxSingleAmount: 10000.00,
      stepUpThreshold: 1000.00,
      requireRecipientVerification: true,
      unverifiedRecipientAction: 'VERIFY',
      excessiveAmountAction: 'DENY',
      requireSufficientFunds: true
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_refund',
    'Refund Processing Safeguards',
    'Allows automated small refunds up to $500, requiring supervisor verification above limit',
    'REQUEST_REFUND',
    1,
    JSON.stringify({
      maxAutoRefundAmount: 500.00,
      aboveLimitAction: 'VERIFY',
      requireOriginalTx: true
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_preference_update',
    'Account Preference Guardrails',
    'Allows updates to low-risk display and notification preferences while blocking privilege escalation',
    'UPDATE_PREFERENCE',
    1,
    JSON.stringify({
      allowedFields: ['emailAlerts', 'smsAlerts', 'defaultCurrency', 'theme'],
      forbiddenFields: ['dailyTransferLimit', 'role', 'permissions', 'balance', 'tenant_id'],
      forbiddenFieldAction: 'DENY'
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_customer_data_export',
    'Customer Data Exfiltration Prevention',
    'Strictly forbids autonomous AI agents from bulk customer data extraction',
    'EXPORT_CUSTOMER_DATA',
    1,
    JSON.stringify({
      blockAllAgentExports: true,
      defaultDecision: 'DENY',
      riskLevel: 'CRITICAL',
      alertSecurityOps: true
    }),
    1,
    'system_seed',
    now
  );

  // Customer Support Agent Policies
  insertPolicy.run(
    'policy_support_profile',
    'Customer Profile Access Guard',
    'Enforces customer ownership and tenant boundary isolation for profile inquiries',
    'GET_CUSTOMER_PROFILE',
    1,
    JSON.stringify({
      requireCustomerOwnership: true,
      requireTenantMatch: true,
      allowedRoles: ['customer', 'support-agent', 'admin']
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_support_orders',
    'Customer Orders Access Guard',
    'Enforces customer ownership and tenant boundary isolation for order history queries',
    'GET_CUSTOMER_ORDERS',
    1,
    JSON.stringify({
      requireCustomerOwnership: true,
      requireTenantMatch: true,
      allowedRoles: ['customer', 'support-agent', 'admin']
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_support_refund',
    'Customer Support Tiered Refund Policy',
    'Enforces order eligibility, refundable balance check, $150 step-up threshold, and $1,000 maximum ceiling limit',
    'ISSUE_REFUND',
    1,
    JSON.stringify({
      maxSingleAmount: 1000.00,
      stepUpThreshold: 150.00,
      requireCustomerOwnership: true,
      requireTenantMatch: true,
      requireRemainingBalance: true,
      requireEligibleStatus: true
    }),
    1,
    'system_seed',
    now
  );

  insertPolicy.run(
    'policy_support_subscription',
    'Subscription Change Guardrails',
    'Permits plan adjustments while requiring supervisor approval for Enterprise upgrades',
    'UPDATE_SUBSCRIPTION',
    1,
    JSON.stringify({
      allowedPlans: ['basic', 'pro', 'enterprise'],
      enterpriseRequiresApproval: true,
      requireTenantMatch: true
    }),
    1,
    'system_seed',
    now
  );

  // 4. Seed Customers
  const insertCustomer = database.prepare(`
    INSERT INTO customers (id, user_id, tenant_id, name, email, tier, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCustomer.run(
    'cust_sarah_01',
    'usr_sarah_01',
    'tenant_retail',
    'Sarah Connor',
    'sarah.connor@example.com',
    'PREMIUM',
    'ACTIVE',
    now,
    now
  );

  insertCustomer.run(
    'cust_michael_02',
    'usr_michael_02',
    'tenant_retail',
    'Michael Scott',
    'm.scott@dundermifflin.demo',
    'STANDARD',
    'ACTIVE',
    now,
    now
  );

  insertCustomer.run(
    'cust_alex_03',
    'usr_alex_03',
    'tenant_external',
    'Alex Thorne',
    'alex.thorne@externalcorp.demo',
    'ENTERPRISE',
    'ACTIVE',
    now,
    now
  );

  // 5. Seed Orders
  const insertOrder = database.prepare(`
    INSERT INTO orders (id, customer_id, tenant_id, total_amount, refunded_amount, currency, status, items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertOrder.run(
    'ord_sarah_101',
    'cust_sarah_01',
    'tenant_retail',
    180.00,
    0.0,
    'USD',
    'DELIVERED',
    JSON.stringify([
      { sku: 'SKU-AUDIO-441', name: 'Noise-Canceling Wireless Headphones', price: 180.00, quantity: 1 }
    ]),
    now,
    now
  );

  insertOrder.run(
    'ord_sarah_102',
    'cust_sarah_01',
    'tenant_retail',
    1250.00,
    0.0,
    'USD',
    'DELIVERED',
    JSON.stringify([
      { sku: 'SKU-FURN-901', name: 'Executive Smart Standing Desk', price: 1250.00, quantity: 1 }
    ]),
    now,
    now
  );

  insertOrder.run(
    'ord_sarah_103',
    'cust_sarah_01',
    'tenant_retail',
    45.00,
    45.00,
    'USD',
    'REFUNDED',
    JSON.stringify([
      { sku: 'SKU-CBL-102', name: 'USB-C Fast Charging Hub', price: 45.00, quantity: 1 }
    ]),
    now,
    now
  );

  insertOrder.run(
    'ord_michael_201',
    'cust_michael_02',
    'tenant_retail',
    320.00,
    0.0,
    'USD',
    'DELIVERED',
    JSON.stringify([
      { sku: 'SKU-CHAIR-882', name: 'Ergonomic Mesh Office Chair', price: 320.00, quantity: 1 }
    ]),
    now,
    now
  );

  insertOrder.run(
    'ord_alex_301',
    'cust_alex_03',
    'tenant_external',
    95.00,
    0.0,
    'USD',
    'DELIVERED',
    JSON.stringify([
      { sku: 'SKU-KEY-311', name: 'Mechanical Keypad Pro', price: 95.00, quantity: 1 }
    ]),
    now,
    now
  );

  // 6. Seed Subscriptions
  const insertSub = database.prepare(`
    INSERT INTO subscriptions (id, customer_id, tenant_id, plan, price, status, cancel_at_period_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSub.run(
    'sub_sarah_pro',
    'cust_sarah_01',
    'tenant_retail',
    'pro',
    29.99,
    'ACTIVE',
    0,
    now,
    now
  );

  insertSub.run(
    'sub_michael_basic',
    'cust_michael_02',
    'tenant_retail',
    'basic',
    9.99,
    'ACTIVE',
    0,
    now,
    now
  );

  insertSub.run(
    'sub_alex_basic',
    'cust_alex_03',
    'tenant_external',
    'basic',
    9.99,
    'ACTIVE',
    0,
    now,
    now
  );

  // 7. Seed Genesis Audit Block
  const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const crypto = require('node:crypto');
  const genesisContent = `genesis_${now}`;
  const genesisCurrentHash = crypto.createHash('sha256').update(genesisContent).digest('hex');

  database.prepare(`
    INSERT INTO audit_log (id, timestamp, request_id, event_type, agent_id, user_id, action_type, decision, reason_code, policy_id, payload_summary, previous_hash, current_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'audit_genesis_001',
    now,
    'req_genesis_init',
    'SYSTEM_GENESIS',
    'system',
    'system',
    'SYSTEM_INIT',
    'ALLOW',
    'GENESIS_BLOCK',
    'system_init',
    JSON.stringify({ message: 'AgentShield Cryptographic Audit Trail Initialized' }),
    genesisHash,
    genesisCurrentHash
  );

  return {
    accounts: 3,
    recipients: 3,
    customers: 3,
    orders: 5,
    subscriptions: 3,
    policies: 9
  };
}

// Allow direct CLI execution: node server/src/db/seed.js
if (require.main === module) {
  const result = seedDatabase();
  console.log('Database seeded successfully:', result);
}

module.exports = {
  seedDatabase
};
