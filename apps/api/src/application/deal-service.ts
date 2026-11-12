import {
  PaymentTerms,
  splitAmount,
  type ActionKind,
  type CreateDealRequest,
  type Deal,
  type ExtensionRequest,
  type ExtensionRequestBody,
  type SourceDocument,
  type UpdatePlanRequest,
  type Milestone,
  type Party,
  type PendingAction,
  type Proof,
  type SubmitProofRequest,
} from "@arko/shared";
import { AppError, forbidden, invalidState, notFound } from "../domain/errors.ts";
import { addDays, emptyMilestone, milestoneHealth, revisePlan, today, validateExtension } from "../domain/plan.ts";
import { deriveDealStatus, isHeld, transition } from "../domain/milestone.ts";
import { allPassed, evaluatePolicies, requiredApprover } from "../domain/policies.ts";
import { newId } from "./ids.ts";
import type {
  ActionRepository,
  AuditLog,
  ContractAgent,
  DealRepository,
  MediatorAgent,
  PaymentsGateway,
  PlanReviewAgent,
  SourceMaterial,
  ProofStore,
  VerifierAgent,
} from "./ports.ts";

export interface DealServiceDeps {
  deals: DealRepository;
  actions: ActionRepository;
  audit: AuditLog;
  proofs: ProofStore;
  payments: () => PaymentsGateway;
  contract: () => ContractAgent;
  verifier: () => VerifierAgent;
  mediator: () => MediatorAgent;
  planReviewer: () => PlanReviewAgent;
  readDocument: (doc: SourceDocument) => Promise<SourceMaterial>;
  publicUrl: string;
  maxActionAmount: number;
}

/**
 * Application service for the escrow lifecycle. Each public method is one use case:
 * it loads the aggregate, applies domain rules, calls ports (PayPal over MCP, Claude
 * agents) and persists the result with an audit entry.
 */
export class DealService {
  constructor(private readonly d: DealServiceDeps) {}

  /* ───────── Queries ───────── */

  list(): Deal[] {
    return this.d.deals.list();
  }

  get(dealId: string): Deal {
    const deal = this.d.deals.get(dealId);
    if (!deal) throw notFound("Deal", dealId);
    return deal;
  }

  /* ───────── 1. Agreement → milestones (Contract Agent) ───────── */

  /** Statement of work (any format) or pasted agreement → AI-proposed milestone plan v1. */
  async createDeal(req: CreateDealRequest): Promise<Deal> {
    const source: SourceMaterial = req.document
      ? await this.d.readDocument(req.document)
      : { kind: "text", name: "Pasted agreement", text: req.text ?? "" };
    const draft = await this.d.contract().draft(source, {
      clientName: req.clientName,
      freelancerName: req.freelancerName,
      currency: req.currency,
    });
    const now = new Date();
    const nowIso = now.toISOString();
    const dealId = newId("deal");
    const ids = draft.milestones.map(() => newId("ms"));
    const deal: Deal = {
      id: dealId,
      title: draft.title,
      summary: draft.summary,
      clientName: req.clientName || draft.clientName,
      freelancerName: req.freelancerName || draft.freelancerName,
      freelancerEmail: req.freelancerEmail ?? "",
      currency: req.currency ?? draft.currency,
      sourceText: source.kind === "text" ? source.text : draft.sourceExcerpt,
      sourceDocument: req.document ? { name: req.document.name, mimeType: req.document.mimeType } : null,
      status: "proposed",
      version: 1,
      acceptedBy: [],
      terms: PaymentTerms.parse(draft.terms),
      revisions: [
        { version: 1, editedBy: "contract-agent", changes: [`AI split ${source.kind === "text" && !req.document ? "the agreement" : `"${source.name}"`} into ${draft.milestones.length} milestones`], createdAt: nowIso },
      ],
      planReview: null,
      createdAt: nowIso,
      milestones: draft.milestones.map((m, i) => {
        const due = m.dueInDays ? addDays(nowIso, m.dueInDays) : null;
        return {
          ...emptyMilestone(dealId, ids[i]!, nowIso),
          position: i + 1,
          title: m.title,
          description: m.description,
          amount: m.amount,
          criteria: m.criteria,
          deliverables: m.deliverables.map((d) => ({ id: newId("dlv"), name: d.name, format: d.format, notes: "" })),
          dueDate: due,
          originalDueDate: due,
          dependsOn: m.dependsOnPrevious && i > 0 ? ids[i - 1]! : null,
        };
      }),
    };
    this.d.deals.save(deal);
    this.log(deal.id, "contract-agent", "deal.drafted", `Drafted ${deal.milestones.length} milestones from the agreement`, {
      milestones: deal.milestones.map((m) => ({ title: m.title, amount: m.amount })),
    });
    return deal;
  }

