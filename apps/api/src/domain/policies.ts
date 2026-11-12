import { toCents, type ActionKind, type Milestone, type Party, type PolicyCheck } from "@arko/shared";
import { isHeld } from "./milestone.ts";

export interface PolicyInput {
  kind: ActionKind;
  milestone: Milestone;
  /** Amount that will move, as a decimal string. */
  amount: string;
  requestedBy: "agent" | "user";
  maxActionAmount: number;
}

/**
 * Guardrails evaluated before any money moves. Each policy is a small strategy that
 * returns a named, human-readable check so the approval card can show exactly why
 * an action is (or isn't) safe.
 */
type Policy = (input: PolicyInput) => PolicyCheck | null;

const fundsHeld: Policy = ({ kind, milestone }) =>
  kind === "refund"
    ? null
    : {
        name: "Funds are held by PayPal",
        passed: Boolean(milestone.paypal.authorizationId) && isHeld(milestone.status),
        detail: milestone.paypal.authorizationId
          ? `Authorization ${milestone.paypal.authorizationId} (${milestone.status})`
          : "No active PayPal authorization for this milestone",
      };

const withinHold: Policy = ({ kind, milestone, amount }) => {
  if (kind === "cancel") return null;
  const ceiling = kind === "refund" ? (milestone.capturedAmount ?? "0") : milestone.amount;
  return {
    name: kind === "refund" ? "Within captured amount" : "Within held amount",
    passed: toCents(amount) > 0 && toCents(amount) <= toCents(ceiling),
    detail: `${amount} of ${ceiling} ${kind === "refund" ? "captured" : "held"}`,
  };
};

const belowLimit: Policy = ({ amount, maxActionAmount }) => ({
  name: "Below per-action limit",
  passed: Number(amount) <= maxActionAmount,
  detail: `Limit ${maxActionAmount.toFixed(2)}`,
});

const workEvidence: Policy = ({ kind, milestone, requestedBy }) => {
  if (kind !== "release") return null;
  const verdict = milestone.verification;
  if (verdict?.recommendation === "release") {
    return { name: "Work verified", passed: true, detail: `Verifier score ${verdict.score}/100 — ${verdict.verdict}` };
  }
  // A person may release on their own judgement; an agent may not.
  return {
    name: "Work verified",
    passed: requestedBy === "user",
    detail: verdict
      ? `Verifier recommended "${verdict.recommendation}" — release needs the client's own decision`
      : "Not verified yet — release needs the client's own decision",
  };
};

const splitAgreed: Policy = ({ kind, milestone }) => {
  if (kind !== "split") return null;
  const accepted = milestone.mediation?.acceptedBy ?? [];
  return {
    name: "Both parties accepted the split",
    passed: accepted.includes("client") && accepted.includes("freelancer"),
    detail: `Accepted by: ${accepted.join(", ") || "nobody yet"}`,
  };
};

const capturedForRefund: Policy = ({ kind, milestone }) =>
  kind !== "refund"
    ? null
    : {
        name: "Payment was captured",
        passed: Boolean(milestone.paypal.captureId),
        detail: milestone.paypal.captureId ?? "No capture to refund",
      };

const POLICIES: Policy[] = [fundsHeld, capturedForRefund, withinHold, belowLimit, workEvidence, splitAgreed];

export function evaluatePolicies(input: PolicyInput): PolicyCheck[] {
  return POLICIES.map((p) => p(input)).filter((c): c is PolicyCheck => c !== null);
}

export const allPassed = (checks: PolicyCheck[]) => checks.every((c) => c.passed);

/**
 * Who must press "Approve" for each action — the human in the loop.
 * Releasing or splitting the client's money needs the client; cancelling after work was
 * submitted, or refunding a payment, needs the freelancer (the party giving money up).
 */
export function requiredApprover(kind: ActionKind, milestone: Milestone): Party {
  switch (kind) {
    case "release":
    case "split":
      return "client";
    case "cancel":
      return milestone.proofs.length > 0 ? "freelancer" : "client";
    case "refund":
      return "freelancer";
  }
}
