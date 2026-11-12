import type { Deal, Milestone, MilestoneStatus } from "@arko/shared";
import { invalidState } from "./errors.ts";

/** Allowed milestone transitions — the escrow state machine. */
const TRANSITIONS: Record<MilestoneStatus, readonly MilestoneStatus[]> = {
  awaiting_funding: ["funding_pending", "cancelled"],
  funding_pending: ["funded", "awaiting_funding", "cancelled"],
  funded: ["submitted", "disputed", "released", "cancelled"],
  submitted: ["submitted", "verified", "disputed", "released", "cancelled"],
  verified: ["submitted", "verified", "disputed", "released", "cancelled"],
  disputed: ["mediated", "released", "cancelled"],
  mediated: ["mediated", "settled", "disputed", "released", "cancelled"],
  released: [],
  settled: [],
  cancelled: [],
};

/** States in which PayPal is holding the client's money. */
const HELD: readonly MilestoneStatus[] = ["funded", "submitted", "verified", "disputed", "mediated"];
const TERMINAL: readonly MilestoneStatus[] = ["released", "settled", "cancelled"];

export const isHeld = (status: MilestoneStatus) => HELD.includes(status);
export const isTerminal = (status: MilestoneStatus) => TERMINAL.includes(status);

export function canTransition(from: MilestoneStatus, to: MilestoneStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Return a copy of the milestone in its new state, or throw if the move is not allowed. */
export function transition(m: Milestone, to: MilestoneStatus, patch: Partial<Milestone> = {}): Milestone {
  if (!canTransition(m.status, to)) {
    throw invalidState(`Milestone "${m.title}" cannot move from ${m.status} to ${to}`, { from: m.status, to });
  }
  return { ...m, ...patch, status: to, updatedAt: new Date().toISOString() };
}

/** Derive the deal's overall status from acceptance and milestone states. */
export function deriveDealStatus(deal: Deal): Deal["status"] {
  if (!(deal.acceptedBy.includes("client") && deal.acceptedBy.includes("freelancer"))) return "proposed";
  return deal.milestones.every((m) => isTerminal(m.status)) ? "completed" : "active";
}
