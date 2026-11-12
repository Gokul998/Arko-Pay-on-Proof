import { useState } from "react";
import { CalendarClock, Check, RotateCcw, X } from "lucide-react";
import { addDays, milestoneHealth, type Deal, type Milestone } from "@arko/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.tsx";
import { Button } from "../../components/ui.tsx";

/** Due-date changes after agreement: one party requests, the other decides — within the agreed limit. */
export function ExtensionPanel({ deal, m }: { deal: Deal; m: Milestone }) {
  const { party, run, busy, upsertDeal } = useStore();
  const h = milestoneHealth(m, deal.terms);
  const pending = h.pendingExtension;
  const [open, setOpen] = useState(false);
  const base = m.dueDate ?? new Date().toISOString().slice(0, 10);
  const [toDate, setToDate] = useState(addDays(base, Math.min(7, deal.terms.maxExtensionDays || 7)));
  const [reason, setReason] = useState("");
  const k = (s: string) => `${s}-${m.id}`;
  const history = m.extensions.filter((e) => e.status !== "pending");

  return (
    <div className="space-y-2">
      {pending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 font-semibold">
            <CalendarClock className="size-4 text-amber-600" /> Extension requested by the {pending.requestedBy}
          </div>
          <p className="mt-1">
            Move due date <b>{pending.fromDate ?? "—"}</b> → <b>{pending.toDate}</b>. “{pending.reason}”
          </p>
          {pending.requestedBy !== party ? (
            <div className="mt-2 flex gap-2">
              <Button variant="success" className="px-3 py-1.5" busy={busy[k("ext-yes")]} onClick={() => run(k("ext-yes"), () => api.decideExtension(deal.id, m.id, pending.id, true), "New due date agreed").then((d) => d && upsertDeal(d))}>
                <Check className="size-4" /> Approve new date
              </Button>
              <Button variant="ghost" className="px-3 py-1.5" busy={busy[k("ext-no")]} onClick={() => run(k("ext-no"), () => api.decideExtension(deal.id, m.id, pending.id, false), "Extension declined").then((d) => d && upsertDeal(d))}>
                <X className="size-4" /> Decline
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Waiting for the {pending.requestedBy === "client" ? "freelancer" : "client"} to decide.</p>
          )}
        </div>
      )}

      {!pending && (
        <>
          {!open ? (
            <button className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline" onClick={() => setOpen(true)}>
              <CalendarClock className="size-4" /> Request a due-date extension
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                <div>
                  <label className="label">New due date</label>
                  <input type="date" className="input" min={addDays(base, 1)} max={addDays(base, deal.terms.maxExtensionDays)} value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Reason</label>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waiting on brand assets from the client" />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Agreed terms allow up to {deal.terms.maxExtensionDays} days per extension. The other party must approve.
                {m.paypal.holdExpiresAt && toDate > m.paypal.holdExpiresAt && " This goes past the PayPal hold expiry — the client will need to renew the hold."}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  busy={busy[k("ext")]}
                  disabled={reason.trim().length < 5}
                  onClick={() =>
                    run(k("ext"), () => api.requestExtension(deal.id, m.id, { toDate, reason }), "Extension requested").then((d) => {
                      if (d) {
                        upsertDeal(d);
                        setOpen(false);
                        setReason("");
                      }
                    })
                  }
                >
                  Send request
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {h.holdNeedsRenewal && party === "client" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
          <RotateCcw className="size-4 text-sky-600" /> The PayPal hold expires {m.paypal.holdExpiresAt}, before the new due date.
          <Button variant="paypal" className="px-3 py-1.5" busy={busy[k("renew")]} onClick={() => run(k("renew"), () => api.renewHold(deal.id, m.id), "Hold renewed with PayPal").then((d) => d && upsertDeal(d))}>
            Renew hold
          </Button>
        </div>
      )}

      {history.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-500">
          {history.map((e) => (
            <li key={e.id}>
              {e.status === "approved" ? "✓" : "✕"} {e.requestedBy} asked {e.fromDate ?? "—"} → {e.toDate} · {e.status} by {e.decidedBy}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
