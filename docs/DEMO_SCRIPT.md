# AgentShield customer support demo (3–4 minutes)

## Setup

Run `npm run seed`, then `npm start`, and open `http://localhost:3001`. Use the top bar's demo identity switcher. All records and refunds are local sandbox data; no Gnani key or payment integration is required.

## 0:00–0:30 — The guardrail

**Say:** “A support assistant can misunderstand a complaint or promise a refund too quickly. AgentShield checks identity, order facts, and policy before any sensitive operation. The assistant can recommend, but it cannot authorize a refund by itself.”

Show the Support agent page and identify the persistent conversation, verified order records, and security decision/audit history.

## 0:30–1:05 — Verified order lookup

Send: `Where is order ord_sarah_101?`

**Expected:** The assistant returns the database's delivery and payment statuses for Sarah's own order and records a support conversation/audit event.

**Say:** “The delivery answer comes from the backend order record. A customer supplied order ID is checked against the current identity before details are shown.”

## 1:05–1:45 — Diagnose before refund

Send: `My headphones are not connecting. I want a refund.`

**Expected:** It recognizes the verified headphones order and asks whether the issue is pairing, charging, or something else; it does not issue a refund. Mention that troubleshooting avoids unsafe steps and a hazard such as a swollen battery opens an urgent ticket.

Then send: `The camera kit I ordered is defective. I want to return order ord_sarah_104.`

**Expected:** It verifies the seeded paid/delivered $800 camera order, records a defect, checks the 30-day policy and $500 human approval threshold, then creates a pending review request. The order's refunded amount remains unchanged.

## 1:45–2:25 — Human review

Switch the top bar identity to **Security Admin**. In **Human refund review**, inspect the pending amount and choose **Approve sandbox refund** (or reject to demonstrate the no-execution path).

**Expected:** Approval is rechecked through the policy gateway and executes once against the simulated SQLite ledger. Rejection records no refund. Open Audit history to show the decision and reviewer event.

**Say:** “The review is a real persisted state transition in this demo, but it updates only sandbox records. No real payment is issued.”

## 2:25–3:10 — Policy and privacy

Switch back to Sarah. Ask `Refund order ord_sarah_102 for a defective desk.`

**Expected:** The older order is outside the configured return window; it is not auto-refunded and the response points to warranty or human review. Ask `Where is order ord_michael_201?`

**Expected:** The app refuses to disclose another customer's order. Optionally show `My device battery is swollen and heating up.` for immediate safe-use guidance and urgent ticket creation.

## 3:10–3:30 — Wrap

**Say:** “AgentShield verifies ownership and trusted order facts, applies deterministic policy, pauses sensitive actions for a reviewer, and records decisions. This version is a deterministic local demo; production use needs real authentication, commerce integrations, and company-approved return and warranty policy.”

## Presenter notes

- Demo identities are selected locally and are not authentication.
- `ISSUE_REFUND` policy values are seeded examples and can be changed in Policies/database configuration.
- The conversation engine is deterministic; it does not need a live Gnani API key.
- All refunds are simulated SQLite ledger updates. Do not describe them as real payment refunds.