  /** Accept a specific plan version. Accepting a stale version is rejected, so nobody signs terms they didn't see. */
  acceptTerms(dealId: string, party: Party, version: number): Deal {
    const deal = this.get(dealId);
    if (deal.status !== "proposed") return deal;
    if (version !== deal.version) {
      throw new AppError("VERSION_CONFLICT", `The plan is now at v${deal.version}. Review the latest changes before accepting.`, 409, { currentVersion: deal.version });
    }
    if (!deal.acceptedBy.includes(party)) deal.acceptedBy.push(party);
    deal.status = deriveDealStatus(deal);
    this.d.deals.save(deal);
    this.log(deal.id, party, "plan.accepted", `${cap(party)} accepted plan v${deal.version}`);
    if (deal.status === "active") this.log(deal.id, "arko", "deal.activated", `Both parties agreed plan v${deal.version} — milestones can now be funded`);
    return deal;
  }

  /* ───────── Negotiation: edit the plan (versioned) ───────── */

  updatePlan(dealId: string, party: Party, req: UpdatePlanRequest): Deal {
    const deal = this.get(dealId);
    const next = revisePlan(deal, req, party, newId);
    next.status = deriveDealStatus(next);
    this.d.deals.save(next);
    const rev = next.revisions[next.revisions.length - 1]!;
    this.log(deal.id, party, "plan.revised", `${cap(party)} proposed plan v${next.version}: ${rev.changes.slice(0, 3).join("; ")}${rev.changes.length > 3 ? "…" : ""}`, {
      version: next.version,
      changes: rev.changes,
    });
    return next;
  }

  /** AI review of the plan: testable definition of done, realistic dates, amounts, missing terms. */
  async reviewPlan(dealId: string): Promise<Deal> {
    const deal = this.get(dealId);
    const review = await this.d.planReviewer().review(deal);
    const next: Deal = { ...deal, planReview: { ...review, version: deal.version, reviewedAt: new Date().toISOString() } };
    this.d.deals.save(next);
    this.log(deal.id, "plan-reviewer", "plan.reviewed", `Plan v${deal.version} readiness ${review.readiness}/100 — ${review.issues.length} note(s)`);
    return next;
  }

  /* ───────── Schedule changes: extension requests ───────── */

  requestExtension(dealId: string, milestoneId: string, party: Party, body: ExtensionRequestBody): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    validateExtension(m, deal.terms, body.toDate);
    const ext: ExtensionRequest = {
      id: newId("ext"),
      requestedBy: party,
      fromDate: m.dueDate,
      toDate: body.toDate,
      reason: body.reason,
      status: "pending",
      decidedBy: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    this.replace(deal, { ...m, extensions: [...m.extensions, ext], updatedAt: ext.createdAt });
    this.log(deal.id, party, "extension.requested", `${cap(party)} asked to move "${m.title}" from ${m.dueDate ?? "no date"} to ${body.toDate}`, { reason: body.reason });
    return deal;
  }

  decideExtension(dealId: string, milestoneId: string, extensionId: string, party: Party, approve: boolean, note?: string): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    const ext = m.extensions.find((e) => e.id === extensionId);
    if (!ext) throw notFound("Extension request", extensionId);
    if (ext.status !== "pending") throw invalidState(`This request is already ${ext.status}`);
    if (ext.requestedBy === party) throw forbidden("The other party must decide on an extension request");

