import { CheckCircle2, CircleDashed, Scale, ScanSearch, XCircle } from "lucide-react";
import type { Deal, Mediation, Verification } from "@arko/shared";
import { formatMoney } from "../../lib/format.ts";
import { splitAmount } from "@arko/shared";

const CRIT = {
  met: { icon: <CheckCircle2 className="size-4 text-emerald-600" />, label: "Met" },
  partial: { icon: <CircleDashed className="size-4 text-amber-500" />, label: "Partly" },
  not_met: { icon: <XCircle className="size-4 text-rose-500" />, label: "Not met" },
};

export function VerificationCard({ v }: { v: Verification }) {
  const tone = v.verdict === "pass" ? "text-emerald-600" : v.verdict === "partial" ? "text-amber-600" : "text-rose-600";
  return (
    <div className="rounded-xl bg-gradient-to-br from-teal-50 to-white p-4 ring-1 ring-teal-100 dark:from-teal-950/40 dark:to-slate-900 dark:ring-teal-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-5 text-teal-600" />
          <div>
            <div className="text-sm font-semibold">Verifier Agent</div>
            <div className="text-xs text-slate-500">Checked proof against every acceptance criterion</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold tabular-nums ${tone}`}>{v.score}</div>
          <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">score</div>
        </div>
      </div>
      <p className="mt-3 text-sm">{v.summary}</p>
      <ul className="mt-3 space-y-2">
        {v.criteria.map((c) => (
          <li key={c.criterion} className="flex gap-2 text-sm">
            <span className="mt-0.5">{CRIT[c.status].icon}</span>
            <span>
              <span className="font-medium">{c.criterion}</span>
              <span className="block text-xs text-slate-500">{c.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-xs font-medium text-slate-500">
        Recommendation: <span className={tone}>{v.recommendation.replace("_", " ")}</span>
      </div>
    </div>
  );
}

export function MediationCard({ m, deal, amount }: { m: Mediation; deal: Deal; amount: string }) {
  const [payee, payer] = splitAmount(amount, m.freelancerPercent);
  return (
    <div className="rounded-xl bg-gradient-to-br from-orange-50 to-white p-4 ring-1 ring-orange-100 dark:from-orange-950/30 dark:to-slate-900 dark:ring-orange-900">
      <div className="flex items-center gap-2">
        <Scale className="size-5 text-orange-600" />
        <div>
          <div className="text-sm font-semibold">Mediator Agent proposal</div>
          <div className="text-xs text-slate-500">Neutral split based on evidence and both statements</div>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-3 rounded-full bg-gradient-to-r from-brand-500 to-emerald-500" style={{ width: `${m.freelancerPercent}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-sm">
        <span>
          <b>{formatMoney(payee, deal.currency)}</b> to {deal.freelancerName} ({m.freelancerPercent}%)
        </span>
        <span>
          <b>{formatMoney(payer, deal.currency)}</b> back to {deal.clientName}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">{m.reasoning}</p>
      <div className="mt-2 text-xs text-slate-500">Accepted by: {m.acceptedBy.length ? m.acceptedBy.join(" & ") : "no one yet"}</div>
    </div>
  );
}
