import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { PayPalClient } from "@arko/paypal-client";
import { createPayPalMcpServer, PayPalTools, type PayPalToolName } from "@arko/paypal-mcp";
import { upstream } from "../../domain/errors.ts";
import type { PaymentsGateway } from "../../application/ports.ts";

/**
 * PaymentsGateway implemented as an MCP *client* of the Arko PayPal MCP server.
 * Every PayPal call the app makes goes through the same MCP tools an external agent
 * (e.g. Claude Desktop) would use — one audited surface for money movement.
 */
export class McpPaymentsGateway implements PaymentsGateway {
  private constructor(private readonly client: Client) {}

  static async connect(paypal: PayPalClient): Promise<McpPaymentsGateway> {
    const server = createPayPalMcpServer(paypal);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "arko-api", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return new McpPaymentsGateway(client);
  }

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  createHold: PaymentsGateway["createHold"] = (input) => this.call(PayPalTools.createHold, input);
  getOrder: PaymentsGateway["getOrder"] = (orderId) => this.call(PayPalTools.getOrder, { orderId });
  authorizeOrder: PaymentsGateway["authorizeOrder"] = (orderId, requestId) =>
    this.call(PayPalTools.authorizeOrder, { orderId, requestId });
  getAuthorization: PaymentsGateway["getAuthorization"] = (authorizationId) =>
    this.call(PayPalTools.getAuthorization, { authorizationId });
  capture: PaymentsGateway["capture"] = (input) => this.call(PayPalTools.captureAuthorization, input);
  void: PaymentsGateway["void"] = (authorizationId, requestId) =>
    this.call(PayPalTools.voidAuthorization, { authorizationId, requestId });
  reauthorize: PaymentsGateway["reauthorize"] = ({ authorizationId, ...input }) =>
    this.call(PayPalTools.reauthorize, { authorizationId, ...input });
  refund: PaymentsGateway["refund"] = (input) => this.call(PayPalTools.refundCapture, input);
  receipt: PaymentsGateway["receipt"] = (input) => this.call(PayPalTools.createReceiptInvoice, input);

  private async call<T>(name: PayPalToolName, args: object): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args as Record<string, unknown> });
    if (result.isError) {
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
      let detail: { error?: string; message?: string; debugId?: string } = {};
      try {
        detail = JSON.parse(text);
      } catch {
        detail = { message: text };
      }
      throw upstream("PayPal", `${detail.error ?? "ERROR"} — ${detail.message ?? "request failed"}`, detail);
    }
    return result.structuredContent as T;
  }
}
