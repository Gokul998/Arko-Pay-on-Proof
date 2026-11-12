import { describe, expect, it } from "vitest";
import { DealService } from "../src/application/deal-service.ts";
import type { MediatorAgent, PaymentsGateway, VerifierAgent } from "../src/application/ports.ts";
import { canTransition } from "../src/domain/milestone.ts";
import { AccessKeys } from "../src/application/access-keys.ts";
import { PaymentTerms } from "@arko/shared";
import { evaluatePolicies } from "../src/domain/policies.ts";
import { FileProofStore } from "../src/infrastructure/storage/file-proof-store.ts";
import {
  openDatabase,
  SqliteActionRepository,
  SqliteAuditLog,
  SqliteDealRepository,
} from "../src/infrastructure/persistence/sqlite.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ── fakes ── */
function fakePayments() {
  const calls: Array<{ op: string; args: unknown }> = [];
  const gw: PaymentsGateway = {
    createHold: async (a) => (calls.push({ op: "createHold", args: a }), { orderId: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://paypal.test/approve" }),
    getOrder: async () => ({ status: "APPROVED" }),
    authorizeOrder: async () => (calls.push({ op: "authorize", args: null }), { authorizationId: "AUTH1", status: "CREATED" }),
    getAuthorization: async () => ({ authorizationId: "AUTH1", status: "CREATED" }),
    capture: async (a) => (calls.push({ op: "capture", args: a }), { captureId: "CAP1", status: "COMPLETED" }),
    void: async (id) => (calls.push({ op: "void", args: id }), { status: "VOIDED" }),
    reauthorize: async () => ({ authorizationId: "AUTH2", status: "CREATED" }),
    refund: async (a) => (calls.push({ op: "refund", args: a }), { refundId: "REF1", status: "COMPLETED" }),
    receipt: async () => ({ invoiceId: "INV1", status: "PAID" }),
  };
  return { gw, calls };
}

const verifier = (recommendation: "release" | "mediate"): VerifierAgent => ({
  verify: async ({ milestone }) => ({
    verdict: recommendation === "release" ? "pass" : "partial",
    score: recommendation === "release" ? 92 : 55,
    summary: "ok",
    criteria: milestone.criteria.map((c) => ({ criterion: c, status: "met" as const, evidence: "proof 1" })),
    recommendation,
    checkedAt: new Date().toISOString(),
  }),
});

const mediator: MediatorAgent = {
  mediate: async () => ({ clientStatement: "x", freelancerStatement: "y", freelancerPercent: 60, reasoning: "fair", proposedAt: new Date().toISOString() }),
};

function setup(rec: "release" | "mediate" = "release") {
  const db = openDatabase(":memory:");
  const { gw, calls } = fakePayments();
  const svc = new DealService({
    deals: new SqliteDealRepository(db),
    actions: new SqliteActionRepository(db),
    audit: new SqliteAuditLog(db),
    proofs: new FileProofStore(mkdtempSync(join(tmpdir(), "arko-"))),
    payments: () => gw,
    contract: () => ({
      draft: async () => ({
        title: "Logo + site",
        sourceExcerpt: "",
        summary: "A logo and landing page",
        clientName: "Maya",
        freelancerName: "Ravi",
        currency: "USD",
        terms: { reviewWindowDays: 3, revisionRounds: 2 },
        milestones: [
          { title: "Logo", description: "Logo pack", amount: "300.00", dueInDays: 5, criteria: ["SVG and PNG", "3 concepts"], deliverables: [{ name: "Logo files", format: "SVG + PNG" }], dependsOnPrevious: false },
        ],
      }),
    }),
    verifier: () => verifier(rec),
    mediator: () => mediator,
    planReviewer: () => ({ review: async () => ({ readiness: 90, summary: "ok", issues: [] }) }),
    readDocument: async (doc) => ({ kind: "text", name: doc.name, text: Buffer.from(doc.dataBase64, "base64").toString() }),
    publicUrl: "http://localhost:5173",
    maxActionAmount: 5000,
  });
  return { svc, calls };
}

async function fundedDeal(svc: DealService) {
  let deal = await svc.createDeal({ text: "Ravi designs a logo for Maya for $300, SVG + PNG, three concepts." });
  svc.acceptTerms(deal.id, "client", deal.version);
  deal = svc.acceptTerms(deal.id, "freelancer", deal.version);
  const ms = deal.milestones[0]!;
  await svc.fund(deal.id, ms.id);
  deal = await svc.confirmFunding(deal.id, ms.id);
  return { deal, ms: deal.milestones[0]! };
}

describe("escrow state machine", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("funded", "released")).toBe(true);
    expect(canTransition("awaiting_funding", "released")).toBe(false);
    expect(canTransition("released", "cancelled")).toBe(false);
  });
});

