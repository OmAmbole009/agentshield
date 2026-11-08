# Submission checklist

## Repository and configuration

- [x] Install with `npm install` and `npm --prefix client install`.
- [x] Copy `.env.example` to `.env` if changing defaults. Keep `GNANI_ENABLED=false` for the offline demo and do not commit secrets.
- [x] Run `npm run seed` to reset local sample data.
- [x] Start with `npm start`; open `http://localhost:3001`.
- [x] Keep the demo server local. The identity switcher is not authentication.

## Enterprise Voice & Data Security Guardrails (Gnani AI Challenge)

- [x] Voice/ASR Trust Gating: Step-up verification (`VERIFY` / `LOW_VOICE_TRUST_SCORE`) when `asrConfidence < 0.78` or `voiceBiometricScore < 0.80`.
- [x] ASR Disfluency Stripping & Spoken Number Word Normalization (`normalizeSpokenNumbers`).
- [x] Multilingual & Hinglish Prompt Injection Defense across English and transliterated Hindi jailbreaks.
- [x] Bidirectional Indian Banking PII Scrubber: 16-digit cards, CVV, Aadhaar, PAN (`[A-Z]{5}[0-9]{4}[A-Z]{1}`), OTP, phone, email masked with `PII_REDACTED` audit logging.
- [x] Stateful Multi-Turn Velocity Lockout: Rolling 15-minute sliding window triggers `SESSION_LOCKDOWN` after >3 violations.
- [x] Semantic IDOR Ownership Checking: Enforces caller ownership of target accounts and customer records.
- [x] Outbound Egress Filter: Strips system prompt leakage, stack traces, SQL schemas, and unmasked PII (`OUTPUT_EGRESS_FILTERED`).
- [x] Resilient Gnani Adapter: 5,000ms circuit breaker timeout, fallback to deterministic extraction, and credit budget reserve protection.
- [x] 12 Red-Team Scenarios (Scenarios A through L) in Security Test Lab.
- [x] UI Telemetry Badges (`PII Redacted`, `Voice Trust Score`, `Session Risk Level`, `Egress Filtered`) in Playground, Lab, Dashboard, and Audit Explorer.

## Demo path

- [x] Show verified delivery for Sarah's `ord_sarah_101`.
- [x] Show a headphones troubleshooting conversation that does not refund immediately.
- [x] Submit a verified defect and show the refund request remain pending.
- [x] Use Sarah's $800 `ord_sarah_104` to show the configured high-value human review threshold.
- [x] Switch to Security Admin and approve or reject the request; show the sandbox ledger and audit event.
- [x] Show the expired `ord_sarah_102`, already-refunded `ord_sarah_103`, in-transit `ord_michael_201`, and cross-customer ownership block.
- [x] Show Enterprise Voice & Red-Team Scenarios I, J, K, and L in Security Test Lab and Playground.
- [x] Use the exact walkthrough in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Verification

- [x] Run `npm test` (84/84 unit & integration tests passing across 8 suites).
- [x] Run `npm run build` (Vite client production build passing with 0 errors).
- [x] Run `node acceptance_check.js` (11/11 acceptance checks passing).
- [x] Check `/api/health` reports the local service and mock provider mode.
- [x] Inspect `/api/audit/verify-chain` after the walkthrough confirms cryptographic hash integrity.

## Honest limitations to disclose

- Local demo identities are not real authentication; production mode fails closed.
- Order/payment/refund data is seeded SQLite simulation. No commerce, payment, or Gnani live integration is required or implied.
- The conversational support logic is deterministic and product knowledge is limited to the sample behavior in code.
- The 30-day return window and $1,000 cap are sample policy configuration, not universal or legal requirements.
- Production use requires trusted authentication, real order/payment integrations, configured company policy, operational monitoring, and security review.
