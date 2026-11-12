export type PayPalEnvironment = "sandbox" | "live";

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  environment?: PayPalEnvironment;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Max retries for 429 / 5xx / network errors. */
  maxRetries?: number;
  /** Base backoff in ms (exponential). */
  retryDelayMs?: number;
}

export interface Money {
  currency_code: string;
  value: string;
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface CreateHoldInput {
  amount: string;
  currency: string;
  description: string;
  /** Our milestone id — echoed back by PayPal as purchase_units[0].reference_id */
  referenceId: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
  requestId: string;
}

export interface Hold {
  orderId: string;
  status: string;
  approveUrl: string | undefined;
}

export interface OrderSummary {
  id: string;
  status: string;
  intent: string;
  amount: Money | undefined;
  payerEmail: string | undefined;
  authorizationId: string | undefined;
  authorizationStatus: string | undefined;
}

export interface Authorization {
  authorizationId: string;
  status: string;
  amount: Money | undefined;
  expirationTime: string | undefined;
  payerEmail: string | undefined;
}

export interface CaptureInput {
  /** Omit to capture the full authorized amount. */
  amount?: string;
  currency: string;
  /** true releases any remaining authorized funds back to the payer. */
  finalCapture: boolean;
  noteToPayer?: string;
  invoiceId?: string;
  requestId: string;
}

export interface Capture {
  captureId: string;
  status: string;
  amount: Money | undefined;
}

export interface RefundInput {
  amount?: string;
  currency: string;
  noteToPayer?: string;
  requestId: string;
}

export interface Refund {
  refundId: string;
  status: string;
  amount: Money | undefined;
}

export interface PayoutItem {
  receiverEmail: string;
  amount: string;
  currency: string;
  note?: string;
}

export interface PayoutInput {
  senderBatchId: string;
  subject: string;
  items: PayoutItem[];
}

export interface PayoutBatch {
  payoutBatchId: string;
  status: string;
}

export interface ReceiptInvoiceInput {
  invoicerName: string;
  recipientName: string;
  recipientEmail?: string;
  itemName: string;
  itemDescription: string;
  amount: string;
  currency: string;
  note?: string;
  reference: string;
  requestId: string;
}

export interface ReceiptInvoice {
  invoiceId: string;
  status: string;
  recorded: boolean;
}