describe("DealService escrow flow", () => {
  it("cannot fund before both parties accept", async () => {
    const { svc } = setup();
    const deal = await svc.createDeal({ text: "Ravi designs a logo for Maya for $300, SVG + PNG, three concepts." });
    await expect(svc.fund(deal.id, deal.milestones[0]!.id)).rejects.toThrow(/accept the plan/);
  });

  it("holds funds, verifies proof and releases only after the client approves", async () => {
    const { svc, calls } = setup("release");
    const { deal, ms } = await fundedDeal(svc);
    expect(ms.status).toBe("funded");
    expect(ms.paypal.authorizationId).toBe("AUTH1");

    svc.submitProof(deal.id, ms.id, { kind: "note", name: "Delivery", note: "Files attached in drive" });
    await svc.verify(deal.id, ms.id);

    const action = svc.proposeAction({ dealId: deal.id, milestoneId: ms.id, kind: "release", requestedBy: "agent" });
    expect(action.checks.every((c) => c.passed)).toBe(true);
    expect(calls.some((c) => c.op === "capture")).toBe(false); // nothing moved yet

    await expect(svc.approveAction(action.id, "freelancer")).rejects.toThrow(/Only the client/);
    const { deal: after } = await svc.approveAction(action.id, "client");
    expect(after.milestones[0]!.status).toBe("released");
    expect(calls.find((c) => c.op === "capture")!.args).toMatchObject({ authorizationId: "AUTH1", finalCapture: true, requestId: `release-${ms.id}` });
  });

  it("an agent cannot get an unverified release past the policy gate", async () => {
    const { svc } = setup("mediate");
    const { deal, ms } = await fundedDeal(svc);
    const action = svc.proposeAction({ dealId: deal.id, milestoneId: ms.id, kind: "release", requestedBy: "agent" });
    expect(action.checks.find((c) => c.name === "Work verified")!.passed).toBe(false);
    await expect(svc.approveAction(action.id, "client")).rejects.toThrow(/Safety checks failed/);
  });

  it("settles a dispute with a partial capture once both parties accept the split", async () => {
    const { svc, calls } = setup("mediate");
    const { deal, ms } = await fundedDeal(svc);
    svc.dispute(deal.id, ms.id, "client", "Only one concept was delivered, not three.");
    svc.dispute(deal.id, ms.id, "freelancer", "The other two were shared on a call.");
    await svc.mediate(deal.id, ms.id);
    svc.acceptMediation(deal.id, ms.id, "client");
    svc.acceptMediation(deal.id, ms.id, "freelancer");

    const action = svc.proposeAction({ dealId: deal.id, milestoneId: ms.id, kind: "split", requestedBy: "user" });
    expect(action.amount).toBe("180.00"); // 60% of 300
    const { deal: after } = await svc.approveAction(action.id, "client");
    expect(after.milestones[0]!.status).toBe("settled");
    expect(calls.find((c) => c.op === "capture")!.args).toMatchObject({ amount: "180.00", finalCapture: true });
  });
});

describe("policies", () => {
  it("blocks amounts above the per-action limit", async () => {
    const { svc } = setup();
    const { ms } = await fundedDeal(svc);
    const checks = evaluatePolicies({ kind: "release", milestone: ms, amount: ms.amount, requestedBy: "user", maxActionAmount: 100 });
    expect(checks.find((c) => c.name === "Below per-action limit")!.passed).toBe(false);
  });
});

