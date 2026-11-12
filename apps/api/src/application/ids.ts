import { randomBytes } from "node:crypto";

/** Short, URL-safe, prefixed ids (e.g. deal_k3j9x2m1q8). */
export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url").toLowerCase()}`;
