import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ApiErrorBody } from "@arko/shared";
import { AppError } from "../domain/errors.ts";

/** Parse and validate a request body; failures become 400 with field details. */
export function body<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", z.prettifyError(parsed.error), 400, parsed.error.issues);
  }
  return parsed.data;
}

/** Wrap an async handler so rejections reach the error middleware. */
export const handler =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res))
      .then((result) => {
        if (!res.headersSent && result !== undefined) res.json(result);
      })
      .catch(next);
  };

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const appErr =
    err instanceof AppError
      ? err
      : err instanceof SyntaxError
        ? new AppError("BAD_JSON", "Request body is not valid JSON", 400)
        : new AppError("INTERNAL", "Something went wrong", 500);
  if (appErr.status >= 500) console.error("[api]", err);
  const payload: ApiErrorBody = { error: { code: appErr.code, message: appErr.message, details: appErr.details } };
  if (res.headersSent) return res.end();
  res.status(appErr.status).json(payload);
}

/** Structured access log with a request id (echoed as X-Request-Id for support/debugging). */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const id = req.header("x-request-id") ?? randomUUID();
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    if (req.path.startsWith("/api")) {
      console.log(JSON.stringify({ t: new Date().toISOString(), id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
    }
  });
  next();
}

/** Baseline security headers (no external dependency). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  next();
}

/** Fixed-window, per-IP rate limiter for expensive endpoints (AI calls). In-memory: fine for one instance. */
export function rateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + opts.windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((entry.reset - now) / 1000));
      return next(new AppError("RATE_LIMITED", "Too many requests — please wait a moment", 429));
    }
    next();
  };
}
