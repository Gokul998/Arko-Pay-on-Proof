#!/usr/bin/env -S npx tsx
/**
 * Standalone entry point: run the PayPal MCP server over stdio.
 * Used by Claude Desktop or any MCP client (see README → "Use with Claude Desktop").
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PayPalClient } from "@arko/paypal-client";
import { createPayPalMcpServer } from "./server.ts";

const paypal = new PayPalClient({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  environment: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
});

const server = createPayPalMcpServer(paypal);
await server.connect(new StdioServerTransport());
// stdout is the protocol channel — log to stderr only.
console.error("arko-paypal MCP server running on stdio");
