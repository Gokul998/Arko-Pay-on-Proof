import type { Request } from "express";
import type { Party } from "@arko/shared";
import type { AccessKeys, DealKey } from "../application/access-keys.ts";
import { AppError } from "../domain/errors.ts";

/**
 * Request authentication via deal capability keys.
 *  - `X-Arko-Key`:  the key for the role the user is acting as (required for any change)
 *  - `X-Arko-Keys`: all keys the browser holds (comma-separated) — used to list deals
 */
export class KeyAuth {
  constructor(private readonly keys: AccessKeys) {}

  /** All valid deal keys presented with the request. */
  all(req: Request): DealKey[] {
    const raw = [req.header("x-arko-key"), ...(req.header("x-arko-keys") ?? "").split(",")];
    const seen = new Set<string>();
    return raw
      .map((k) => this.keys.verify(k))
      .filter((k): k is DealKey => k !== null)
      .filter((k) => {
        const id = `${k.dealId}:${k.party}`;
        return seen.has(id) ? false : (seen.add(id), true);
      });
  }

  dealIds(req: Request): Set<string> {
    return new Set(this.all(req).map((k) => k.dealId));
  }

  /** The acting party for a deal, from the X-Arko-Key header. */
  actor(req: Request, dealId: string): Party {
    const key = this.keys.verify(req.header("x-arko-key"));
    if (!key) throw new AppError("UNAUTHORIZED", "Missing or invalid deal key. Open the deal from your invite link.", 401);
    if (key.dealId !== dealId) throw new AppError("FORBIDDEN", "This key belongs to a different deal", 403);
    return key.party;
  }

  /** Read access: any valid key for the deal. */
  canRead(req: Request, dealId: string): void {
    if (!this.dealIds(req).has(dealId)) throw new AppError("NOT_FOUND", `Deal ${dealId} was not found`, 404);
  }
}
