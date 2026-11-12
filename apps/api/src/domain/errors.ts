/** Base error with an HTTP mapping. The HTTP layer turns these into { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string, id: string) => new AppError("NOT_FOUND", `${what} ${id} was not found`, 404);

export const invalidState = (message: string, details?: unknown) =>
  new AppError("INVALID_STATE", message, 409, details);

export const forbidden = (message: string) => new AppError("FORBIDDEN", message, 403);

export const notConfigured = (what: string) =>
  new AppError("NOT_CONFIGURED", `${what} is not configured. Add the keys to .env (see .env.example).`, 503);

/** A failure from PayPal or Claude, surfaced with the upstream code for debugging. */
export const upstream = (service: string, message: string, details?: unknown) =>
  new AppError("UPSTREAM_ERROR", `${service}: ${message}`, 502, details);
