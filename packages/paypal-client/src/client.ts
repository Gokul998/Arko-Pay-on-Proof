import { PayPalApiError, PayPalConfigError, type PayPalIssue } from "./errors.ts";
import type {
  Authorization,
  Capture,
  CaptureInput,
  CreateHoldInput,
  Hold,
  Link,
  Money,
  OrderSummary,
  PayPalClientOptions,
  PayoutBatch,
  PayoutInput,
  ReceiptInvoice,
  ReceiptInvoiceInput,
  Refund,
  RefundInput,
} from "./types.ts";

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

interface RequestOptions {
  body?: unknown;
  /** Sent as PayPal-Request-Id so retried writes are idempotent. */
  requestId?: string;
  query?: Record<string, string>;
}

/* Minimal shapes of the PayPal responses we read. */
interface OrderResponse {
  id: string;
  status: string;
  intent?: string;
  links?: Link[];
  payer?: { email_address?: string };
  purchase_units?: Array<{
    amount?: Money;
    payments?: {
      authorizations?: Array<{ id: string; status: string; amount?: Money; expiration_time?: string }>;
    };
  }>;
}

/**
 * Typed PayPal REST client.
 *
 * - OAuth2 client-credentials token cached until 60 s before expiry
 * - Retries 429 / 5xx / network failures with exponential backoff
 * - Every write carries a PayPal-Request-Id so retries never double-charge
 */
