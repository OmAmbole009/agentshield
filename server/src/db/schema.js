function initSchema(db) {
  db.exec(`
    -- User Accounts
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      balance REAL NOT NULL CHECK(balance >= 0),
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'ACTIVE',
      tenant_id TEXT NOT NULL,
      preferences_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Pre-approved / Trusted Recipients
    CREATE TABLE IF NOT EXISTS recipients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      is_verified INTEGER DEFAULT 1,
      risk_level TEXT DEFAULT 'LOW',
      created_at TEXT NOT NULL
    );

    -- Business Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      currency TEXT DEFAULT 'USD',
      recipient_id TEXT,
      recipient_name TEXT,
      status TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      approval_id TEXT,
      executed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    -- Single-Use Step-Up Verification Challenges
    CREATE TABLE IF NOT EXISTS verification_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      code TEXT NOT NULL,
      parameters_hash TEXT NOT NULL,
      proposed_payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    -- Tamper-Evident SHA-256 Audit Log
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      agent_id TEXT,
      user_id TEXT,
      action_type TEXT,
      decision TEXT,
      reason_code TEXT,
      policy_id TEXT,
      payload_summary TEXT,
      previous_hash TEXT NOT NULL,
      current_hash TEXT NOT NULL
    );

    -- Configurable Security Policies
    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      action_type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      rules_json TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      updated_by TEXT DEFAULT 'system',
      updated_at TEXT NOT NULL
    );

    -- Provider Usage & Credit Telemetry
    CREATE TABLE IF NOT EXISTS provider_usage (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      is_mock INTEGER NOT NULL,
      call_status TEXT NOT NULL,
      reported_credits REAL,
      estimated_credits REAL,
      duration_ms INTEGER,
      request_metadata_json TEXT,
      timestamp TEXT NOT NULL
    );

    -- Customer Support Agent Entities
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      tier TEXT DEFAULT 'STANDARD',
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      refunded_amount REAL NOT NULL DEFAULT 0.0 CHECK(refunded_amount >= 0),
      currency TEXT DEFAULT 'USD',
      status TEXT NOT NULL,
      items_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS order_refunds (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      approval_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      price REAL NOT NULL,
      status TEXT NOT NULL,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Indexes for high-frequency queries
    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_tx_idempotency ON transactions(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_challenges_user ON verification_challenges(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_audit_req ON audit_log(request_id);
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_order ON order_refunds(order_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_idempotency ON order_refunds(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
  `);
}

module.exports = {
  initSchema
};
