import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { Container } from "../config/container.ts";
import { AppError } from "../domain/errors.ts";
import { errorMiddleware, requestLogger, securityHeaders } from "./middleware.ts";
import { apiRouter } from "./routes.ts";

export function createApp(c: Container, webDist?: string) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Render's proxy — correct client IPs for rate limiting
  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(express.json({ limit: "20mb" }));

  app.use("/api", apiRouter(c));
  app.use("/api", (_req, _res, next) => next(new AppError("NOT_FOUND", "No such API route", 404)));

  // Production: serve the built React app (single origin, so PayPal can redirect back to it).
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(webDist, "index.html")));
  }

  app.use(errorMiddleware);
  return app;
}
