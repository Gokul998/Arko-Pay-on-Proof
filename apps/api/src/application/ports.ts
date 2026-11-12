import type {
  AuditEvent,
  Currency,
  Deal,
  Mediation,
  Milestone,
  PaymentTerms,
  PendingAction,
  PlanReview,
  Proof,
  Verification,
} from "@arko/shared";

/* ───────── Persistence ───────── */

export interface DealRepository {
  list(): Deal[];
  get(id: string): Deal | undefined;
  save(deal: Deal): void;
}

export interface ActionRepository {
  list(filter?: { dealId?: string; status?: PendingAction["status"] }): PendingAction[];
  get(id: string): PendingAction | undefined;
  save(action: PendingAction): void;
}

export interface AuditLog {
  record(event: Omit<AuditEvent, "id" | "createdAt">): AuditEvent;
  list(dealId?: string, limit?: number): AuditEvent[];
}

export interface StoredFile {
  proof: Proof;
  data?: Buffer;
}

export interface ProofStore {
  saveFile(proof: Proof, data: Buffer): void;
  read(proof: Proof): StoredFile;
}

/* ───────── PayPal (implemented over MCP) ───────── */

export interface PaymentsGateway {
  createHold(input: {
    amount: string;
    currency: Currency;
    description: string;
    referenceId: string;
    returnUrl: string;
    cancelUrl: string;
    requestId: string;
  }): Promise<{ orderId: string; status: string; approveUrl?: string }>;
  getOrder(orderId: string): Promise<{ status: string; authorizationId?: string; payerEmail?: string }>;
  authorizeOrder(orderId: string, requestId: string): Promise<{ authorizationId: string; status: string; payerEmail?: string; expirationTime?: string }>;
  getAuthorization(authorizationId: string): Promise<{ authorizationId: string; status: string; expirationTime?: string; amount?: { value: string; currency_code: string } }>;
  capture(input: {
    authorizationId: string;
    amount?: string;
    currency: Currency;
    finalCapture: boolean;
    noteToPayer?: string;
    invoiceId?: string;
    requestId: string;
  }): Promise<{ captureId: string; status: string }>;
  void(authorizationId: string, requestId: string): Promise<{ status: string }>;
  reauthorize(input: { authorizationId: string; amount: string; currency: Currency; requestId: string }): Promise<{ authorizationId: string; status: string; expirationTime?: string }>;
  refund(input: { captureId: string; amount?: string; currency: Currency; noteToPayer?: string; requestId: string }): Promise<{ refundId: string; status: string }>;
  receipt(input: {
    invoicerName: string;
    recipientName: string;
    itemName: string;
    itemDescription: string;
    amount: string;
    currency: Currency;
    reference: string;
    requestId: string;
  }): Promise<{ invoiceId: string; status: string }>;
}

/* ───────── AI agents ───────── */

export interface DraftedDeal {
  title: string;
  /** Faithful condensed transcription of the scope, amounts, dates and payment terms. */
  sourceExcerpt: string;
  summary: string;
  clientName: string;
  freelancerName: string;
  currency: Currency;
  terms: Partial<PaymentTerms>;
  milestones: Array<{
    title: string;
    description: string;
    amount: string;
    dueInDays: number | null;
    criteria: string[];
    deliverables: Array<{ name: string; format: string }>;
    dependsOnPrevious: boolean;
  }>;
}

export interface PlanReviewAgent {
  review(deal: Deal): Promise<Omit<PlanReview, "version" | "reviewedAt">>;
}

/** Statement of work as Claude will read it. */
export type SourceMaterial =
  | { kind: "text"; name: string; text: string }
  | { kind: "pdf"; name: string; data: string }
  | { kind: "image"; name: string; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

export interface ContractAgent {
  draft(source: SourceMaterial, hints: { clientName?: string; freelancerName?: string; currency?: Currency }): Promise<DraftedDeal>;
}

export interface VerifierAgent {
  verify(input: { deal: Deal; milestone: Milestone; proofs: StoredFile[] }): Promise<Verification>;
}

export interface MediatorAgent {
  mediate(input: { deal: Deal; milestone: Milestone; proofs: StoredFile[] }): Promise<Omit<Mediation, "acceptedBy">>;
}
