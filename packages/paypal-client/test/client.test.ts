import { describe, expect, it, vi } from "vitest";
import { PayPalApiError, PayPalClient } from "../src/index.ts";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    const next = queue.shift();
    if (!next) throw new Error("unexpected request " + String(url));
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const make = (f: typeof fetch) =>
  new PayPalClient({ clientId: "id", clientSecret: "secret", fetch: f, retryDelayMs: 1 });

describe("PayPalClient", () => {
  it("creates an AUTHORIZE order and returns the payer approval link", async () => {
    const { fn, calls } = mockFetch([
      {
        status: 201,
        body: {
          id: "ORDER1",
          status: "PAYER_ACTION_REQUIRED",
          links: [{ rel: "payer-action", href: "https://sandbox.paypal.com/checkoutnow?token=ORDER1" }],
        },
      },
    ]);
    const hold = await make(fn).createHold({
      amount: "450.00",
      currency: "USD",
      description: "Logo design",
      referenceId: "ms_1",
      returnUrl: "http://localhost/return",
      cancelUrl: "http://localhost/cancel",
      requestId: "hold-ms_1",
    });

    expect(hold).toEqual({
      orderId: "ORDER1",
      status: "PAYER_ACTION_REQUIRED",
      approveUrl: "https://sandbox.paypal.com/checkoutnow?token=ORDER1",
    });
    const orderCall = calls[1]!;
    const body = JSON.parse(String(orderCall.init.body));
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "450.00" });
    expect((orderCall.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("hold-ms_1");
  });

  it("captures a partial amount with final_capture to settle a split", async () => {
    const { fn, calls } = mockFetch([
      { status: 201, body: { id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "270.00" } } },
    ]);
    const capture = await make(fn).captureAuthorization("AUTH1", {
      amount: "270.00",
      currency: "USD",
      finalCapture: true,
      requestId: "split-ms_1",
    });
    expect(capture.captureId).toBe("CAP1");
    expect(calls[1]!.url).toContain("/v2/payments/authorizations/AUTH1/capture");
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      final_capture: true,
      amount: { value: "270.00" },
    });
  });

  it("retries 5xx with the same idempotency key, then succeeds", async () => {
    const { fn, calls } = mockFetch([
      { status: 503, body: { name: "SERVICE_UNAVAILABLE" } },
      { status: 201, body: { id: "CAP2", status: "COMPLETED" } },
    ]);
    await make(fn).captureAuthorization("AUTH2", { currency: "USD", finalCapture: true, requestId: "rel-1" });
    const writes = calls.filter((c) => c.url.includes("/capture"));
    expect(writes).toHaveLength(2);
    for (const w of writes) expect((w.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("rel-1");
  });

  it("maps PayPal errors to PayPalApiError with issue code and debug id", async () => {
    const { fn } = mockFetch([
      {
        status: 422,
        headers: { "paypal-debug-id": "dbg123" },
        body: {
          name: "UNPROCESSABLE_ENTITY",
          details: [{ issue: "AUTHORIZATION_ALREADY_CAPTURED", description: "Already captured." }],
        },
      },
    ]);
    const err = await make(fn)
      .captureAuthorization("AUTH3", { currency: "USD", finalCapture: true, requestId: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, code: "AUTHORIZATION_ALREADY_CAPTURED", debugId: "dbg123" });
  });

  it("caches the OAuth token across requests", async () => {
    const { fn, calls } = mockFetch([
      { status: 200, body: { id: "O1", status: "APPROVED" } },
      { status: 200, body: { id: "O2", status: "APPROVED" } },
    ]);
    const client = make(fn);
    await client.getOrder("O1");
    await client.getOrder("O2");
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });
});
