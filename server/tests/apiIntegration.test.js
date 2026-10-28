/**
 * AgentShield Express HTTP API Integration Tests
 *
 * These tests validate HTTP-level routing, middleware, request parsing, and response
 * shaping by using proper Node.js IncomingMessage/ServerResponse objects injected
 * directly into the Express app — no TCP port binding required.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Duplex } = require('node:stream');
const { createApp } = require('../src/app');
const { seedDatabase } = require('../src/db/seed');
const { getDb } = require('../src/db/connection');

// ---------------------------------------------------------------------------
// In-process HTTP helper: drives Express without TCP socket binding
// ---------------------------------------------------------------------------

function makeRequest(app, { method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';

    // Minimal duplex socket that Express/Node internals require
    const socket = new Duplex();
    socket.destroy = () => {};
    socket.remoteAddress = '127.0.0.1';

    // Proper Node.js IncomingMessage
    const req = new http.IncomingMessage(socket);
    req.method = method.toUpperCase();
    req.url = path;
    req.headers = {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(bodyStr)),
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

    // Proper Node.js ServerResponse — collects chunks without writing to socket
    const chunks = [];
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    res.write = function (chunk, encoding) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
      return true;
    };
    res.end = function (chunk, encoding) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding || 'utf8'));
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      resolve({ status: this.statusCode, body: parsed });
    };

    // Hand off to Express
    app(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: res.statusCode, body: null });
    });

    // Stream body data into the IncomingMessage
    if (bodyStr) req.push(bodyStr);
    req.push(null); // signal EOF
  });
}

// ---------------------------------------------------------------------------
// Standard headers for the primary demo user (usr_sarah_01)
// ---------------------------------------------------------------------------

const SARAH_HEADERS = {
  'X-User-Id': 'usr_sarah_01',
  'X-Tenant-Id': 'tenant_retail',
  'X-User-Role': 'customer',
  'X-Agent-Id': 'voice-assistant-agent'
};

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

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
    const res = await makeRequest(app, { method: 'GET', path: '/api/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'HEALTHY');
    assert.equal(res.body.service, 'AgentShield Security Platform');
  });

  it('POST /api/gateway/process processes natural language balance inquiry (ALLOW)', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      path: '/api/gateway/process',
      headers: SARAH_HEADERS,
      body: { text: 'Check my checking balance' }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.decision, 'ALLOW');
    assert.equal(res.body.executionResult.balance, 12450.00);
  });

  it('POST /api/gateway/process returns VERIFY for transfer over $1,000 threshold', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      path: '/api/gateway/process',
      headers: SARAH_HEADERS,
      body: { text: 'Transfer $1,500 to recp_landlord_prop' }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.decision, 'VERIFY');
    assert.equal(res.body.requiresApproval, true);
    assert.ok(res.body.challenge?.challengeId, 'Expected challengeId to be present');
  });

  it('POST /api/gateway/verify completes step-up verification and executes transfer', async () => {
    // Step 1: Request transfer → receive VERIFY challenge
    const processRes = await makeRequest(app, {
      method: 'POST',
      path: '/api/gateway/process',
      headers: SARAH_HEADERS,
      body: { text: 'Transfer $1,500 to recp_landlord_prop' }
    });

    assert.equal(processRes.status, 200);
    assert.equal(processRes.body.decision, 'VERIFY');

    const { challengeId, code } = processRes.body.challenge;

    // Step 2: Submit correct OTP with exact same parameters
    const verifyRes = await makeRequest(app, {
      method: 'POST',
      path: '/api/gateway/verify',
      headers: SARAH_HEADERS,
      body: {
        challengeId,
        code,
        actionType: 'TRANSFER_FUNDS',
        payload: {
          fromAccountId: 'acc_sarah_checking',
          toRecipientId: 'recp_landlord_prop',
          amount: 1500.00,
          memo: 'Payment via AgentShield: Transfer $1,500 to recp_landlord_prop'
        }
      }
    });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(verifyRes.body.decision, 'ALLOW');
    assert.equal(verifyRes.body.executionResult.transaction.status, 'COMPLETED');
    assert.equal(verifyRes.body.executionResult.transaction.remainingBalance, 10950.00);
  });

  it('GET /api/audit/verify-chain confirms cryptographic integrity', async () => {
    const res = await makeRequest(app, { method: 'GET', path: '/api/audit/verify-chain' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.report.isChainValid, true);
  });

  it('GET /api/provider/usage returns credit telemetry and budget guard status', async () => {
    const res = await makeRequest(app, { method: 'GET', path: '/api/provider/usage' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.summary.budgetLimit, 5000);
    assert.equal(res.body.summary.budgetReserve, 1000);
    assert.equal(res.body.summary.usableBudget, 4000);
  });

  it('POST /api/scenarios/run-all executes all 8 scenarios and reports all passed', async () => {
    const res = await makeRequest(app, {
      method: 'POST',
      path: '/api/scenarios/run-all',
      headers: SARAH_HEADERS
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.allPassed, true);
    assert.equal(res.body.total, 8);
    assert.equal(res.body.passedCount, 8);
    assert.equal(res.body.failedCount, 0);
  });
});