describe("plan negotiation", () => {
  const planReq = (version: number, amount = "300.00", firstId?: string) => ({
    expectedVersion: version,
    title: "Logo",
    summary: "s",
    terms: PaymentTerms.parse({}),
    milestones: [
      { id: firstId, title: "Logo", description: "", amount, dueDate: "2026-12-01", criteria: ["SVG and PNG"], deliverables: [], dependsOnIndex: null },
      { title: "Brand sheet", description: "", amount: "100.00", dueDate: "2026-12-05", criteria: ["Colors + fonts"], deliverables: [{ name: "Sheet", format: "PDF", notes: "" }], dependsOnIndex: 0 },
    ],
  });

  it("versions every edit and requires both parties to accept the same version", async () => {
    const { svc } = setup();
    const deal = await svc.createDeal({ text: "Ravi designs a logo for Maya for $300, SVG + PNG, three concepts." });
    svc.acceptTerms(deal.id, "client", 1);
    const v2 = svc.updatePlan(deal.id, "freelancer", planReq(1, "350.00", deal.milestones[0]!.id));
    expect(v2.version).toBe(2);
    expect(v2.acceptedBy).toEqual(["freelancer"]); // client must re-approve
    expect(v2.revisions.at(-1)!.changes.join(" ")).toMatch(/amount 300.00 → 350.00/);
    expect(v2.milestones[1]!.dependsOn).toBe(v2.milestones[0]!.id);

    expect(() => svc.acceptTerms(deal.id, "client", 1)).toThrow(/now at v2/);
    expect(svc.acceptTerms(deal.id, "client", 2).status).toBe("active");
  });

  it("rejects a stale edit (optimistic concurrency)", async () => {
    const { svc } = setup();
    const deal = await svc.createDeal({ text: "Ravi designs a logo for Maya for $300, SVG + PNG, three concepts." });
    svc.updatePlan(deal.id, "client", planReq(1));
    expect(() => svc.updatePlan(deal.id, "freelancer", planReq(1))).toThrow(/changed to v2/);
  });
});

describe("extensions", () => {
  it("lets one party request and only the other party approve a new due date", async () => {
    const { svc } = setup();
    const { deal, ms } = await fundedDeal(svc);
    const to = new Date(Date.parse(ms.dueDate!) + 5 * 86_400_000).toISOString().slice(0, 10);
    const withReq = svc.requestExtension(deal.id, ms.id, "freelancer", { toDate: to, reason: "Client sent new brand assets late" });
    const ext = withReq.milestones[0]!.extensions[0]!;
    expect(() => svc.decideExtension(deal.id, ms.id, ext.id, "freelancer", true)).toThrow(/other party/);
    const after = svc.decideExtension(deal.id, ms.id, ext.id, "client", true);
    expect(after.milestones[0]!.dueDate).toBe(to);
    expect(after.milestones[0]!.originalDueDate).toBe(ms.dueDate);
  });

  it("enforces the agreed maximum extension", async () => {
    const { svc } = setup();
    const { deal, ms } = await fundedDeal(svc);
    const far = new Date(Date.parse(ms.dueDate!) + 60 * 86_400_000).toISOString().slice(0, 10);
    expect(() => svc.requestExtension(deal.id, ms.id, "freelancer", { toDate: far, reason: "Need much more time" })).toThrow(/at most 14 days/);
  });
});

describe("access keys", () => {
  it("issues verifiable per-party keys and rejects tampering", () => {
    const keys = new AccessKeys("x".repeat(40));
    const k = keys.issue("deal_1", "freelancer");
    expect(keys.verify(k)).toEqual({ dealId: "deal_1", party: "freelancer" });
    const [payload, sig] = k.split(".");
    const forged = Buffer.from(JSON.stringify({ d: "deal_1", p: "client", n: "x" })).toString("base64url");
    expect(keys.verify(`${forged}.${sig}`)).toBeNull();
    expect(keys.verify(`${payload}.bad`)).toBeNull();
  });
});