export class PayPalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private token: { value: string; expiresAt: number } | undefined;
  private tokenPromise: Promise<string> | undefined;

  constructor(private readonly options: PayPalClientOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new PayPalConfigError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
    }
    this.baseUrl = BASE_URLS[options.environment ?? "sandbox"];
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 400;
  }

  get environment(): string {
    return this.options.environment ?? "sandbox";
  }

  /* ───────────── Orders v2 (escrow hold) ───────────── */

  /** Create an order with intent AUTHORIZE: the payer approves, funds are held but not taken. */
  async createHold(input: CreateHoldInput): Promise<Hold> {
    const order = await this.request<OrderResponse>("POST", "/v2/checkout/orders", {
      requestId: input.requestId,
      body: {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            reference_id: input.referenceId,
            custom_id: input.referenceId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: input.amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: input.brandName ?? "Arko Pay-on-Proof",
              user_action: "CONTINUE",
              shipping_preference: "NO_SHIPPING",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
            },
          },
        },
      },
    });
    const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    return { orderId: order.id, status: order.status, approveUrl };
  }

  async getOrder(orderId: string): Promise<OrderSummary> {
    const order = await this.request<OrderResponse>("GET", `/v2/checkout/orders/${enc(orderId)}`);
    return summarizeOrder(order);
  }

  /** After payer approval, turn the order into an authorization (the escrow hold). */
  async authorizeOrder(orderId: string, requestId: string): Promise<Authorization> {
    const order = await this.request<OrderResponse>(
      "POST",
      `/v2/checkout/orders/${enc(orderId)}/authorize`,
      { requestId, body: {} },
    );
    const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      throw new PayPalApiError(502, "NO_AUTHORIZATION", "PayPal returned no authorization", undefined);
    }
    return {
      authorizationId: auth.id,
      status: auth.status,
      amount: auth.amount,
      expirationTime: auth.expiration_time,
      payerEmail: order.payer?.email_address,
    };
  }

  /* ───────────── Payments v2 (release / split / cancel / refund) ───────────── */

  async getAuthorization(authorizationId: string): Promise<Authorization> {
    const a = await this.request<{ id: string; status: string; amount?: Money; expiration_time?: string }>(
      "GET",
      `/v2/payments/authorizations/${enc(authorizationId)}`,
    );
    return {
      authorizationId: a.id,
      status: a.status,
      amount: a.amount,
      expirationTime: a.expiration_time,
      payerEmail: undefined,
    };
  }

  /** Capture all (release) or part (split, with finalCapture=true voids the rest) of a hold. */
  async captureAuthorization(authorizationId: string, input: CaptureInput): Promise<Capture> {
    const body: Record<string, unknown> = { final_capture: input.finalCapture };
    if (input.amount) body.amount = { currency_code: input.currency, value: input.amount };
    if (input.noteToPayer) body.note_to_payer = input.noteToPayer.slice(0, 255);
    if (input.invoiceId) body.invoice_id = input.invoiceId.slice(0, 127);
    const c = await this.request<{ id: string; status: string; amount?: Money }>(
      "POST",
      `/v2/payments/authorizations/${enc(authorizationId)}/capture`,
      { requestId: input.requestId, body },
    );
    return { captureId: c.id, status: c.status, amount: c.amount };
  }

  /**
   * Renew a hold whose 3-day honor period has passed (e.g. after a milestone extension).
   * Returns a new authorization id; the original is superseded.
   */
  async reauthorize(authorizationId: string, input: { amount: string; currency: string; requestId: string }): Promise<Authorization> {
    const a = await this.request<{ id: string; status: string; amount?: Money; expiration_time?: string }>(
      "POST",
      `/v2/payments/authorizations/${enc(authorizationId)}/reauthorize`,
      { requestId: input.requestId, body: { amount: { currency_code: input.currency, value: input.amount } } },
    );
    return { authorizationId: a.id, status: a.status, amount: a.amount, expirationTime: a.expiration_time, payerEmail: undefined };
  }

  /** Release the whole hold back to the payer. */
  async voidAuthorization(authorizationId: string, requestId: string): Promise<{ status: string }> {
    await this.request<unknown>("POST", `/v2/payments/authorizations/${enc(authorizationId)}/void`, {
      requestId,
    });
    return { status: "VOIDED" };
  }

  async refundCapture(captureId: string, input: RefundInput): Promise<Refund> {
    const body: Record<string, unknown> = {};
    if (input.amount) body.amount = { currency_code: input.currency, value: input.amount };
    if (input.noteToPayer) body.note_to_payer = input.noteToPayer.slice(0, 255);
    const r = await this.request<{ id: string; status: string; amount?: Money }>(
      "POST",
      `/v2/payments/captures/${enc(captureId)}/refund`,
      { requestId: input.requestId, body },
    );
    return { refundId: r.id, status: r.status, amount: r.amount };
  }

  /* ───────────── Payouts v1 (pay sub-contractors) ───────────── */

  async createPayout(input: PayoutInput): Promise<PayoutBatch> {
    const res = await this.request<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
      "POST",
      "/v1/payments/payouts",
      {
        requestId: input.senderBatchId,
        body: {
          sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.subject },
          items: input.items.map((item, i) => ({
            recipient_type: "EMAIL",
            receiver: item.receiverEmail,
            amount: { currency: item.currency, value: item.amount },
            note: item.note,
            sender_item_id: `${input.senderBatchId}-${i}`,
          })),
        },
      },
    );
    return { payoutBatchId: res.batch_header.payout_batch_id, status: res.batch_header.batch_status };
  }

  /* ───────────── Invoicing v2 (receipt for the books) ───────────── */

  /** Create an invoice for a released milestone and record it as paid via PayPal. */
  async createReceiptInvoice(input: ReceiptInvoiceInput): Promise<ReceiptInvoice> {
    const recipient: Record<string, unknown> = {
      billing_info: {
        name: { full_name: input.recipientName },
        ...(input.recipientEmail ? { email_address: input.recipientEmail } : {}),
      },
    };
    const created = await this.request<{ id?: string; href?: string; links?: Link[] }>(
      "POST",
      "/v2/invoicing/invoices",
      {
        requestId: input.requestId,
        body: {
          detail: {
            currency_code: input.currency,
            reference: input.reference.slice(0, 120),
            note: input.note?.slice(0, 4000),
            invoice_date: today(),
          },
          invoicer: { business_name: input.invoicerName.slice(0, 300) },
          primary_recipients: [recipient],
          items: [
            {
              name: input.itemName.slice(0, 200),
              description: input.itemDescription.slice(0, 1000),
              quantity: "1",
              unit_amount: { currency_code: input.currency, value: input.amount },
              unit_of_measure: "AMOUNT",
            },
          ],
        },
      },
    );
    const invoiceId = created.id ?? lastPathSegment(created.href ?? created.links?.[0]?.href);
    if (!invoiceId) throw new PayPalApiError(502, "NO_INVOICE_ID", "PayPal returned no invoice id", undefined);

    let recorded = false;
    try {
      await this.request("POST", `/v2/invoicing/invoices/${enc(invoiceId)}/send`, {
        requestId: `${input.requestId}-send`,
        body: { send_to_invoicer: false, send_to_recipient: false },
      });
      await this.request("POST", `/v2/invoicing/invoices/${enc(invoiceId)}/payments`, {
        requestId: `${input.requestId}-pay`,
        body: {
          method: "PAYPAL",
          payment_date: today(),
          amount: { currency_code: input.currency, value: input.amount },
          note: "Released from Arko escrow",
        },
      });
      recorded = true;
    } catch (err) {
      // The receipt itself exists; recording payment is best-effort.
      if (!(err instanceof PayPalApiError)) throw err;
    }
    return { invoiceId, status: recorded ? "PAID" : "DRAFT", recorded };
  }

  /* ───────────── transport ───────────── */

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      };
      if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        });
      } catch (networkError) {
        if (attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw networkError;
      }

      if (res.status === 401 && attempt === 0) {
        this.token = undefined; // token revoked/expired early — refresh once
        continue;
      }
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const error = await toApiError(res);
      if (error.retryable && attempt < this.maxRetries) {
        await sleep(this.backoff(attempt));
        continue;
      }
      throw error;
    }
  }

  private backoff(attempt: number): number {
    return this.retryDelayMs * 2 ** attempt;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    // Coalesce concurrent refreshes into one request.
    this.tokenPromise ??= this.fetchToken().finally(() => {
      this.tokenPromise = undefined;
    });
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(new URL("/v1/oauth2/token", this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw await toApiError(res);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  }
}

/* ───────────── helpers ───────────── */

const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const lastPathSegment = (href?: string) => href?.split("/").filter(Boolean).pop();

function summarizeOrder(order: OrderResponse): OrderSummary {
  const unit = order.purchase_units?.[0];
  const auth = unit?.payments?.authorizations?.[0];
  return {
    id: order.id,
    status: order.status,
    intent: order.intent ?? "AUTHORIZE",
    amount: unit?.amount,
    payerEmail: order.payer?.email_address,
    authorizationId: auth?.id,
    authorizationStatus: auth?.status,
  };
}

async function toApiError(res: Response): Promise<PayPalApiError> {
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  let body: { name?: string; message?: string; error?: string; error_description?: string; details?: PayPalIssue[] } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* non-JSON error body */
  }
  const issue = body.details?.[0];
  const code = issue?.issue ?? body.name ?? body.error ?? `HTTP_${res.status}`;
  const message = issue?.description ?? body.message ?? body.error_description ?? res.statusText;
  return new PayPalApiError(res.status, code, message, debugId ?? (body as { debug_id?: string }).debug_id, body.details);
}
