# Devpost submission kit

Copy each section into the matching field on the Devpost "Enter a Submission" form.

---

## Project name
**Arko Pay-on-Proof**

## Elevator pitch (one line)
Drop in a statement of work. AI agents split it into milestones, PayPal holds the money, and it's released only when the work is proven.

## About the project (text description)

### Inspiration
Every freelance deal starts with a standoff. The freelancer fears doing the work and never getting paid. The client fears paying upfront for work that never arrives. Escrow exists only inside big marketplaces, at a high fee and with slow human reviewers. Most freelance work is agreed directly, over email or chat, with no protection at all.

### What it does
Arko is an **AI escrow agent built on PayPal**:

1. **Upload any SOW or work order** (PDF, Word, scanned image, email or text). The **Contract Agent** (Claude) reads it, follows its payment schedule (for example 30/40/30) and proposes **milestones**, each with deliverables, due dates and an objective **definition of done**.
2. **Both parties approve the split.** The AI's proposal is v1. Either side can edit amounts, dates, deliverables or payment terms, and each save creates a new version that the other party must re-approve. A **Plan Reviewer** agent flags criteria that can't be tested and totals that don't add up.
3. **PayPal holds the money.** Each milestone is funded with a PayPal **Orders v2 AUTHORIZE** order. The money is reserved on the client's PayPal account, not taken.
4. **Proof, then AI verification.** The freelancer uploads proof. The **Verifier Agent** (Claude reading images and documents) scores every definition-of-done item with evidence.
5. **A human approves every money movement.** Agents and chat can only *propose*. An approval card shows policy checks, and only the right party (the client, for releases) can approve. PayPal then **captures** the payment and issues a **receipt invoice**.
6. **Disputes get settled fairly.** The **Mediator Agent** reads both statements and the evidence and proposes a split. Once both sides accept, PayPal **partially captures** the freelancer's share and returns the rest automatically.
7. **Schedule changes:** extension requests need the other party's approval, are capped by the agreed terms, and trigger a PayPal **hold renewal** (reauthorize) when needed.
8. **Orchestration graph:** every deal appears as a live, Step Functions–style state machine (parallel approvals, a map over milestones, a decision step, and human wait steps), with the running path highlighted.

### How we built it
- **PayPal:** Orders v2 (AUTHORIZE, authorize), Payments v2 (capture, partial capture with `final_capture`, void, reauthorize, refund), Invoicing v2 (receipt and record payment), Payouts. All of it goes through our own **PayPal MCP server**, and the app talks to it as an MCP client. The same tools work in Claude Desktop, with destructive and read-only annotations.
- **AI:** Claude (`claude-opus-5-5`) through the Anthropic TypeScript SDK. Structured outputs for the Contract, Plan Reviewer, Verifier and Mediator agents, and a streaming tool-use chat agent ("Arko") that can check PayPal live and propose actions.
- **Architecture:**
  - TypeScript monorepo; the API follows clean architecture (domain state machine and policies, application use cases, ports and adapters, composition root).
  - Typed PayPal client with OAuth caching, retries and idempotency keys.
  - Per-party HMAC-signed invite keys, optimistic concurrency on plan versions, rate limits, security headers and an audit trail.
  - React 19, Tailwind, React Flow (orchestration graph) and AG Grid (escrow ledger).
  - 22 automated tests.

### Challenges
Turning "trust" into code: modelling escrow as PayPal authorizations (hold, then full or partial capture or void) and making sure an AI can **never** move money on its own.

### What's next
PayPal Commerce Platform onboarding so each freelancer is paid directly, automatic release after the review window, webhooks, and SSO accounts.

## Built with
`paypal-rest-api` `paypal-orders-v2` `paypal-payments` `paypal-invoicing` `paypal-payouts` `claude` `anthropic` `model-context-protocol` `typescript` `node.js` `express` `react` `vite` `tailwindcss` `react-flow` `ag-grid` `sqlite` `zod` `vitest` `render`

## Try it out
- GitHub: `<repo URL>`
- Setup: README → "Run it locally (about 5 minutes)"

---

## 3-minute demo video script

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Landing page | "Freelancers fear not getting paid. Clients fear paying for bad work. Arko puts PayPal and AI agents in the middle." |
| 0:15–0:40 | Drag in `sample-sow.md` → AI pipeline → Plan & terms | "I drop in a statement of work. The Contract Agent reads it and splits it into three milestones following the SOW's 30/40/30 schedule, each with deliverables and a definition of done." |
| 0:40–1:00 | Run AI plan review → edit a date → Save v2 → accept as client, switch role → accept as freelancer | "Both sides review the AI's split. Every edit is a new version, and money can only be held once both approve the same version." |
| 1:00–1:25 | Hold with PayPal → sandbox popup → approve → "Held by PayPal" | "The client funds milestone 1. PayPal authorizes the payment, so the money is held, not taken." |
| 1:25–1:55 | As freelancer, upload a logo image → Verify with AI → verdict card | "The freelancer uploads proof. The Verifier Agent checks it against each item in the definition of done." |
| 1:55–2:20 | As client: Release → approval card with policy checks → Approve & pay → Paid + receipt | "Release needs a human. Policy checks pass, the client approves, and PayPal captures the payment and issues a receipt invoice." |
| 2:20–2:45 | Workflow tab → state machine graph, click a node | "Every deal is a live state machine: parallel approvals, a branch per milestone, verification, and a decision between release and mediation." |
| 2:45–3:00 | Ask Arko chat "What's held in escrow?" | "Arko checks PayPal live through our MCP server, but it never moves money on its own. Arko: get paid on proof." |

Tips: record at 1280×720 or higher, without background music (copyrighted music isn't allowed), upload to YouTube as **Public** (or Unlisted only if the rules allow it; the rules say *publicly visible*), and keep it under 3:00.
