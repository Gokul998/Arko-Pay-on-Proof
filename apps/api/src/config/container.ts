import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PayPalClient } from "@arko/paypal-client";
import { DealService } from "../application/deal-service.ts";
import type { PaymentsGateway } from "../application/ports.ts";
import { notConfigured } from "../domain/errors.ts";
import { ClaudeContractAgent, ClaudeMediatorAgent, ClaudePlanReviewAgent, ClaudeVerifierAgent } from "../infrastructure/claude/agents.ts";
import { AccessKeys } from "../application/access-keys.ts";
import { readSourceDocument } from "../infrastructure/documents/sow-reader.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ChatAgent } from "../infrastructure/claude/chat-agent.ts";
import { ClaudeStructured, type StructuredLlm } from "../infrastructure/claude/claude-client.ts";
import { createGemini, GeminiChatAgent, GeminiStructured } from "../infrastructure/gemini/gemini.ts";
import { McpPaymentsGateway } from "../infrastructure/mcp/mcp-payments-gateway.ts";
import {
  openDatabase,
  SqliteActionRepository,
  SqliteAuditLog,
  SqliteDealRepository,
} from "../infrastructure/persistence/sqlite.ts";
import { FileProofStore } from "../infrastructure/storage/file-proof-store.ts";
import type { Env } from "./env.ts";

export interface Container {
  env: Env;
  deals: DealService;
  keys: AccessKeys;
  chat: () => Pick<ChatAgent, "run">;
  ai: { provider: "anthropic" | "gemini"; model: string } | null;
  audit: SqliteAuditLog;
  payments: () => PaymentsGateway;
  mcpTools: () => Promise<Array<{ name: string; title?: string; annotations?: unknown }>>;
}

/**
 * Composition root: the only place that knows concrete implementations.
 * PayPal and Claude are optional at boot so the UI still loads and explains what is missing.
 */
export async function buildContainer(env: Env): Promise<Container> {
  const db = openDatabase(join(env.DATA_DIR, "arko.db"));
  const audit = new SqliteAuditLog(db);

  const gateway = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
    ? await McpPaymentsGateway.connect(
        new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, environment: env.PAYPAL_ENV }),
      )
    : undefined;
  const payments = () => gateway ?? fail("PayPal");

  // AI provider: Claude (default) or Gemini, behind the same StructuredLlm / chat interfaces.
  const provider = aiProvider(env);
  const anthropic = provider === "anthropic" ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : undefined;
  const gemini = provider === "gemini" ? createGemini(env.GEMINI_API_KEY) : undefined;
  const structured: StructuredLlm | undefined = anthropic
    ? new ClaudeStructured(anthropic, env.ARKO_MODEL)
    : gemini
      ? new GeminiStructured(gemini, env.GEMINI_MODEL)
      : undefined;
  const claude = () => structured ?? fail("AI agents (set ANTHROPIC_API_KEY or GEMINI_API_KEY)");

  const deals = new DealService({
    deals: new SqliteDealRepository(db),
    actions: new SqliteActionRepository(db),
    audit,
    proofs: new FileProofStore(join(env.DATA_DIR, "proofs")),
    payments,
    contract: () => new ClaudeContractAgent(claude()),
    verifier: () => new ClaudeVerifierAgent(claude()),
    mediator: () => new ClaudeMediatorAgent(claude()),
    planReviewer: () => new ClaudePlanReviewAgent(claude()),
    readDocument: readSourceDocument,
    publicUrl: env.PUBLIC_URL.replace(/\/$/, ""),
    maxActionAmount: env.MAX_ACTION_AMOUNT,
  });

  return {
    env,
    deals,
    keys: new AccessKeys(env.APP_SECRET || persistentSecret(env.DATA_DIR)),
    audit,
    payments,
    chat: () => {
      if (anthropic) return new ChatAgent(anthropic, env.ARKO_MODEL, deals);
      if (gemini) return new GeminiChatAgent(gemini, env.GEMINI_MODEL, new ChatAgent(null, env.GEMINI_MODEL, deals));
      return fail("AI agents (set ANTHROPIC_API_KEY or GEMINI_API_KEY)");
    },
    ai: provider === "none" ? null : { provider, model: provider === "anthropic" ? env.ARKO_MODEL : env.GEMINI_MODEL },
    mcpTools: async () => (gateway ? gateway.listTools() : []),
  };
}

function aiProvider(env: Env): "anthropic" | "gemini" | "none" {
  if (env.AI_PROVIDER === "anthropic") return env.ANTHROPIC_API_KEY ? "anthropic" : "none";
  if (env.AI_PROVIDER === "gemini") return env.GEMINI_API_KEY ? "gemini" : "none";
  return env.ANTHROPIC_API_KEY ? "anthropic" : env.GEMINI_API_KEY ? "gemini" : "none";
}

/** Dev convenience: generate one signing secret per data directory so keys survive restarts. */
function persistentSecret(dir: string): string {
  const file = join(dir, ".app-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function fail(what: string): never {
  throw notConfigured(what);
}
