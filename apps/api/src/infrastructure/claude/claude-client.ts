import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { upstream } from "../../domain/errors.ts";

export type Effort = "low" | "medium" | "high";

/** Server-side refusal fallback: if the primary model declines, the API retries on a fallback model. */
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

/** Thin wrapper for structured (schema-validated) Claude calls used by the specialised agents. */
export class ClaudeStructured {
  constructor(
    readonly client: Anthropic,
    readonly model: string,
  ) {}

  async parse<S extends z.ZodType>(opts: {
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: S;
    effort: Effort;
    maxTokens?: number;
  }): Promise<z.infer<S>> {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: opts.maxTokens ?? 16000,
        system: opts.system,
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
        messages: [{ role: "user", content: opts.content }],
        ...FALLBACK,
      });
      if (res.stop_reason === "refusal") throw upstream("Claude", "the model declined this request");
      if (res.parsed_output == null) throw upstream("Claude", `no structured output (stop: ${res.stop_reason})`);
      return res.parsed_output as z.infer<S>;
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw upstream("Claude", `${err.status ?? ""} ${err.message}`.trim());
      throw err;
    }
  }
}
