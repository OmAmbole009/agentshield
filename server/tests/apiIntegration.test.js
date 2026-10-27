const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { seedDatabase } = require('../src/db/seed');
const { getDb } = require('../src/db/connection');

describe('AgentShield Express HTTP API Integration Tests', () => {
  let app;
  let db;

  beforeEach(() => {
    db = getDb(':memory:');
    seedDatabase(db);
    const instance = createApp(db);
    app = instance.app;
  });

  it('GET /api/health returns 200 and healthy service metadata', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'HEALTHY');
    assert.equal(res.body.service, 'AgentShield Security Platform');
  });

  it('POST /api/gateway/process processes natural language balance inquiry (ALLOW)', async () => {
    const res = await request(app)
      .post('/api/gateway/process')
      .send({ text: 'Check my checking balance' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.decision, 'ALLOW');
    assert.equal(res.body.executionResult.balance, 12450.00);
  });

  it('POST /api/gateway/process returns VERIFY for transfer over $1,000 threshold', async () => {
    const res = await request(app)
      .post('/api/gateway/process')
      .send({ text: 'Transfer $1,500 to recp_landlord_prop' });

    assert.equal(res.status, 200);
    assert.equal(res.body.decision, 'VERIFY');
    assert.equal(res.body.requiresApproval, true);
    assert.ok(res.body.challenge?.challengeId);
  });

  it('POST /api/gateway/verify completes step-up verification and executes transfer', async () => {
    // Step 1: Request $1,500 transfer
    const processRes = await request(app)
      .post('/api/gateway/process')
      .send({ text: 'Transfer $1,500 to recp_landlord_prop' });

    const challengeId = processRes.body.challenge.challengeId;
    const code = processRes.body.challenge.code;

    // Step 2: Submit verification
    const verifyRes = await request(app)
      .post('/api/gateway/verify')
      .send({
        challengeId,
        code,
        actionType: 'TRANSFER_FUNDS',
        payload: {
          fromAccountId: 'acc_sarah_checking',
          toRecipientId: 'recp_landlord_prop',
          amount: 1500.00,
          memo: 'Payment via AgentShield: Transfer $1,500 to recp_landlord_prop'
        }
      });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(verifyRes.body.decision, 'ALLOW');
    assert.equal(verifyRes.body.executionResult.transaction.status, 'COMPLETED');
    assert.equal(verifyRes.body.executionResult.transaction.remainingBalance, 10950.00);
  });

  it('GET /api/audit/verify-chain confirms cryptographic integrity', async () => {
    const res = await request(app).get('/api/audit/verify-chain');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.report.isChainValid, true);
  });

  it('GET /api/provider/usage returns credit telemetry and budget guard status', async () => {
    const res = await request(app).get('/api/provider/usage');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.summary.budgetLimit, 5000);
    assert.equal(res.body.summary.budgetReserve, 1000);
    assert.equal(res.body.summary.usableBudget, 4000);
  });

  it('POST /api/scenarios/run-all executes all 8 scenarios and reports all passed', async () => {
    const res = await request(app).post('/api/scenarios/run-all');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.allPassed, true);
    assert.equal(res.body.total, 8);
    assert.equal(res.body.passedCount, 8);
    assert.equal(res.body.failedCount, 0);
  });
});
