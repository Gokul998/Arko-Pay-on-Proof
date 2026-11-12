import { z } from "zod";

/* ───────────────────────── Domain DTOs (API ⇄ Web contract) ───────────────────────── */

export const Amount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a decimal like 450.00");

export const Currency = z.enum(["USD", "EUR", "GBP", "AUD", "CAD"]);
export type Currency = z.infer<typeof Currency>;

export const MilestoneStatus = z.enum([
  "awaiting_funding", // terms agreed, no money held yet
  "funding_pending", // PayPal order created, payer approving
  "funded", // authorization held by PayPal
  "submitted", // freelancer uploaded proof
  "verified", // Verifier Agent produced a verdict
  "disputed", // a party raised a dispute
  "mediated", // Mediator Agent proposed a split
  "released", // full capture → freelancer paid
  "settled", // partial capture → split executed
  "cancelled", // authorization voided → client keeps money
]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const Party = z.enum(["client", "freelancer"]);
export type Party = z.infer<typeof Party>;

export const CriterionResult = z.object({
  criterion: z.string(),
  status: z.enum(["met", "partial", "not_met"]),
  evidence: z.string(),
});
export type CriterionResult = z.infer<typeof CriterionResult>;

export const Verification = z.object({
  verdict: z.enum(["pass", "partial", "fail"]),
  score: z.number().min(0).max(100),
  summary: z.string(),
  criteria: z.array(CriterionResult),
  recommendation: z.enum(["release", "request_changes", "mediate"]),
  checkedAt: z.string(),
});
export type Verification = z.infer<typeof Verification>;

export const Mediation = z.object({
  clientStatement: z.string(),
  freelancerStatement: z.string(),
  freelancerPercent: z.number().int().min(0).max(100),
  reasoning: z.string(),
  proposedAt: z.string(),
  acceptedBy: z.array(Party),
});
export type Mediation = z.infer<typeof Mediation>;

export const Proof = z.object({
  id: z.string(),
  milestoneId: z.string(),
  kind: z.enum(["file", "link", "note"]),
  name: z.string(),
  mimeType: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
});
export type Proof = z.infer<typeof Proof>;

export const Deliverable = z.object({
  id: z.string(),
  name: z.string().min(1).max(160),
  format: z.string().max(160).default(""),
  notes: z.string().max(1000).default(""),
});
export type Deliverable = z.infer<typeof Deliverable>;

export const ExtensionRequest = z.object({
  id: z.string(),
  requestedBy: Party,
  fromDate: z.string().nullable(),
  toDate: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
  decidedBy: Party.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type ExtensionRequest = z.infer<typeof ExtensionRequest>;

export const PaymentTerms = z.object({
  /** How funds are held: each milestone when it starts, or every milestone upfront. */
  fundingSchedule: z.enum(["per_milestone", "all_upfront"]).default("per_milestone"),
  /** Days the client has to review submitted work before it is overdue for review. */
  reviewWindowDays: z.number().int().min(1).max(30).default(3),
  /** Included revision rounds per milestone. */
  revisionRounds: z.number().int().min(0).max(10).default(2),
  /** Max days a single extension may add without renegotiating the plan. */
  maxExtensionDays: z.number().int().min(0).max(60).default(14),
  lateDeliveryPolicy: z.string().max(500).default("Late delivery may be extended once by mutual agreement."),
  cancellationPolicy: z.string().max(500).default("Unstarted milestones can be cancelled with a full return of held funds."),
  notes: z.string().max(1000).default(""),
});
export type PaymentTerms = z.infer<typeof PaymentTerms>;

export const PlanIssue = z.object({
  severity: z.enum(["blocker", "warning", "suggestion"]),
  milestone: z.string().nullable(),
  message: z.string(),
  suggestion: z.string(),
});
export type PlanIssue = z.infer<typeof PlanIssue>;

export const PlanReview = z.object({
  version: z.number().int(),
  readiness: z.number().min(0).max(100),
  summary: z.string(),
  issues: z.array(PlanIssue),
  reviewedAt: z.string(),
});
export type PlanReview = z.infer<typeof PlanReview>;

export const PlanRevision = z.object({
  version: z.number().int(),
  editedBy: z.union([Party, z.literal("contract-agent")]),
  changes: z.array(z.string()),
  createdAt: z.string(),
});
export type PlanRevision = z.infer<typeof PlanRevision>;

export const PayPalRefs = z.object({
  orderId: z.string().optional(),
  approveUrl: z.string().optional(),
  authorizationId: z.string().optional(),
  captureId: z.string().optional(),
  refundId: z.string().optional(),
  invoiceId: z.string().optional(),
  payoutBatchId: z.string().optional(),
  payerEmail: z.string().optional(),
  authorizedAt: z.string().optional(),
  holdExpiresAt: z.string().optional(),
});
export type PayPalRefs = z.infer<typeof PayPalRefs>;

export const Milestone = z.object({
  id: z.string(),
  dealId: z.string(),
  position: z.number().int(),
  title: z.string(),
  description: z.string(),
  amount: Amount,
  /** Definition of done — objective acceptance criteria. */
  criteria: z.array(z.string()),
  deliverables: z.array(Deliverable),
  dueDate: z.string().nullable(),
  originalDueDate: z.string().nullable(),
  dependsOn: z.string().nullable(),
  extensions: z.array(ExtensionRequest),
  submittedAt: z.string().nullable(),
  status: MilestoneStatus,
  paypal: PayPalRefs,
  capturedAmount: Amount.nullable(),
  proofs: z.array(Proof),
  verification: Verification.nullable(),
  mediation: Mediation.nullable(),
  disputeStatements: z.record(z.string(), z.string()),
  updatedAt: z.string(),
});
export type Milestone = z.infer<typeof Milestone>;

export const DealStatus = z.enum(["proposed", "active", "completed"]);
export type DealStatus = z.infer<typeof DealStatus>;

export const Deal = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  clientName: z.string(),
  freelancerName: z.string(),
  freelancerEmail: z.string(),
  currency: Currency,
  /** The agreement text, or the AI's faithful transcription of an uploaded document. */
  sourceText: z.string(),
  sourceDocument: z.object({ name: z.string(), mimeType: z.string() }).nullable().default(null),
  status: DealStatus,
  /** Plan version — bumps on every edit; both parties must accept the same version. */
  version: z.number().int(),
  acceptedBy: z.array(Party),
  terms: PaymentTerms,
  revisions: z.array(PlanRevision),
  planReview: PlanReview.nullable(),
  createdAt: z.string(),
  milestones: z.array(Milestone),
});
export type Deal = z.infer<typeof Deal>;

export const PolicyCheck = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type PolicyCheck = z.infer<typeof PolicyCheck>;

export const ActionKind = z.enum(["release", "split", "cancel", "refund"]);
export type ActionKind = z.infer<typeof ActionKind>;

export const PendingAction = z.object({
  id: z.string(),
  dealId: z.string(),
  milestoneId: z.string(),
  kind: ActionKind,
  summary: z.string(),
  amount: Amount,
  currency: Currency,
  params: z.record(z.string(), z.unknown()),
  checks: z.array(PolicyCheck),
  status: z.enum(["pending", "executed", "rejected", "failed"]),
  requestedBy: z.enum(["agent", "user"]),
  error: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type PendingAction = z.infer<typeof PendingAction>;

export const AuditEvent = z.object({
  id: z.string(),
  dealId: z.string().nullable(),
  actor: z.string(),
  type: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/* ───────────────────────── Requests ───────────────────────── */

/** A statement of work / work order uploaded in any common format. */
export const SourceDocument = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.string().max(150),
  /** base64 body without the data: prefix, max ~10 MB */
  dataBase64: z.string().min(1).max(14_000_000),
});
export type SourceDocument = z.infer<typeof SourceDocument>;

export const CreateDealRequest = z
  .object({
    text: z.string().max(40_000).optional(),
    document: SourceDocument.optional(),
    clientName: z.string().max(80).optional(),
    freelancerName: z.string().max(80).optional(),
    freelancerEmail: z.email().optional(),
    currency: Currency.optional(),
  })
  .refine((r) => r.document || (r.text && r.text.trim().length >= 20), {
    message: "Upload the SOW / work order, or paste the agreement (at least a couple of sentences)",
    path: ["text"],
  });
export type CreateDealRequest = z.infer<typeof CreateDealRequest>;

export const AcceptTermsRequest = z.object({ version: z.number().int() });

export const MilestoneDraft = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).default(""),
  amount: Amount.refine((a) => Number(a) > 0, "Amount must be greater than 0"),
  dueDate: z.iso.date().nullable(),
  criteria: z.array(z.string().min(1).max(400)).min(1, "Add at least one definition-of-done item").max(12),
  deliverables: z.array(z.object({ name: z.string().min(1).max(160), format: z.string().max(160).default(""), notes: z.string().max(1000).default("") })).max(12),
  /** 0-based index of the milestone this one depends on (within the submitted list). */
  dependsOnIndex: z.number().int().min(0).nullable().default(null),
});
export type MilestoneDraft = z.infer<typeof MilestoneDraft>;

