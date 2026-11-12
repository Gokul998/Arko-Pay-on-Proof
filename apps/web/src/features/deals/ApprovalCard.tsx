import { Bot, CheckCircle2, ShieldAlert, ShieldCheck, User, XCircle } from "lucide-react";
import type { PendingAction } from "@arko/shared";
import { api } from "../../lib/api.ts";
import { formatMoney } from "../../lib/format.ts";
import { useStore } from "../../lib/store.tsx";
import { Button } from "../../components/ui.tsx";

const VERB = { release: "Release payment", split: "Execute split", cancel: "Cancel & return funds", refund: "Refund" } as const;

/** The human-in-the-loop gate: shows exactly what will move, the safety checks, and who must approve. */
export function ApprovalCard({ action, compact = false }: { action: PendingAction; compact?: boolean }) {
  const { party, setParty, run, busy, upsertDeal, refresh } = useStore();
  const approver = String(action.params.approver ?? "client");
  const canApprove = party === approver;
  const passed = action.checks.every((c) => c.passed);
  const settled = action.status !== "pending";

  const approve = async () => {
    const res = await run(`approve-${action.id}`, () => api.approve(action), "Done — PayPal confirmed the transaction");
    if (res) upsertDeal(res.deal);
    else void refresh();
  };
  const reject = async () => {
    await run(`reject-${action.id}`, () => api.reject(action), "Request rejected — nothing moved");
    void refresh();
  };

  return (
    <div className={`rounded-2xl border-2 ${passed ? "border-brand-500/40" : "border-amber-400/60"} bg-white p-4 dark:bg-slate-900`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {passed ? <ShieldCheck className="size-4 text-brand-600" /> : <ShieldAlert className="size-4 text-amber-500" />}
            Approval required · {VERB[action.kind]}
          </div>
          <p className="text-sm font-medium">{action.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold tabular-nums">{formatMoney(action.amount, action.currency)}</div>
          <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
            {action.requestedBy === "agent" ? <Bot className="size-3" /> : <User className="size-3" />}
            requested by {action.requestedBy === "agent" ? "Arko" : "user"}
          </div>
        </div>
      </div>

      {!compact && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {action.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-xs">
              {c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />}
              <span>
                <span className="font-medium">{c.name}</span>
                <span className="block text-slate-500">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        {settled ? (
          <span className="text-sm font-medium text-slate-500">This request was {action.status}.</span>
        ) : canApprove ? (
          <span className="text-xs text-slate-500">PayPal executes only after you approve. Uses an idempotency key, so it can never run twice.</span>
        ) : (
          <span className="text-xs text-slate-500">
            Waiting for the <b>{approver}</b> to approve.{" "}
            <button className="font-semibold text-brand-600 hover:underline" onClick={() => setParty(approver as "client" | "freelancer")}>
              Switch to {approver}
            </button>
          </span>
        )}
        {!settled && canApprove && (
          <div className="flex gap-2">
            <Button variant="ghost" busy={busy[`reject-${action.id}`]} onClick={reject}>
              Reject
            </Button>
            <Button variant="success" busy={busy[`approve-${action.id}`]} disabled={!passed} onClick={approve}>
              <ShieldCheck className="size-4" /> Approve & {action.kind === "refund" ? "refund" : action.kind === "cancel" ? "return funds" : "pay"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
