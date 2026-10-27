# AgentShield Security Controls & Threat Model

This document outlines the security controls implemented in AgentShield, their threat models, and explicit operational limitations.

---

## 1. Security Property Matrix

| Security Property | Threat Addressed | Mechanism Implemented | Status |
|:---|:---|:---|:---|
| **No Execution by Model Dictate** | Hallucinated / unauthorized tool execution | Action proposals evaluated strictly by trusted backend policy engine | **ENFORCED** |
| **Strict Schema Typing** | Malformed payloads, SQL injection, parameter injection | Zod schema validation with `.strict()` mode (forbids unexpected keys) | **ENFORCED** |
| **Tenant & Account Isolation** | Cross-tenant data exfiltration (Scenario H) | Server-side user identity & tenant boundary verification | **ENFORCED** |
| **Tiered Limit Enforcement** | Unauthorized high-value balance drainage (Scenario C) | Hard ceilings ($10,000 max single transfer) | **ENFORCED** |
| **Parameter Tampering Guard** | Post-approval modification attack (Scenario E) | SHA-256 canonical parameter hash binding; mismatch invalidates challenge | **ENFORCED** |
| **Single-Use Verification** | Challenge replay attacks (Scenario B) | Atomic state transition `PENDING` $\rightarrow$ `CONSUMED`; 3 attempt limit | **ENFORCED** |
| **Idempotency Protection** | Double-spend on network retry / replay (Scenario F) | Unique idempotency key index with atomic transaction rollback | **ENFORCED** |
| **Data Exfiltration Blocker** | Prompt injection exfiltrating customer PII (Scenario D) | Conversational agents blocked from `EXPORT_CUSTOMER_DATA` | **ENFORCED** |
| **Audit Chain Verifiability** | Cover-up of unauthorized actions via DB edits | SHA-256 hash chaining across all audit events | **ENFORCED** |
| **Credit-Budget Protection** | Uncontrolled billing loops / financial depletion | Conservative budget guard with 1,000 credit hard safety reserve | **ENFORCED** |

---

## 2. What the Cryptographic Hash Chain Detects and Does Not Detect

### What It Detects:
- **Record Modification:** If an attacker modifies any historical row (e.g., changes `DENY` to `ALLOW` or alters an amount), recalculating the SHA-256 hash immediately fails on that block.
- **Record Insertion:** If an attacker inserts an unchained row between existing blocks, the `previous_hash` link is broken.
- **Record Deletion:** If a row is deleted, the subsequent block's `previous_hash` will not match the preceding row.

### What It Cannot Prevent:
- **Catastrophic Database Deletion:** If an adversary has root OS access and executes `rm data/agentshield.sqlite`, the hash chain is deleted along with the database.
- **Hardware-Level Non-Repudiation:** In a single-node SQLite deployment, the database file is local. In enterprise multi-region production, audit records should additionally be replicated to write-once-read-many (WORM) storage (e.g., AWS S3 Object Lock or Google Cloud Storage Bucket Lock).

---

## 3. Known Limitations & Production Handoff Notes

1. **Demonstration Verification (OTP):**
   - In this local demonstration, the 6-digit challenge code is displayed in the UI modal to facilitate offline testing. In production, this code must be dispatched out-of-band via SMS, email, or a hardware authenticator (FIDO2 / WebAuthn).
2. **Deterministic Fallback vs Live LLM:**
   - The platform includes a complete deterministic rule-based extractor for 100% offline testability. When connecting external models (Gnani Evon v3.3 or OpenAI), strict Zod parsing remains mandatory.
3. **Multi-Instance Concurrency:**
   - The embedded SQLite engine uses WAL (Write-Ahead Logging) and `IMMEDIATE` transaction locking. For distributed multi-server clusters, migrating to PostgreSQL with row-level locks is recommended.
