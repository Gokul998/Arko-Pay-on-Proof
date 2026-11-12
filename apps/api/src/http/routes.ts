import { Router } from "express";
import { z } from "zod";
import {
  AcceptTermsRequest,
  ActionKind,
  ChatRequest,
  CreateDealRequest,
  DecideExtensionRequest,
  DisputeRequest,
  ExtensionRequestBody,
  SubmitProofRequest,
  UpdatePlanRequest,
  type ChatEvent,
  type CreatedDeal,
  type HealthStatus,
} from "@arko/shared";
import type { Container } from "../config/container.ts";
import { AppError } from "../domain/errors.ts";
import { KeyAuth } from "./auth.ts";
import { body, handler, rateLimit } from "./middleware.ts";

const ProposeActionRequest = z.object({
  kind: ActionKind,
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  reason: z.string().max(300).optional(),
});

export function apiRouter(c: Container): Router {
  const r = Router();
  const { deals } = c;
  const auth = new KeyAuth(c.keys);
  const aiLimit = rateLimit({ windowMs: 60_000, max: 20 });
  const p = (v: string | string[] | undefined) => String(v);

  r.get("/health", handler(async (): Promise<HealthStatus & { mcpTools: unknown; aiProvider: string | null }> => {
    const tools = await c.mcpTools().catch(() => []);
    return {
      ok: true,
      paypal: c.env.PAYPAL_CLIENT_ID ? "configured" : "missing",
      claude: c.ai ? "configured" : "missing",
      aiProvider: c.ai?.provider ?? null,
      model: c.ai?.model ?? "",
      environment: c.env.PAYPAL_ENV,
      mcpTools: tools.map((t) => ({ name: t.name, title: t.title, annotations: t.annotations })),
    };
  }));

  /* ── Deals ── */
  r.get("/deals", handler((req) => {
    const ids = auth.dealIds(req);
    return deals.list().filter((d) => ids.has(d.id));
  }));

  r.post("/deals", aiLimit, handler(async (req, res) => {
    const deal = await deals.createDeal(body(CreateDealRequest, req));
    const created: CreatedDeal = { deal, keys: { client: c.keys.issue(deal.id, "client"), freelancer: c.keys.issue(deal.id, "freelancer") } };
    res.status(201).json(created);
  }));

  r.get("/deals/:dealId", handler((req) => {
    auth.canRead(req, p(req.params.dealId));
    return deals.get(p(req.params.dealId));
  }));

  r.get("/deals/:dealId/activity", handler((req) => {
    auth.canRead(req, p(req.params.dealId));
    return c.audit.list(p(req.params.dealId));
  }));

  /* ── Negotiation ── */
  r.put("/deals/:dealId/plan", handler((req) => {
    const dealId = p(req.params.dealId);
    return deals.updatePlan(dealId, auth.actor(req, dealId), body(UpdatePlanRequest, req));
  }));
  r.post("/deals/:dealId/plan/review", aiLimit, handler((req) => {
    const dealId = p(req.params.dealId);
    auth.actor(req, dealId);
    return deals.reviewPlan(dealId);
  }));
  r.post("/deals/:dealId/accept", handler((req) => {
    const dealId = p(req.params.dealId);
    return deals.acceptTerms(dealId, auth.actor(req, dealId), body(AcceptTermsRequest, req).version);
  }));

  /* ── Milestones ── */
  const ms = "/deals/:dealId/milestones/:milestoneId";
  const ids = (req: { params: Record<string, string | string[] | undefined> }) => [p(req.params.dealId), p(req.params.milestoneId)] as const;

  r.post(`${ms}/fund`, handler((req) => {
    const [d, m] = ids(req);
    if (auth.actor(req, d) !== "client") throw new AppError("FORBIDDEN", "Only the client can fund a milestone", 403);
    return deals.fund(d, m);
  }));
  r.post(`${ms}/confirm-funding`, handler((req) => {
    const [d, m] = ids(req);
    auth.actor(req, d);
    return deals.confirmFunding(d, m);
  }));
  r.post(`${ms}/cancel-funding`, handler((req) => {
    const [d, m] = ids(req);
    auth.actor(req, d);
    return deals.cancelFunding(d, m);
  }));
  r.post(`${ms}/renew-hold`, handler((req) => {
    const [d, m] = ids(req);
    if (auth.actor(req, d) !== "client") throw new AppError("FORBIDDEN", "Only the client can renew the hold", 403);
    return deals.renewHold(d, m);
  }));
  r.post(`${ms}/proofs`, handler((req) => {
    const [d, m] = ids(req);
    if (auth.actor(req, d) !== "freelancer") throw new AppError("FORBIDDEN", "Only the freelancer can submit proof of work", 403);
    return deals.submitProof(d, m, body(SubmitProofRequest, req));
  }));
  r.post(`${ms}/verify`, aiLimit, handler((req) => {
    const [d, m] = ids(req);
    auth.actor(req, d);
    return deals.verify(d, m);
  }));
  r.post(`${ms}/extensions`, handler((req) => {
    const [d, m] = ids(req);
    return deals.requestExtension(d, m, auth.actor(req, d), body(ExtensionRequestBody, req));
  }));
  r.post(`${ms}/extensions/:extId/decide`, handler((req) => {
    const [d, m] = ids(req);
    const { approve, note } = body(DecideExtensionRequest, req);
    return deals.decideExtension(d, m, p(req.params.extId), auth.actor(req, d), approve, note);
  }));
  r.post(`${ms}/dispute`, handler((req) => {
    const [d, m] = ids(req);
    return deals.dispute(d, m, auth.actor(req, d), body(DisputeRequest, req).statement);
  }));
  r.post(`${ms}/mediate`, aiLimit, handler((req) => {
    const [d, m] = ids(req);
    auth.actor(req, d);
    return deals.mediate(d, m);
  }));
  r.post(`${ms}/mediation/accept`, handler((req) => {
    const [d, m] = ids(req);
    return deals.acceptMediation(d, m, auth.actor(req, d));
  }));
  r.get(`${ms}/hold`, handler((req) => {
    const [d, m] = ids(req);
    auth.canRead(req, d);
    return deals.holdStatus(d, m);
  }));
  r.post(`${ms}/actions`, handler((req, res) => {
    const [d, m] = ids(req);
    auth.actor(req, d);
    const action = deals.proposeAction({ ...body(ProposeActionRequest, req), dealId: d, milestoneId: m, requestedBy: "user" });
    res.status(201).json(action);
  }));

  /* ── Approval gate ── */
  r.get("/actions", handler((req) => {
    const allowed = auth.dealIds(req);
    const status = req.query.status === "pending" ? "pending" : undefined;
    return deals.listActions({ status }).filter((a) => allowed.has(a.dealId));
  }));
  const decide = (approve: boolean) =>
    handler(async (req) => {
      const action = deals.listActions().find((a) => a.id === p(req.params.actionId));
      if (!action) throw new AppError("NOT_FOUND", "Action not found", 404);
      const party = auth.actor(req, action.dealId);
      return approve ? deals.approveAction(action.id, party) : deals.rejectAction(action.id, party);
    });
  r.post("/actions/:actionId/approve", decide(true));
  r.post("/actions/:actionId/reject", decide(false));

  /* ── Activity ── */
  r.get("/activity", handler((req) => {
    const allowed = auth.dealIds(req);
    return c.audit.list().filter((e) => e.dealId && allowed.has(e.dealId));
  }));

  /* ── Arko chat (Server-Sent Events) ── */
  r.post("/chat", aiLimit, handler(async (req, res) => {
    const input = body(ChatRequest, req);
    const keys = auth.all(req);
    if (input.dealId && !keys.some((k) => k.dealId === input.dealId && k.party === input.party)) {
      throw new AppError("FORBIDDEN", `You don't hold the ${input.party} key for this deal`, 403);
    }
    const scope = { party: input.party, dealIds: new Set(keys.filter((k) => k.party === input.party).map((k) => k.dealId)) };
    const agent = c.chat(); // 503 before streaming if Claude is not configured
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const send = (e: ChatEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await agent.run(input, scope, send, abort.signal);
      send({ type: "done" });
    } catch (err) {
      if (!abort.signal.aborted) {
        send({ type: "error", message: err instanceof AppError ? err.message : "Arko hit an unexpected error" });
        if (!(err instanceof AppError)) console.error("[chat]", err);
      }
    } finally {
      res.end();
    }
  }));

  return r;
}
