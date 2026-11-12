import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PayPalApiError, type PayPalClient } from "@arko/paypal-client";
import { z } from "zod";

/** Tool names are exported so callers (the Arko API) never hard-code strings. */
export const PayPalTools = {
  createHold: "paypal_create_hold",
  authorizeOrder: "paypal_authorize_order",
  getOrder: "paypal_get_order",
  getAuthorization: "paypal_get_authorization",
  captureAuthorization: "paypal_capture_authorization",
  voidAuthorization: "paypal_void_authorization",
  reauthorize: "paypal_reauthorize",
  refundCapture: "paypal_refund_capture",
  createPayout: "paypal_create_payout",
  createReceiptInvoice: "paypal_create_receipt_invoice",
} as const;
export type PayPalToolName = (typeof PayPalTools)[keyof typeof PayPalTools];

const amount = z.string().regex(/^\d+(\.\d{1,2})?$/).describe('Decimal amount, e.g. "450.00"');
const currency = z.string().length(3).describe("ISO 4217 currency code, e.g. USD");
const requestId = z
  .string()
  .min(1)
  .max(108)
  .describe("Idempotency key sent as PayPal-Request-Id. Reuse it when retrying the same action.");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const MONEY_MOVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/**
 * Build an MCP server exposing PayPal escrow primitives.
 * The same server runs in-process inside the Arko API and standalone over stdio
 * (e.g. Claude Desktop), so any MCP-capable agent can hold, release and split payments.
 */
export function createPayPalMcpServer(paypal: PayPalClient): McpServer {
  const server = new McpServer(
    { name: "arko-paypal", version: "1.0.0" },
    {
      instructions:
        "PayPal escrow tools. Funds are held with an AUTHORIZE order, then released (capture), " +
        "split (partial capture with final_capture=true) or returned (void). Tools marked destructive " +
        "move real money: confirm with the user before calling them.",
    },
  );

  server.registerTool(
    PayPalTools.createHold,
    {
      title: "Create escrow hold",
      description:
        "Create a PayPal order with intent AUTHORIZE for a milestone. Returns an approval URL the payer " +
        "must open; once approved, call paypal_authorize_order to place the hold.",
      inputSchema: {
        amount,
        currency,
        description: z.string().max(127),
        referenceId: z.string().max(127).describe("Your milestone id"),
        returnUrl: z.url(),
        cancelUrl: z.url(),
        requestId,
      },
      annotations: WRITE,
    },
    (args) => run(() => paypal.createHold(args)),
  );

  server.registerTool(
    PayPalTools.authorizeOrder,
    {
      title: "Place the hold",
      description: "Authorize an approved order. Funds stay on the payer's account, reserved for up to 29 days.",
      inputSchema: { orderId: z.string(), requestId },
      annotations: WRITE,
    },
    ({ orderId, requestId: rid }) => run(() => paypal.authorizeOrder(orderId, rid)),
  );

  server.registerTool(
    PayPalTools.getOrder,
    {
      title: "Get order",
      description: "Read a PayPal order: status, amount, payer and any authorization.",
      inputSchema: { orderId: z.string() },
      annotations: READ_ONLY,
    },
    ({ orderId }) => run(() => paypal.getOrder(orderId)),
  );

  server.registerTool(
    PayPalTools.getAuthorization,
    {
      title: "Get hold status",
      description: "Read an authorization (escrow hold): status, amount and expiry.",
      inputSchema: { authorizationId: z.string() },
      annotations: READ_ONLY,
    },
    ({ authorizationId }) => run(() => paypal.getAuthorization(authorizationId)),
  );

  server.registerTool(
    PayPalTools.captureAuthorization,
    {
      title: "Release or split held funds",
      description:
        "Capture an authorization. Omit amount to release everything to the payee. Pass a smaller amount " +
        "with finalCapture=true to split: the payee receives `amount` and the rest returns to the payer.",
      inputSchema: {
        authorizationId: z.string(),
        amount: amount.optional(),
        currency,
        finalCapture: z.boolean().default(true),
        noteToPayer: z.string().max(255).optional(),
        invoiceId: z.string().max(127).optional(),
        requestId,
      },
      annotations: MONEY_MOVE,
    },
    ({ authorizationId, ...input }) => run(() => paypal.captureAuthorization(authorizationId, input)),
  );

  server.registerTool(
    PayPalTools.reauthorize,
    {
      title: "Renew hold",
      description:
        "Reauthorize a hold after its 3-day honor period, e.g. when a milestone deadline is extended. Returns a new authorization id.",
      inputSchema: { authorizationId: z.string(), amount, currency, requestId },
      annotations: WRITE,
    },
    ({ authorizationId, ...input }) => run(() => paypal.reauthorize(authorizationId, input)),
  );

  server.registerTool(
    PayPalTools.voidAuthorization,
    {
      title: "Cancel hold",
      description: "Void an authorization. The full held amount returns to the payer.",
      inputSchema: { authorizationId: z.string(), requestId },
      annotations: MONEY_MOVE,
    },
    ({ authorizationId, requestId: rid }) => run(() => paypal.voidAuthorization(authorizationId, rid)),
  );

  server.registerTool(
    PayPalTools.refundCapture,
    {
      title: "Refund a released payment",
      description: "Refund all or part of a captured payment back to the payer.",
      inputSchema: {
        captureId: z.string(),
        amount: amount.optional(),
        currency,
        noteToPayer: z.string().max(255).optional(),
        requestId,
      },
      annotations: MONEY_MOVE,
    },
    ({ captureId, ...input }) => run(() => paypal.refundCapture(captureId, input)),
  );

  server.registerTool(
    PayPalTools.createPayout,
    {
      title: "Pay collaborators",
      description: "Send PayPal Payouts to sub-contractors by email, e.g. after a milestone is released.",
      inputSchema: {
        senderBatchId: z.string().max(127),
        subject: z.string().max(255),
        items: z
          .array(z.object({ receiverEmail: z.email(), amount, currency, note: z.string().max(4000).optional() }))
          .min(1)
          .max(15),
      },
      annotations: MONEY_MOVE,
    },
    (args) => run(() => paypal.createPayout(args)),
  );

  server.registerTool(
    PayPalTools.createReceiptInvoice,
    {
      title: "Issue receipt invoice",
      description: "Create a PayPal invoice for released work and record it as paid, for bookkeeping.",
      inputSchema: {
        invoicerName: z.string(),
        recipientName: z.string(),
        recipientEmail: z.email().optional(),
        itemName: z.string(),
        itemDescription: z.string(),
        amount,
        currency,
        note: z.string().optional(),
        reference: z.string(),
        requestId,
      },
      annotations: WRITE,
    },
    (args) => run(() => paypal.createReceiptInvoice(args)),
  );

  return server;
}

/** Wrap a PayPal call as an MCP result: JSON text + structuredContent, errors as isError results. */
async function run<T>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err) {
    const payload =
      err instanceof PayPalApiError
        ? { error: err.code, message: err.message, status: err.status, debugId: err.debugId }
        : { error: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
    return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
}
