import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalClient } from "@arko/paypal-client";
import { createPayPalMcpServer, PayPalTools } from "../src/index.ts";

async function connect(fetchImpl: typeof fetch) {
  const paypal = new PayPalClient({ clientId: "id", clientSecret: "s", fetch: fetchImpl, retryDelayMs: 1 });
  const server = createPayPalMcpServer(paypal);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const fakeFetch = (async (url: URL | string) => {
  if (String(url).endsWith("/v1/oauth2/token"))
    return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
  if (String(url).includes("/v2/payments/authorizations/A1/void")) return new Response(null, { status: 204 });
  return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND", message: "nope" }), { status: 404 });
}) as typeof fetch;

describe("PayPal MCP server", () => {
  it("lists every tool with read-only / destructive annotations", async () => {
    const client = await connect(fakeFetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.values(PayPalTools).sort());
    const capture = tools.find((t) => t.name === PayPalTools.captureAuthorization)!;
    expect(capture.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === PayPalTools.getOrder)!.annotations?.readOnlyHint).toBe(true);
  });

  it("executes a tool and returns structured content", async () => {
    const client = await connect(fakeFetch);
    const res = await client.callTool({
      name: PayPalTools.voidAuthorization,
      arguments: { authorizationId: "A1", requestId: "void-1" },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ status: "VOIDED" });
  });

  it("surfaces PayPal failures as isError results instead of throwing", async () => {
    const client = await connect(fakeFetch);
    const res = await client.callTool({ name: PayPalTools.getOrder, arguments: { orderId: "missing" } });
    expect(res.isError).toBe(true);
  });
});
