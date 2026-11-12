import { milestoneHealth, type Deal, type Milestone, type Party, type PendingAction } from "@arko/shared";
import { formatMoney } from "./format.ts";

/** Who carries out a step — the three orchestration layers. */
export type Layer = "human" | "ai" | "paypal";
export type NodeState = "done" | "active" | "waiting" | "alert" | "skipped";

export interface FlowNode {
  key: string;
  label: string;
  layer: Layer;
  state: NodeState;
  detail: string;
}

export interface NextAction {
  who: Party | "anyone";
  text: string;
  milestoneId?: string;
  urgent?: boolean;
}

const HELD = ["funded", "submitted", "verified", "disputed", "mediated"];

/** Planning layer: draft → review → negotiate → agree → active. */
export function planningFlow(deal: Deal): FlowNode[] {
  const agreed = deal.status !== "proposed";
  const both = deal.acceptedBy.length === 2;
  const review = deal.planReview;
  return [
    { key: "draft", label: "Contract Agent", layer: "ai", state: "done", detail: `Drafted ${deal.revisions[0] ? "v1" : "plan"} from the agreement` },
    {
      key: "review",
      label: "Plan review",
      layer: "ai",
      state: review ? (review.issues.some((i) => i.severity === "blocker") && !agreed ? "alert" : "done") : agreed ? "skipped" : "waiting",
      detail: review ? `Readiness ${review.readiness}/100 · v${review.version}` : agreed ? "Not run" : "Optional AI check",
    },
    {
      key: "negotiate",
      label: "Negotiation",
      layer: "human",
      state: agreed ? "done" : "active",
      detail: `${deal.revisions.length} version${deal.revisions.length > 1 ? "s" : ""} · now v${deal.version}`,
    },
    {
      key: "client",
      label: "Client signs",
      layer: "human",
      state: deal.acceptedBy.includes("client") ? "done" : agreed ? "done" : "active",
      detail: deal.acceptedBy.includes("client") || agreed ? `Accepted v${deal.version}` : `Accept v${deal.version}`,
    },
    {
      key: "freelancer",
      label: "Freelancer signs",
      layer: "human",
      state: deal.acceptedBy.includes("freelancer") ? "done" : agreed ? "done" : "active",
      detail: deal.acceptedBy.includes("freelancer") || agreed ? `Accepted v${deal.version}` : `Accept v${deal.version}`,
    },
    { key: "active", label: "Escrow live", layer: "paypal", state: agreed || both ? "done" : "waiting", detail: agreed ? "Milestones can be funded" : "After both sign" },
  ];
}

/** Execution layer for one milestone: fund → deliver → verify → approve → settle (with dispute branch). */
export function milestoneFlow(deal: Deal, m: Milestone): FlowNode[] {
  const s = m.status;
  const h = milestoneHealth(m, deal.terms);
  const proposed = deal.status === "proposed";
  const cancelled = s === "cancelled";
  const disputed = s === "disputed" || s === "mediated" || (s === "settled" && !!m.mediation);
  const closed = s === "released" || s === "settled" || cancelled;
  const money = formatMoney(m.amount, deal.currency);

  const fund: FlowNode = {
    key: "fund",
    label: "PayPal hold",
    layer: "paypal",
    state: HELD.includes(s) || s === "released" || s === "settled" || (cancelled && m.paypal.authorizationId) ? "done" : cancelled ? "skipped" : proposed ? "waiting" : h.holdNeedsRenewal ? "alert" : "active",
    detail: m.paypal.authorizationId
      ? h.holdNeedsRenewal
        ? "Renew: hold expires before due date"
        : `${money} held${m.paypal.holdExpiresAt && !closed ? ` · until ${m.paypal.holdExpiresAt}` : ""}`
      : s === "funding_pending"
        ? "Client approving in PayPal"
        : `${money} to hold`,
  };

  const deliver: FlowNode = {
    key: "deliver",
    label: "Delivery",
    layer: "human",
    state: m.proofs.length > 0 ? "done" : cancelled ? "skipped" : h.overdue ? "alert" : s === "funded" ? "active" : "waiting",
    detail: m.proofs.length
      ? `${m.proofs.length} proof item${m.proofs.length > 1 ? "s" : ""}`
      : h.overdue
        ? `${h.daysLate} day${h.daysLate > 1 ? "s" : ""} late · due ${m.dueDate}`
        : h.pendingExtension
          ? `Extension asked → ${h.pendingExtension.toDate}`
          : m.dueDate
            ? `Due ${m.dueDate}${m.originalDueDate && m.originalDueDate !== m.dueDate ? " (extended)" : ""}`
            : "No due date",
  };

  const verify: FlowNode = disputed
    ? {
        key: "verify",
        label: "Mediator Agent",
        layer: "ai",
        state: m.mediation ? (s === "settled" ? "done" : "active") : "alert",
        detail: m.mediation ? `Proposes ${m.mediation.freelancerPercent}% to freelancer` : "Dispute raised — awaiting statements",
      }
    : {
        key: "verify",
        label: "Verifier Agent",
        layer: "ai",
        state: m.verification ? (m.verification.recommendation === "release" ? "done" : "alert") : cancelled ? "skipped" : s === "submitted" ? "active" : "waiting",
        detail: m.verification ? `${m.verification.verdict} · ${m.verification.score}/100` : "Checks proof vs definition of done",
      };

  const approve: FlowNode = {
    key: "approve",
    label: disputed ? "Both accept split" : "Client approves",
    layer: "human",
    state: closed && !cancelled ? "done" : cancelled ? "skipped" : s === "verified" || s === "mediated" ? "active" : h.reviewOverdue ? "alert" : "waiting",
    detail: disputed
      ? `Accepted: ${m.mediation?.acceptedBy.join(" & ") || "—"}`
      : h.reviewDueAt && !closed
        ? `Review by ${h.reviewDueAt}${h.reviewOverdue ? " (overdue)" : ""}`
        : "Human-in-the-loop gate",
  };

  const settle: FlowNode = {
    key: "settle",
    label: cancelled ? "Returned" : s === "settled" ? "Split paid" : "Paid out",
    layer: "paypal",
    state: closed ? "done" : "waiting",
    detail:
      s === "released"
        ? `${formatMoney(m.capturedAmount ?? m.amount, deal.currency)} captured`
        : s === "settled"
          ? `${formatMoney(m.capturedAmount ?? "0", deal.currency)} captured, rest voided`
          : cancelled
            ? "Hold voided"
            : "Capture + receipt invoice",
  };

  return [fund, deliver, verify, approve, settle];
}

