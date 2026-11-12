import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Party } from "@arko/shared";

export interface DealKey {
  dealId: string;
  party: Party;
}

/**
 * Capability keys: each party of a deal gets an HMAC-signed key (shareable as an invite link).
 * The server derives *who is acting* from the key — never from a client-supplied role —
 * so a freelancer can't approve the client's release by flipping a field.
 */
export class AccessKeys {
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  }

  issue(dealId: string, party: Party): string {
    const payload = Buffer.from(JSON.stringify({ d: dealId, p: party, n: randomBytes(6).toString("base64url") })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verify(key: string | undefined): DealKey | null {
    if (!key) return null;
    const [payload, sig] = key.trim().split(".");
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { d, p } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d: string; p: Party };
      return p === "client" || p === "freelancer" ? { dealId: d, party: p } : null;
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}
