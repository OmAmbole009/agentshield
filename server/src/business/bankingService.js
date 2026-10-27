const crypto = require('node:crypto');

class BankingService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Executes a balance read. Read-only, zero mutation.
   */
  readBalance({ accountId, user }) {
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }
    return {
      accountId: account.id,
      accountNumber: account.account_number,
      name: account.name,
      balance: account.balance,
      currency: account.currency,
      status: account.status,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Executes an authorized funds transfer with atomic database transaction and idempotency protection.
   */
  transferFunds({ fromAccountId, toRecipientId, amount, memo = '', idempotencyKey = null, user, approvalId = null }) {
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid transfer amount');
    }

    // 1. Idempotency Check: if key already exists, return existing transaction without re-mutating
    if (idempotencyKey) {
      const existingTx = this.db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').get(idempotencyKey);
      if (existingTx) {
        return {
          isReplay: true,
          transaction: existingTx,
          message: 'Idempotent request: returning previous completed execution.'
        };
      }
    }

    const txId = `tx_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    // 2. Atomic Balance Mutation inside Transaction
    // node:sqlite DatabaseSync supports transaction via exec('BEGIN TRANSACTION') or helper
    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');

    try {
      const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(fromAccountId);
      if (!account) {
        throw new Error(`Source account ${fromAccountId} not found.`);
      }

      if (account.balance < numericAmount) {
        throw new Error(`Insufficient funds: account balance is $${account.balance}, requested $${numericAmount}.`);
      }

      const recipient = this.db.prepare('SELECT * FROM recipients WHERE id = ?').get(toRecipientId);
      const recipientName = recipient ? recipient.name : 'Direct Payee';

      const newBalance = Math.round((account.balance - numericAmount) * 100) / 100;

      // Deduct balance
      this.db.prepare(`
        UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?
      `).run(newBalance, now, fromAccountId);

      // Record transaction
      this.db.prepare(`
        INSERT INTO transactions (
          id, account_id, user_id, type, amount, currency, recipient_id, recipient_name, status, idempotency_key, approval_id, executed_at, created_at
        ) VALUES (?, ?, ?, 'TRANSFER', ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)
      `).run(
        txId,
        fromAccountId,
        user.id,
        numericAmount,
        account.currency || 'USD',
        toRecipientId,
        recipientName,
        idempotencyKey || null,
        approvalId || null,
        now,
        now
      );

      this.db.exec('COMMIT;');

      return {
        isReplay: false,
        transaction: {
          id: txId,
          fromAccountId,
          recipientId: toRecipientId,
          recipientName,
          amount: numericAmount,
          currency: account.currency || 'USD',
          status: 'COMPLETED',
          remainingBalance: newBalance,
          idempotencyKey,
          approvalId,
          executedAt: now
        }
      };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Executes a transaction refund.
   */
  requestRefund({ accountId, originalTransactionId, amount, reason, user }) {
    const numericAmount = Number(amount);
    const txId = `ref_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (!account) {
        throw new Error(`Account ${accountId} not found.`);
      }

      const newBalance = Math.round((account.balance + numericAmount) * 100) / 100;

      this.db.prepare(`
        UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?
      `).run(newBalance, now, accountId);

      this.db.prepare(`
        INSERT INTO transactions (
          id, account_id, user_id, type, amount, currency, status, executed_at, created_at
        ) VALUES (?, ?, ?, 'REFUND', ?, ?, 'COMPLETED', ?, ?)
      `).run(
        txId,
        accountId,
        user.id,
        numericAmount,
        account.currency || 'USD',
        now,
        now
      );

      this.db.exec('COMMIT;');

      return {
        transaction: {
          id: txId,
          accountId,
          amount: numericAmount,
          reason,
          newBalance,
          status: 'COMPLETED',
          executedAt: now
        }
      };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Updates non-sensitive preferences safely.
   */
  updatePreference({ accountId, preferences, user }) {
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found.`);
    }

    const currentPrefs = JSON.parse(account.preferences_json || '{}');
    const updatedPrefs = { ...currentPrefs, ...preferences };
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE accounts SET preferences_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(updatedPrefs), now, accountId);

    return {
      accountId,
      preferences: updatedPrefs,
      updatedAt: now
    };
  }

  /**
   * Helper to retrieve all accounts for a specific user
   */
  getUserAccounts(userId) {
    return this.db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
  }

  /**
   * Helper to retrieve all recipients for a user
   */
  getUserRecipients(userId) {
    return this.db.prepare('SELECT * FROM recipients WHERE user_id = ?').all(userId);
  }

  /**
   * Helper to retrieve transaction history
   */
  getTransactionHistory(userId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM transactions WHERE user_id = ? ORDER BY rowid DESC LIMIT ?
    `).all(userId, limit);
  }
}

module.exports = {
  BankingService
};
