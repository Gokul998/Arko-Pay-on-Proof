import type { ExtensionRequest, Milestone, MilestoneStatus, PaymentTerms } from "./schemas.ts";

/** Date helpers on ISO calendar dates (YYYY-MM-DD), UTC-based so server and browser agree. */
export const DAY_MS = 86_400_000;
export const dayValue = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
export const addDays = (iso: string, days: number) => new Date(dayValue(iso) + days * DAY_MS).toISOString().slice(0, 10);
export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((dayValue(b) - dayValue(a)) / DAY_MS);

const TERMINAL: MilestoneStatus[] = ["released", "settled", "cancelled"];
const day = dayValue;
const DAY = DAY_MS;
const isTerminal = (s: MilestoneStatus) => TERMINAL.includes(s);

export interface MilestoneHealth {
  overdue: boolean;
  daysLate: number;
  reviewDueAt: string | null;
  reviewOverdue: boolean;
  holdExpiresInDays: number | null;
  holdNeedsRenewal: boolean;
  pendingExtension: ExtensionRequest | null;
}

/** Derived scheduling signals for a milestone (used by the UI, chat agent and workflow map). */
export function milestoneHealth(m: Milestone, terms: PaymentTerms, now = today()): MilestoneHealth {
  const notDelivered = ["awaiting_funding", "funding_pending", "funded"].includes(m.status);
  const daysLate = m.dueDate && notDelivered ? Math.max(0, Math.round((day(now) - day(m.dueDate)) / DAY)) : 0;
  const reviewDueAt = m.submittedAt && ["submitted", "verified"].includes(m.status) ? addDays(m.submittedAt, terms.reviewWindowDays) : null;
  const holdExpiresInDays = m.paypal.holdExpiresAt && !isTerminal(m.status) ? Math.round((day(m.paypal.holdExpiresAt) - day(now)) / DAY) : null;
  return {
    overdue: daysLate > 0,
    daysLate,
    reviewDueAt,
    reviewOverdue: reviewDueAt ? day(now) > day(reviewDueAt) : false,
    holdExpiresInDays,
    holdNeedsRenewal: holdExpiresInDays !== null && m.dueDate !== null && m.paypal.holdExpiresAt !== undefined && day(m.dueDate) > day(m.paypal.holdExpiresAt),
    pendingExtension: m.extensions.find((e) => e.status === "pending") ?? null,
  };
}

