import {
  DAY_MS as DAY,
  dayValue as day,
  today,
  fromCents,
  toCents,
  type Deal,
  type Milestone,
  type Party,
  type PaymentTerms,
  type UpdatePlanRequest,
} from "@arko/shared";
import { AppError, invalidState } from "./errors.ts";
import { isTerminal } from "./milestone.ts";

export { addDays, today, milestoneHealth, type MilestoneHealth } from "@arko/shared";

/**
 * Apply a negotiated plan revision. Pure: returns the new deal, never mutates.
 * - optimistic concurrency on `version`
 * - preserves milestone ids so history and references stay stable
 * - every edit resets acceptance to the editor only — the other party must re-approve
 */
export function revisePlan(deal: Deal, req: UpdatePlanRequest, editor: Party, newId: (p: string) => string): Deal {
  if (deal.status !== "proposed") throw invalidState("The plan is locked once both parties have accepted it. Use extension requests for date changes.");
  if (req.expectedVersion !== deal.version) {
    throw new AppError("VERSION_CONFLICT", `The plan changed to v${deal.version} while you were editing. Reload and re-apply your edits.`, 409, {
      currentVersion: deal.version,
    });
  }

  const now = new Date().toISOString();
  const existing = new Map(deal.milestones.map((m) => [m.id, m]));
  const ids = req.milestones.map((d) => (d.id && existing.has(d.id) ? d.id : newId("ms")));

  const milestones: Milestone[] = req.milestones.map((d, i) => {
    if (d.dependsOnIndex !== null && d.dependsOnIndex >= i) {
      throw new AppError("VALIDATION_ERROR", `"${d.title}" can only depend on an earlier milestone`, 400);
    }
    const dep = d.dependsOnIndex !== null ? req.milestones[d.dependsOnIndex] : undefined;
    if (dep?.dueDate && d.dueDate && day(d.dueDate) < day(dep.dueDate)) {
      throw new AppError("VALIDATION_ERROR", `"${d.title}" is due before the milestone it depends on ("${dep.title}")`, 400);
    }
    const prev = existing.get(ids[i]!);
    return {
      ...(prev ?? emptyMilestone(deal.id, ids[i]!, now)),
      position: i + 1,
      title: d.title,
      description: d.description,
      amount: fromCents(toCents(d.amount)),
      dueDate: d.dueDate,
      originalDueDate: d.dueDate,
      criteria: d.criteria.map((c) => c.trim()).filter(Boolean),
      deliverables: d.deliverables.map((x, j) => ({ id: prev?.deliverables[j]?.id ?? newId("dlv"), ...x })),
      dependsOn: d.dependsOnIndex !== null ? ids[d.dependsOnIndex]! : null,
      updatedAt: now,
    };
  });

  const next: Deal = { ...deal, title: req.title, summary: req.summary, terms: req.terms, milestones, version: deal.version + 1, acceptedBy: [editor] };
  const changes = diffPlans(deal, next);
  next.revisions = [...deal.revisions, { version: next.version, editedBy: editor, changes: changes.length ? changes : ["No material changes"], createdAt: now }];
  return next;
}

/** Human-readable change list between two plan versions (shown in the revision history). */
export function diffPlans(a: Deal, b: Deal): string[] {
  const out: string[] = [];
  if (a.title !== b.title) out.push(`Title → "${b.title}"`);
  const before = new Map(a.milestones.map((m) => [m.id, m]));
  const after = new Map(b.milestones.map((m) => [m.id, m]));
  for (const m of b.milestones) {
    const o = before.get(m.id);
    if (!o) {
      out.push(`Added "${m.title}" (${m.amount})`);
      continue;
    }
    if (o.title !== m.title) out.push(`Renamed "${o.title}" → "${m.title}"`);
    if (o.amount !== m.amount) out.push(`"${m.title}" amount ${o.amount} → ${m.amount}`);
    if (o.dueDate !== m.dueDate) out.push(`"${m.title}" due ${o.dueDate ?? "unset"} → ${m.dueDate ?? "unset"}`);
    if (o.criteria.join("|") !== m.criteria.join("|")) out.push(`"${m.title}" definition of done updated (${m.criteria.length} items)`);
    if (o.deliverables.map((d) => d.name + d.format).join("|") !== m.deliverables.map((d) => d.name + d.format).join("|"))
      out.push(`"${m.title}" deliverables updated (${m.deliverables.length})`);
    if (o.dependsOn !== m.dependsOn) out.push(`"${m.title}" dependency changed`);
  }
  for (const m of a.milestones) if (!after.has(m.id)) out.push(`Removed "${m.title}"`);
  if (JSON.stringify(a.terms) !== JSON.stringify(b.terms)) out.push("Payment terms updated");
  return out;
}

/** Validate an extension request against the agreed terms. */
export function validateExtension(m: Milestone, terms: PaymentTerms, toDate: string): void {
  if (isTerminal(m.status)) throw invalidState("This milestone is already closed");
  if (m.extensions.some((e) => e.status === "pending")) throw invalidState("There is already a pending extension request for this milestone");
  const current = m.dueDate ?? today();
  if (day(toDate) <= day(current)) throw new AppError("VALIDATION_ERROR", `The new date must be after the current due date (${current})`, 400);
  const added = Math.round((day(toDate) - day(current)) / DAY);
  if (added > terms.maxExtensionDays) {
    throw new AppError(
      "VALIDATION_ERROR",
      `That adds ${added} days; the agreed terms allow at most ${terms.maxExtensionDays} days per extension. Renegotiate the plan for bigger changes.`,
      400,
    );
  }
}

export function emptyMilestone(dealId: string, id: string, now: string): Milestone {
  return {
    id,
    dealId,
    position: 0,
    title: "",
    description: "",
    amount: "0.00",
    criteria: [],
    deliverables: [],
    dueDate: null,
    originalDueDate: null,
    dependsOn: null,
    extensions: [],
    submittedAt: null,
    status: "awaiting_funding",
    paypal: {},
    capturedAmount: null,
    proofs: [],
    verification: null,
    mediation: null,
    disputeStatements: {},
    updatedAt: now,
  };
}
