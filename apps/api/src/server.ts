import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnv } from "./config/env.ts";
import { buildContainer } from "./config/container.ts";
import { createApp } from "./http/app.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const container = await buildContainer(env);
const app = createApp(container, resolve(here, "../../web/dist"));

app.listen(env.PORT, () => {
  console.log(`Arko API listening on http://localhost:${env.PORT}`);
  console.log(`  PayPal: ${env.PAYPAL_CLIENT_ID ? env.PAYPAL_ENV : "NOT CONFIGURED"} · AI: ${container.ai ? `${container.ai.provider} (${container.ai.model})` : "NOT CONFIGURED"}`);
});
