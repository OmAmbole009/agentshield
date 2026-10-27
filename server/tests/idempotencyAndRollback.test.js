const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getDb } = require('../src/db/connection');
const { seedDatabase } = require('../src/db/seed');
const { BankingService } = require('../src/business/bankingService');

describe('Idempotency and Atomic Rollback Tests', () => {
  let db;
  let bankingService;

  const user = {
    id: 'usr_sarah_01',
    tenantId: 'tenant_retail'
  };

  beforeEach(() => {
    db = getDb(':memory:');
    seedDatabase(db);
    bankingService = new BankingService(db);
  });

  it('executes a valid transfer and deducts balance atomically by exact amount', () => {
    const preAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    const startBalance = preAccount.balance; // 12450

    const result = bankingService.transferFunds({
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_electric_co',
      amount: 150.00,
      memo: 'Electric bill payment',
      user
    });

    assert.equal(result.isReplay, false);
    assert.equal(result.transaction.amount, 150.00);
    assert.equal(result.transaction.remainingBalance, startBalance - 150.00);

    const postAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    assert.equal(postAccount.balance, startBalance - 150.00);
  });

  it('idempotency: repeating identical request with same key returns previous transaction without double deduction', () => {
    const startAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    const initialBalance = startAccount.balance;
    const idempotencyKey = 'idem_unique_tx_key_9988';

    // First call
    const firstCall = bankingService.transferFunds({
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_electric_co',
      amount: 100.00,
      memo: 'First payment',
      idempotencyKey,
      user
    });

    assert.equal(firstCall.isReplay, false);
    assert.equal(firstCall.transaction.remainingBalance, initialBalance - 100.00);

    // Second call with same idempotency key
    const secondCall = bankingService.transferFunds({
      fromAccountId: 'acc_sarah_checking',
      toRecipientId: 'recp_electric_co',
      amount: 100.00,
      memo: 'Duplicate payment attempt',
      idempotencyKey,
      user
    });

    assert.equal(secondCall.isReplay, true);
    assert.equal(secondCall.transaction.id, firstCall.transaction.id);

    // Verify balance was ONLY deducted once!
    const finalAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    assert.equal(finalAccount.balance, initialBalance - 100.00);

    // Verify only 1 transaction record exists in DB
    const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = ?').get(idempotencyKey);
    assert.equal(txCount.count, 1);
  });

  it('atomic rollback: zero balance mutation when transaction fails (insufficient funds)', () => {
    const startAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    const initialBalance = startAccount.balance;

    assert.throws(() => {
      bankingService.transferFunds({
        fromAccountId: 'acc_sarah_checking',
        toRecipientId: 'recp_landlord_prop',
        amount: 999999.00, // Exceeds balance
        user
      });
    }, /Insufficient funds/);

    const afterAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get('acc_sarah_checking');
    assert.equal(afterAccount.balance, initialBalance);

    const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
    assert.equal(txCount.count, 0);
  });
});
