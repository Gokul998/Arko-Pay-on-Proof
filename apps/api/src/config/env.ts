import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_CLIENT_SECRET: z.string().default(""),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  ANTHROPIC_API_KEY: z.string().default(""),
  ARKO_MODEL: z.string().default("claude-opus-5-5"),
  MAX_ACTION_AMOUNT: z.coerce.number().positive().default(5000),
  DATA_DIR: z.string().default("./data"),
  /** Signs party access keys. Required in production; generated per data dir in development. */
  APP_SECRET: z.string().default(""),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // In production (e.g. Render) the platform's PORT wins. In development the API always uses
  // API_PORT (default 8787) so a PORT meant for the Vite dev server can't collide with it.
  const port = source.NODE_ENV === "production" ? source.PORT : (source.API_PORT ?? "8787");
  const parsed = EnvSchema.safeParse({ ...source, PORT: port });
  if (parsed.success && parsed.data.NODE_ENV === "production" && parsed.data.APP_SECRET.length < 32) {
    throw new Error("APP_SECRET (32+ chars) is required in production");
  }
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