/** "Who's on the hook" — the orchestrator's queue of next steps for each party. */
export function nextActions(deal: Deal, actions: PendingAction[]): NextAction[] {
  const out: NextAction[] = [];
  if (deal.status === "proposed") {
    for (const p of ["client", "freelancer"] as const) {
      if (!deal.acceptedBy.includes(p)) out.push({ who: p, text: `Review and accept plan v${deal.version}` });
    }
    return out;
  }
  for (const m of deal.milestones) {
    const h = milestoneHealth(m, deal.terms);
    const tag = `M${m.position}`;
    for (const a of actions.filter((x) => x.milestoneId === m.id && x.status === "pending")) {
      out.push({ who: a.params.approver as Party, text: `${tag}: approve "${a.kind}" of ${formatMoney(a.amount, a.currency)}`, milestoneId: m.id, urgent: true });
    }
    if (h.pendingExtension) {
      out.push({ who: h.pendingExtension.requestedBy === "client" ? "freelancer" : "client", text: `${tag}: decide extension to ${h.pendingExtension.toDate}`, milestoneId: m.id, urgent: true });
    }
    if (h.holdNeedsRenewal) out.push({ who: "client", text: `${tag}: renew the PayPal hold (expires ${m.paypal.holdExpiresAt})`, milestoneId: m.id, urgent: true });
    switch (m.status) {
      case "awaiting_funding":
        out.push({ who: "client", text: `${tag}: hold ${formatMoney(m.amount, deal.currency)} with PayPal`, milestoneId: m.id });
        break;
      case "funding_pending":
        out.push({ who: "client", text: `${tag}: finish approval in PayPal`, milestoneId: m.id });
        break;
      case "funded":
        out.push({ who: "freelancer", text: `${tag}: deliver and upload proof${m.dueDate ? ` by ${m.dueDate}` : ""}`, milestoneId: m.id, urgent: h.overdue });
        break;
      case "submitted":
        out.push({ who: "anyone", text: `${tag}: run AI verification`, milestoneId: m.id });
        break;
      case "verified":
        if (!actions.some((a) => a.milestoneId === m.id && a.status === "pending"))
          out.push({ who: "client", text: `${tag}: release payment or raise a dispute${h.reviewDueAt ? ` (review by ${h.reviewDueAt})` : ""}`, milestoneId: m.id, urgent: h.reviewOverdue });
        break;
      case "disputed":
        for (const p of ["client", "freelancer"] as const) if (!m.disputeStatements[p]) out.push({ who: p, text: `${tag}: give your side of the dispute`, milestoneId: m.id });
        out.push({ who: "anyone", text: `${tag}: ask the Mediator for a fair split`, milestoneId: m.id });
        break;
      case "mediated":
        for (const p of ["client", "freelancer"] as const) if (!m.mediation?.acceptedBy.includes(p)) out.push({ who: p, text: `${tag}: accept or contest the proposed split`, milestoneId: m.id });
        if (m.mediation?.acceptedBy.length === 2 && !actions.some((a) => a.milestoneId === m.id && a.status === "pending"))
          out.push({ who: "client", text: `${tag}: execute the agreed split`, milestoneId: m.id });
        break;
    }
  }
  return out;
}

/** Overall deal phase for the header stepper. */
export const PHASES = ["Plan", "Agree", "Fund", "Deliver", "Settle"] as const;
export function dealPhase(deal: Deal): number {
  if (deal.status === "proposed") return deal.acceptedBy.length ? 1 : 0;
  if (deal.status === "completed") return 5;
  const ss = deal.milestones.map((m) => m.status);
  if (ss.some((s) => ["submitted", "verified", "disputed", "mediated", "released", "settled"].includes(s))) return ss.some((s) => ["verified", "mediated", "released", "settled"].includes(s)) ? 4 : 3;
  if (ss.some((s) => s === "funded")) return 3;
  return 2;
}
