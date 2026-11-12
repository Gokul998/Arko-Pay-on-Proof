import type { MilestoneStatus } from "@arko/shared";

export { formatMoney } from "@arko/shared";

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export const STATUS_META: Record<MilestoneStatus, { label: string; tone: string }> = {
  awaiting_funding: { label: "Awaiting funding", tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  funding_pending: { label: "Approving in PayPal", tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  funded: { label: "Held by PayPal", tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300" },
  submitted: { label: "Proof submitted", tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  verified: { label: "AI verified", tone: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  disputed: { label: "In dispute", tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  mediated: { label: "Split proposed", tone: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300" },
  released: { label: "Paid", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  settled: { label: "Settled by split", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  cancelled: { label: "Cancelled · refunded", tone: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300" },
};

/** Progress steps shown on each milestone. */
export const STEPS = ["Agreed", "Held", "Proof", "Verified", "Paid"] as const;
export const stepIndex = (s: MilestoneStatus): number =>
  ({
    awaiting_funding: 0,
    funding_pending: 0,
    funded: 1,
    submitted: 2,
    verified: 3,
    disputed: 3,
    mediated: 3,
    released: 4,
    settled: 4,
    cancelled: 4,
  })[s];