    const decided: ExtensionRequest = { ...ext, status: approve ? "approved" : "rejected", decidedBy: party, decisionNote: note ?? null, decidedAt: new Date().toISOString() };
    const next = {
      ...m,
      extensions: m.extensions.map((e) => (e.id === ext.id ? decided : e)),
      dueDate: approve ? ext.toDate : m.dueDate,
      originalDueDate: m.originalDueDate ?? m.dueDate,
      updatedAt: decided.decidedAt!,
    };
    this.replace(deal, next);
    this.log(deal.id, party, approve ? "extension.approved" : "extension.rejected", `${cap(party)} ${approve ? "approved" : "declined"} the new date ${ext.toDate} for "${m.title}"`);
    if (approve && milestoneHealth(next, deal.terms).holdNeedsRenewal) {
      this.log(deal.id, "arko", "hold.renewal_needed", `The PayPal hold for "${m.title}" expires before the new due date — the client should renew it`);
    }
    return deal;
  }

  /** Renew (reauthorize) a PayPal hold, e.g. after an extension pushed the deadline past its expiry. */
  async renewHold(dealId: string, milestoneId: string): Promise<Deal> {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (!isHeld(m.status) || !m.paypal.authorizationId) throw invalidState("There is no active hold to renew");
    const auth = await this.d.payments().reauthorize({
      authorizationId: m.paypal.authorizationId,
      amount: m.amount,
      currency: deal.currency,
      requestId: `reauth-${m.id}-${today()}`,
    });
    const now = new Date().toISOString();
    this.replace(deal, {
      ...m,
      paypal: { ...m.paypal, authorizationId: auth.authorizationId, authorizedAt: now, holdExpiresAt: (auth.expirationTime ?? addDays(now, 29)).slice(0, 10) },
      updatedAt: now,
    });
    this.log(deal.id, "paypal", "hold.renewed", `Hold for "${m.title}" renewed — new authorization ${auth.authorizationId}`);
    return deal;
  }

  /* ───────── 2. Fund → PayPal hold (Orders v2, intent AUTHORIZE) ───────── */

  async fund(dealId: string, milestoneId: string): Promise<{ deal: Deal; approveUrl: string }> {
    const deal = this.get(dealId);
    if (deal.status === "proposed") throw invalidState("Both parties must accept the plan before any money is held");
    const m = this.milestone(deal, milestoneId);

    // Re-use an open order if the payer closed the PayPal window and tries again.
    if (m.status === "funding_pending" && m.paypal.approveUrl) return { deal, approveUrl: m.paypal.approveUrl };

    const query = `deal=${deal.id}&milestone=${m.id}`;
    const hold = await this.d.payments().createHold({
      amount: m.amount,
      currency: deal.currency,
      description: `${deal.title} — ${m.title}`,
      referenceId: m.id,
      returnUrl: `${this.d.publicUrl}/paypal/return?${query}`,
      cancelUrl: `${this.d.publicUrl}/paypal/cancel?${query}`,
      requestId: `hold-${m.id}-${Date.now()}`,
    });
    if (!hold.approveUrl) throw invalidState("PayPal did not return an approval link");

    this.replace(deal, transition(m, "funding_pending", { paypal: { ...m.paypal, orderId: hold.orderId, approveUrl: hold.approveUrl } }));
    this.log(deal.id, "client", "milestone.funding", `PayPal order ${hold.orderId} created for "${m.title}"`, { orderId: hold.orderId });
    return { deal, approveUrl: hold.approveUrl };
  }

  /** Called when the payer returns from PayPal: turn the approved order into an authorization. */
  async confirmFunding(dealId: string, milestoneId: string): Promise<Deal> {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (isHeld(m.status)) return deal; // already confirmed (idempotent)
    if (m.status !== "funding_pending" || !m.paypal.orderId) throw invalidState("This milestone has no PayPal order waiting for approval");

    const payments = this.d.payments();
    const order = await payments.getOrder(m.paypal.orderId);
    let authorizationId = order.authorizationId;
    let payerEmail = order.payerEmail;
    let expiry: string | undefined;
    if (!authorizationId) {
      if (order.status !== "APPROVED") throw invalidState(`The payer has not approved the PayPal order yet (status ${order.status})`);
      const auth = await payments.authorizeOrder(m.paypal.orderId, `authorize-${m.id}`);
      authorizationId = auth.authorizationId;
      payerEmail = auth.payerEmail ?? payerEmail;
      expiry = auth.expirationTime;
    }
    const now = new Date().toISOString();
    const holdExpiresAt = (expiry ?? addDays(now, 29)).slice(0, 10); // PayPal authorizations are valid for 29 days

    this.replace(deal, transition(m, "funded", { paypal: { ...m.paypal, authorizationId, payerEmail, authorizedAt: now, holdExpiresAt } }));
    this.log(deal.id, "paypal", "milestone.funded", `${m.amount} ${deal.currency} held by PayPal for "${m.title}"`, { authorizationId });
    return deal;
  }

  cancelFunding(dealId: string, milestoneId: string): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (m.status !== "funding_pending") return deal;
    this.replace(deal, transition(m, "awaiting_funding", { paypal: {} }));
    this.log(deal.id, "client", "milestone.funding_cancelled", `Funding for "${m.title}" was cancelled in PayPal`);
    return deal;
  }

  /* ───────── 3. Proof of work → Verifier Agent ───────── */

  submitProof(dealId: string, milestoneId: string, req: SubmitProofRequest): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (!isHeld(m.status) || m.status === "disputed" || m.status === "mediated") {
      throw invalidState("Proof can be submitted once the milestone is funded and before a dispute");
    }
    const proof: Proof = {
      id: newId("proof"),
      milestoneId: m.id,
      kind: req.kind,
      name: req.name,
      mimeType: req.mimeType,
      url: req.url,
      note: req.note,
      createdAt: new Date().toISOString(),
    };
    if (req.kind === "file" && req.dataBase64) this.d.proofs.saveFile(proof, Buffer.from(req.dataBase64, "base64"));

    this.replace(deal, transition(m, "submitted", { proofs: [...m.proofs, proof], verification: null, submittedAt: m.submittedAt ?? proof.createdAt }));
    this.log(deal.id, "freelancer", "proof.submitted", `Proof "${proof.name}" submitted for "${m.title}"`);
    return deal;
  }

  async verify(dealId: string, milestoneId: string): Promise<Deal> {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (m.proofs.length === 0) throw invalidState("Nothing to verify yet — the freelancer has not submitted proof");
    if (!["submitted", "verified"].includes(m.status)) throw invalidState(`Cannot verify a milestone that is ${m.status}`);

    const verification = await this.d.verifier().verify({ deal, milestone: m, proofs: m.proofs.map((p) => this.d.proofs.read(p)) });
    this.replace(deal, transition(m, "verified", { verification }));
    this.log(deal.id, "verifier-agent", "milestone.verified", `Verifier: ${verification.verdict} (${verification.score}/100) — recommends ${verification.recommendation}`, {
      score: verification.score,
    });
    return deal;
  }

  /* ───────── 4. Disputes → Mediator Agent ───────── */

  dispute(dealId: string, milestoneId: string, party: Party, statement: string): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    const statements = { ...m.disputeStatements, [party]: statement };
    const next = m.status === "disputed" ? { ...m, disputeStatements: statements } : transition(m, "disputed", { disputeStatements: statements, mediation: null });
    this.replace(deal, next);
    this.log(deal.id, party, "milestone.disputed", `${cap(party)} gave their side for "${m.title}"`);
    return deal;
  }

  async mediate(dealId: string, milestoneId: string): Promise<Deal> {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (!["disputed", "mediated"].includes(m.status)) throw invalidState("Mediation starts after a dispute is raised");

    const proposal = await this.d.mediator().mediate({ deal, milestone: m, proofs: m.proofs.map((p) => this.d.proofs.read(p)) });
    this.replace(deal, transition(m, "mediated", { mediation: { ...proposal, acceptedBy: [] } }));
    this.log(deal.id, "mediator-agent", "milestone.mediated", `Mediator proposes ${proposal.freelancerPercent}% to the freelancer`, {
      freelancerPercent: proposal.freelancerPercent,
    });
    return deal;
  }

  acceptMediation(dealId: string, milestoneId: string, party: Party): Deal {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (m.status !== "mediated" || !m.mediation) throw invalidState("There is no mediation proposal to accept");
    const acceptedBy = m.mediation.acceptedBy.includes(party) ? m.mediation.acceptedBy : [...m.mediation.acceptedBy, party];
    this.replace(deal, { ...m, mediation: { ...m.mediation, acceptedBy } });
    this.log(deal.id, party, "mediation.accepted", `${cap(party)} accepted the proposed split`);
    return deal;
  }

  /* ───────── 5. Money moves → approval gate ───────── */

  /** Propose a money movement. It is evaluated against policies and waits for a human approval. */
  proposeAction(input: {
    dealId: string;
    milestoneId: string;
    kind: ActionKind;
    requestedBy: "agent" | "user";
    amount?: string;
    reason?: string;
  }): PendingAction {
    const deal = this.get(input.dealId);
    const m = this.milestone(deal, input.milestoneId);

    const existing = this.d.actions.list({ dealId: deal.id, status: "pending" }).find((a) => a.milestoneId === m.id && a.kind === input.kind);
    if (existing) return existing;

    const amount = this.amountFor(input.kind, m, input.amount);
    const checks = evaluatePolicies({ kind: input.kind, milestone: m, amount, requestedBy: input.requestedBy, maxActionAmount: this.d.maxActionAmount });
    const action: PendingAction = {
      id: newId("act"),
      dealId: deal.id,
      milestoneId: m.id,
      kind: input.kind,
      summary: this.describe(input.kind, m, deal, amount, input.reason),
      amount,
      currency: deal.currency,
      params: { reason: input.reason ?? null, approver: requiredApprover(input.kind, m) },
      checks,
      status: "pending",
      requestedBy: input.requestedBy,
      error: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    this.d.actions.save(action);
    this.log(deal.id, input.requestedBy === "agent" ? "arko" : "user", "action.proposed", action.summary, { actionId: action.id, checks });
    return action;
  }

  listActions(filter?: { dealId?: string; status?: PendingAction["status"] }): PendingAction[] {
    return this.d.actions.list(filter);
  }

  rejectAction(actionId: string, party: Party): PendingAction {
    const action = this.action(actionId);
    if (action.status !== "pending") throw invalidState(`Action is already ${action.status}`);
    const decided: PendingAction = { ...action, status: "rejected", decidedAt: new Date().toISOString() };
    this.d.actions.save(decided);
    this.log(action.dealId, party, "action.rejected", `${cap(party)} rejected: ${action.summary}`);
    return decided;
  }

  /** The only path that moves money: a human approves, policies are re-checked, then PayPal executes. */
  async approveAction(actionId: string, party: Party): Promise<{ action: PendingAction; deal: Deal }> {
    const action = this.action(actionId);
    if (action.status !== "pending") throw invalidState(`Action is already ${action.status}`);
    const deal = this.get(action.dealId);
    const m = this.milestone(deal, action.milestoneId);

    const approver = requiredApprover(action.kind, m);
    if (party !== approver) throw forbidden(`Only the ${approver} can approve this ${action.kind}`);

    // Re-evaluate against the current state — things may have changed since it was proposed.
    const checks = evaluatePolicies({ kind: action.kind, milestone: m, amount: action.amount, requestedBy: action.requestedBy, maxActionAmount: this.d.maxActionAmount });
    if (!allPassed(checks)) {
      const failed = { ...action, checks, status: "failed" as const, error: "A safety check failed", decidedAt: new Date().toISOString() };
      this.d.actions.save(failed);
      throw invalidState("Safety checks failed — nothing was moved", { checks });
    }

    try {
      await this.execute(action, deal, m);
    } catch (err) {
      this.d.actions.save({ ...action, checks, status: "failed", error: err instanceof Error ? err.message : String(err), decidedAt: new Date().toISOString() });
      throw err;
    }
    const done: PendingAction = { ...action, checks, status: "executed", decidedAt: new Date().toISOString() };
    this.d.actions.save(done);
    return { action: done, deal: this.get(deal.id) };
  }

  private async execute(action: PendingAction, deal: Deal, m: Milestone): Promise<void> {
    const payments = this.d.payments();
    const authorizationId = m.paypal.authorizationId ?? "";

    switch (action.kind) {
      case "release": {
        const cap = await payments.capture({
          authorizationId,
          currency: deal.currency,
          finalCapture: true,
          noteToPayer: `Released: ${m.title}`,
          invoiceId: `${m.id}-release`,
          requestId: `release-${m.id}`,
        });
        const receipt = await this.receipt(deal, m, action.amount);
        this.replace(deal, transition(m, "released", { capturedAmount: action.amount, paypal: { ...m.paypal, captureId: cap.captureId, invoiceId: receipt } }));
        this.log(deal.id, "paypal", "milestone.released", `${action.amount} ${deal.currency} released to ${deal.freelancerName}`, { captureId: cap.captureId });
        return;
      }
      case "split": {
        const [payee] = splitAmount(m.amount, m.mediation?.freelancerPercent ?? 0);
        if (Number(payee) === 0) {
          await payments.void(authorizationId, `split-void-${m.id}`);
        } else {
          const cap = await payments.capture({
            authorizationId,
            amount: payee,
            currency: deal.currency,
            finalCapture: true, // the remainder of the hold goes back to the client
            noteToPayer: `Settled by agreed split: ${m.title}`,
            invoiceId: `${m.id}-split`,
            requestId: `split-${m.id}`,
          });
          m = { ...m, paypal: { ...m.paypal, captureId: cap.captureId } };
        }
        const receipt = Number(payee) > 0 ? await this.receipt(deal, m, payee) : undefined;
        this.replace(deal, transition(m, "settled", { capturedAmount: payee, paypal: { ...m.paypal, invoiceId: receipt } }));
        this.log(deal.id, "paypal", "milestone.settled", `Split executed: ${payee} to ${deal.freelancerName}, rest returned to ${deal.clientName}`);
        return;
      }
      case "cancel": {
        await payments.void(authorizationId, `void-${m.id}`);
        this.replace(deal, transition(m, "cancelled"));
        this.log(deal.id, "paypal", "milestone.cancelled", `Hold voided — ${m.amount} ${deal.currency} returned to ${deal.clientName}`);
        return;
      }
      case "refund": {
        const refund = await payments.refund({
          captureId: m.paypal.captureId ?? "",
          amount: action.amount,
          currency: deal.currency,
          noteToPayer: `Refund: ${m.title}`,
          requestId: `refund-${m.id}-${action.id}`,
        });
        this.replace(deal, { ...m, paypal: { ...m.paypal, refundId: refund.refundId } });
        this.log(deal.id, "paypal", "milestone.refunded", `${action.amount} ${deal.currency} refunded to ${deal.clientName}`, { refundId: refund.refundId });
        return;
      }
    }
  }

  /** Best-effort PayPal invoice marked paid, so both sides have a receipt. */
  private async receipt(deal: Deal, m: Milestone, amount: string): Promise<string | undefined> {
    try {
      const inv = await this.d.payments().receipt({
        invoicerName: deal.freelancerName,
        recipientName: deal.clientName,
        itemName: m.title,
        itemDescription: m.description,
        amount,
        currency: deal.currency,
        reference: `${deal.title} / ${m.id}`,
        requestId: `receipt-${m.id}`,
      });
      return inv.invoiceId;
    } catch (err) {
      this.log(deal.id, "paypal", "receipt.failed", `Receipt invoice could not be created: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  }

  /* ───────── Live PayPal status (read-only, via MCP) ───────── */

  async holdStatus(dealId: string, milestoneId: string) {
    const deal = this.get(dealId);
    const m = this.milestone(deal, milestoneId);
    if (!m.paypal.authorizationId) return { milestone: m.title, status: m.status, hold: null };
    const hold = await this.d.payments().getAuthorization(m.paypal.authorizationId);
    return { milestone: m.title, status: m.status, hold };
  }

  /* ───────── helpers ───────── */

  private amountFor(kind: ActionKind, m: Milestone, requested?: string): string {
    switch (kind) {
      case "release":
      case "cancel":
        return m.amount;
      case "split":
        if (!m.mediation) throw invalidState("A split needs a mediation proposal first");
        return splitAmount(m.amount, m.mediation.freelancerPercent)[0];
      case "refund":
        return requested ?? m.capturedAmount ?? "0.00";
    }
  }

  private describe(kind: ActionKind, m: Milestone, deal: Deal, amount: string, reason?: string): string {
    const money = `${amount} ${deal.currency}`;
    const base = {
      release: `Release ${money} to ${deal.freelancerName} for "${m.title}"`,
      split: `Settle "${m.title}": ${money} to ${deal.freelancerName} (${m.mediation?.freelancerPercent ?? 0}%), rest back to ${deal.clientName}`,
      cancel: `Cancel "${m.title}" and return ${money} to ${deal.clientName}`,
      refund: `Refund ${money} to ${deal.clientName} for "${m.title}"`,
    }[kind];
    return reason ? `${base} — ${reason}` : base;
  }

  private milestone(deal: Deal, id: string): Milestone {
    const m = deal.milestones.find((x) => x.id === id);
    if (!m) throw notFound("Milestone", id);
    return m;
  }

  private action(id: string): PendingAction {
    const a = this.d.actions.get(id);
    if (!a) throw notFound("Action", id);
    return a;
  }

  private replace(deal: Deal, m: Milestone): void {
    deal.milestones = deal.milestones.map((x) => (x.id === m.id ? m : x));
    deal.status = deriveDealStatus(deal);
    this.d.deals.save(deal);
  }

  private log(dealId: string, actor: string, type: string, message: string, data: Record<string, unknown> = {}) {
    this.d.audit.record({ dealId, actor, type, message, data });
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
