export interface PayPalIssue {
  issue?: string;
  description?: string;
  field?: string;
}

/** A non-2xx response from PayPal, with the debug id needed for PayPal support. */
export class PayPalApiError extends Error {
  override readonly name = "PayPalApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly debugId: string | undefined,
    readonly details: PayPalIssue[] = [],
  ) {
    super(message);
  }

  /** True when retrying the same request may succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class PayPalConfigError extends Error {
  override readonly name = "PayPalConfigError";
}
