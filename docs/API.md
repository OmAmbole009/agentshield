# AgentShield REST API Reference

Base URL: `http://localhost:3001`

All responses follow standard JSON formatting:
```json
{
  "success": true,
  "data": { ... }
}
```

---

## 1. System Health
### `GET /api/health`
Returns runtime status, database connectivity, and provider configuration.

**Response:**
```json
{
  "status": "HEALTHY",
  "service": "AgentShield Security Platform",
  "version": "1.0.0",
  "timestamp": "2026-10-27T19:52:00.000Z",
  "database": "connected (node:sqlite)",
  "gnani": {
    "enabled": false,
    "modelStt": "prisma-v2.5",
    "modelTts": "timbre-v2.5",
    "modelLlm": "evon-v3.3"
  }
}
```

---

## 2. Security Gateway
### `POST /api/gateway/process`
Main entrypoint for evaluating and authorizing text or voice instructions.

**Headers:**
- `Content-Type: application/json`
- `X-User-Id: usr_sarah_01` (optional identity simulation)
- `X-Tenant-Id: tenant_retail` (optional tenant simulation)
- `X-User-Role: customer` (or `admin`)

**Request Body:**
```json
{
  "text": "Transfer $1,200 to Northgate Property Management for rent",
  "generateAudio": true,
  "idempotencyKey": "idem_optional_uuid"
}
```

**Response (VERIFY Decision):**
```json
{
  "success": true,
  "requestId": "req_8b91a92a71bf",
  "recognizedText": "Transfer $1,200 to Northgate Property Management for rent",
  "proposal": {
    "actionType": "TRANSFER_FUNDS",
    "payload": {
      "fromAccountId": "acc_sarah_checking",
      "toRecipientId": "recp_landlord_prop",
      "amount": 1200
    },
    "isInjectionDetected": false
  },
  "decision": "VERIFY",
  "requiresApproval": true,
  "challenge": {
    "challengeId": "chg_91fba90021c1",
    "code": "489201",
    "expiresAt": "2026-10-27T19:57:00.000Z",
    "actionType": "TRANSFER_FUNDS"
  },
  "responseText": "Verification Required: Step-up verification required... Please submit your 6-digit confirmation code."
}
```

---

### `POST /api/gateway/verify`
Submits a single-use verification code to authorize and execute a pending challenge.

**Request Body:**
```json
{
  "challengeId": "chg_91fba90021c1",
  "code": "489201",
  "actionType": "TRANSFER_FUNDS",
  "payload": {
    "fromAccountId": "acc_sarah_checking",
    "toRecipientId": "recp_landlord_prop",
    "amount": 1200.00
  }
}
```

**Response (ALLOW & Execution):**
```json
{
  "success": true,
  "decision": "ALLOW",
  "executionResult": {
    "isReplay": false,
    "transaction": {
      "id": "tx_fa1029ba8810",
      "fromAccountId": "acc_sarah_checking",
      "recipientId": "recp_landlord_prop",
      "amount": 1200,
      "status": "COMPLETED",
      "remainingBalance": 11250.00
    }
  },
  "responseText": "Successfully transferred $1,200.00 to Northgate Property Management. Remaining balance: $11,250.00."
}
```

---

## 3. Cryptographic Audit Log
### `GET /api/audit`
Retrieves searchable, filterable audit records.
**Query Parameters:**
- `limit`: Integer (default 50)
- `offset`: Integer (default 0)
- `decision`: Filter by `ALLOW`, `VERIFY`, or `DENY`
- `actionType`: Filter by action type

### `GET /api/audit/verify-chain`
Walks and recalculates SHA-256 hashes across all historical audit blocks.

**Response:**
```json
{
  "success": true,
  "report": {
    "isChainValid": true,
    "totalVerified": 45,
    "latestHash": "c0e9b97b0a51...",
    "details": "All 45 audit trail blocks successfully verified against SHA-256 cryptographic chain."
  }
}
```

---

## 4. Provider & Budget Guard
### `GET /api/provider/usage`
Returns credit budget telemetry, mock vs live calls, and reserve protection status.

**Response:**
```json
{
  "success": true,
  "summary": {
    "budgetLimit": 5000,
    "budgetReserve": 1000,
    "usableBudget": 4000,
    "remainingUsable": 4000,
    "consumedCredits": 0,
    "status": "NORMAL",
    "totalCalls": 24,
    "liveCalls": 0,
    "mockCalls": 24,
    "isLiveEnabled": false
  }
}
```

---

## 5. Security Test Lab
### `POST /api/scenarios/run/:id`
Executes an individual scenario (`scenario-a` through `scenario-h`).

### `POST /api/scenarios/run-all`
Executes all 8 attack scenarios in parallel and returns pass/fail audit results.
