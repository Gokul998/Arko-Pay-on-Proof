import { GoogleGenAI, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ChatEvent, ChatRequest } from "@arko/shared";
import { upstream } from "../../domain/errors.ts";
import type { Effort, StructuredLlm } from "../claude/claude-client.ts";
export type { Effort };
import { Inputs, TOOL_DEFS, type ChatAgent, type ChatScope, type ToolName } from "../claude/chat-agent.ts";

/** Convert provider-neutral content blocks (text / base64 image / base64 PDF) into Gemini parts. */
function toParts(blocks: Anthropic.Beta.BetaContentBlockParam[]): Part[] {
  return blocks.flatMap((b): Part[] => {
    if (b.type === "text") return [{ text: b.text }];
    if ((b.type === "image" || b.type === "document") && b.source.type === "base64") {
      return [{ inlineData: { mimeType: b.source.media_type, data: b.source.data } }];
    }
    return [];
  });
}

/**
 * Call Gemini with a model fallback chain (GEMINI_MODEL may be a comma-separated list):
 * on overload / quota / retired-model errors, move on to the next model.
 */
async function generate(ai: GoogleGenAI, models: string[], params: Omit<GenerateContentParameters, "model">): Promise<GenerateContentResponse> {
  let last: unknown;
  for (const model of models) {
    try {
      return await ai.models.generateContent({ ...params, model });
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/"code":\s*(429|500|503|404)|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND/.test(msg)) break;
    }
  }
  throw upstream("Gemini", last instanceof Error ? last.message.slice(0, 300) : String(last));
}

const modelList = (m: string) => m.split(",").map((x) => x.trim()).filter(Boolean);

/** Gemini adapter for the structured agents (Contract, Plan Reviewer, Verifier, Mediator). */
export class GeminiStructured implements StructuredLlm {
  constructor(
    private readonly ai: GoogleGenAI,
    readonly model: string,
  ) {}

  async parse<S extends z.ZodType>(opts: {
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: S;
    effort: Effort;
    maxTokens?: number;
  }): Promise<z.infer<S>> {
    const jsonSchema = z.toJSONSchema(opts.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const res = await generate(this.ai, modelList(this.model), {
      contents: [{ role: "user", parts: toParts(opts.content) }],
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        maxOutputTokens: opts.maxTokens ?? 16000,
      },
    });
    const text = res.text;
    if (!text) throw upstream("Gemini", "empty response");
    const parsed = opts.schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw upstream("Gemini", `response did not match the expected schema: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }
}

const MAX_TURNS = 8;

/** Arko chat on Gemini: same tools, scope and approval rules as the Claude chat agent. */
export class GeminiChatAgent {
  constructor(
    private readonly ai: GoogleGenAI,
    private readonly model: string,
    private readonly tools: ChatAgent,
  ) {}

  async run(req: ChatRequest, scope: ChatScope, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const contents: Content[] = [
      ...req.history.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
      { role: "user", parts: [{ text: req.message }] },
    ];
    const functionDeclarations = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) return;
      const res = await generate(this.ai, modelList(this.model), {
        contents,
        config: { systemInstruction: this.tools.systemPrompt(req), tools: [{ functionDeclarations }] },
      });
      const calls = res.functionCalls ?? [];
      if (calls.length === 0) {
        emit({ type: "text", delta: res.text ?? "" });
        return;
      }
      const modelContent = res.candidates?.[0]?.content;
      if (modelContent) contents.push(modelContent);
      const responses: Part[] = [];
      for (const call of calls) {
        const name = call.name as ToolName;
        const id = call.id ?? `${name}-${turn}`;
        const parsed = Inputs[name]?.safeParse(call.args ?? {});
        if (!parsed?.success) {
          responses.push({ functionResponse: { id: call.id, name: call.name, response: { error: `Invalid input for ${call.name}` } } });
          continue;
        }
        emit({ type: "tool", id, name, status: "running" });
        try {
          const dealId = (parsed.data as { dealId?: string }).dealId;
          if (dealId && !scope.dealIds.has(dealId)) throw new Error(`No access to deal ${dealId}`);
          const out = await this.tools.execute(name, parsed.data, scope, emit);
          emit({ type: "tool", id, name, status: "done", summary: out.summary });
          responses.push({ functionResponse: { id: call.id, name: call.name, response: { result: out.data } } });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: "tool", id, name, status: "error", summary: message });
          responses.push({ functionResponse: { id: call.id, name: call.name, response: { error: message } } });
        }
      }
      contents.push({ role: "user", parts: responses });
    }
  }
}

export const createGemini = (apiKey: string) => new GoogleGenAI({ apiKey, httpOptions: { timeout: 90_000 } });