export const UpdatePlanRequest = z.object({
  expectedVersion: z.number().int(),
  title: z.string().min(1).max(120),
  summary: z.string().max(1000),
  terms: PaymentTerms,
  milestones: z.array(MilestoneDraft).min(1).max(10),
});
export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequest>;

export const ExtensionRequestBody = z.object({
  toDate: z.iso.date(),
  reason: z.string().min(5).max(1000),
});
export type ExtensionRequestBody = z.infer<typeof ExtensionRequestBody>;

export const DecideExtensionRequest = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });

export const SubmitProofRequest = z
  .object({
    kind: z.enum(["file", "link", "note"]),
    name: z.string().min(1).max(200),
    note: z.string().max(5_000).optional(),
    url: z.url().optional(),
    mimeType: z.string().max(100).optional(),
    /** base64 file body (no data: prefix), max ~10 MB */
    dataBase64: z.string().max(14_000_000).optional(),
  })
  .refine((p) => p.kind !== "file" || (p.dataBase64 && p.mimeType), {
    message: "File proofs need dataBase64 and mimeType",
  })
  .refine((p) => p.kind !== "link" || p.url, { message: "Link proofs need a url" });
export type SubmitProofRequest = z.infer<typeof SubmitProofRequest>;

export const DisputeRequest = z.object({
  statement: z.string().min(10).max(4_000),
});
export type DisputeRequest = z.infer<typeof DisputeRequest>;

export const AcceptMediationRequest = z.object({});

export const ChatRequest = z.object({
  message: z.string().min(1).max(8_000),
  dealId: z.string().optional(),
  /** Role the user is acting as; must match one of the caller's keys. */
  party: Party.default("client"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .default([]),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/* ───────────────────────── Streaming chat events (SSE) ───────────────────────── */

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error"; summary?: string }
  | { type: "approval"; action: PendingAction }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Returned once when a deal is created: signed capability keys for each party. */
export interface CreatedDeal {
  deal: Deal;
  keys: Record<Party, string>;
}

export interface HealthStatus {
  ok: boolean;
  paypal: "configured" | "missing";
  claude: "configured" | "missing";
  model: string;
  environment: string;
}
