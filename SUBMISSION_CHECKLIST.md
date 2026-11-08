# Submission checklist

## Repository and configuration

- [ ] Install with `npm install` and `npm --prefix client install`.
- [ ] Copy `.env.example` to `.env` if changing defaults. Keep `GNANI_ENABLED=false` for the offline demo and do not commit secrets.
- [ ] Run `npm run seed` to reset local sample data.
- [ ] Start with `npm start`; open `http://localhost:3001`.
- [ ] Keep the demo server local. The identity switcher is not authentication.

## Demo path

- [ ] Show verified delivery for Sarah's `ord_sarah_101`.
- [ ] Show a headphones troubleshooting conversation that does not refund immediately.
- [ ] Submit a verified defect and show the refund request remain pending.
- [ ] Use Sarah's $800 `ord_sarah_104` to show the configured high-value human review threshold.
- [ ] Switch to Security Admin and approve or reject the request; show the sandbox ledger and audit event.
- [ ] Show the expired `ord_sarah_102`, already-refunded `ord_sarah_103`, in-transit `ord_michael_201`, and cross-customer ownership block.
- [ ] Use the exact walkthrough in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `node acceptance_check.js`.
- [ ] Check `/api/health` reports the local service and mock provider mode.
- [ ] Inspect `/api/audit/verify-chain` after the walkthrough.

## Honest limitations to disclose

- Local demo identities are not real authentication; production mode fails closed.
- Order/payment/refund data is seeded SQLite simulation. No commerce, payment, or Gnani live integration is required or implied.
- The conversational support logic is deterministic and product knowledge is limited to the sample behavior in code.
- The 30-day return window and $1,000 cap are sample policy configuration, not universal or legal requirements.
- Production use requires trusted authentication, real order/payment integrations, configured company policy, operational monitoring, and security review.
